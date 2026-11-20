import {
  getDocumentOutline,
  normalizeProjectType,
  type DocumentKind,
} from "../../../../shared/research/documentStructures";
import { writingStructureFor } from "../../../../shared/research/corpusOrganization";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  TopicDocument,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  joinSentences,
  workPlanToScheduleTable,
} from "../../../../shared/research/workPlan";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import { buildPseudonymizedProfile } from "../privacy/buildPseudonymizedProfile";
import {
  callClaudeStructured,
  getClaudeSettings,
  isClaudeProvider,
  isLlmConfigured,
} from "../llm/claude";
import {
  buildDocumentUserPrompt,
  documentSystemPrompt,
} from "./documentPromptBuilder";
import {
  assertDocumentDensity,
  parseProposeDocumentToolInput,
  proposeDocumentInputSchema,
  proposeDocumentLlmSchema,
} from "./validateDocument";
import { applyCitationGuard } from "./citationGuard";
import { simulateDocument } from "./simulateContent";
import { buildTopicDocx } from "./buildDocx";

function alignDocument(
  parsed: TopicDocument,
  outlineIds: string[],
  kind: DocumentKind,
  projectType: string,
): TopicDocument {
  const byId = new Map(parsed.sections.map((s) => [s.id, s]));
  const sections = outlineIds
    .map((id) => byId.get(id))
    .filter((s): s is TopicDocument["sections"][number] => Boolean(s));
  if (sections.length < outlineIds.length)
    throw new Error("Structure du document incomplète.");
  return {
    ...parsed,
    kind,
    projectType,
    sections,
  };
}

/** Ajoute `workPlan` et aligne la table schedule sans casser les autres sections. */
function withTopicWorkPlan(
  document: TopicDocument,
  answers: Record<string, unknown>,
  topic: GeneratedTopic,
  kind: DocumentKind,
): TopicDocument {
  if (kind !== "work_plan") return document;
  if (document.workPlan?.phases?.length) {
    const schedule = document.sections.find((s) => s.id === "schedule");
    if (schedule?.table?.rows && schedule.table.rows.length >= 3)
      return document;
  }
  const projectType = normalizeProjectType(
    answers.project_type || document.projectType,
  );
  const workPlan = document.workPlan?.phases?.length
    ? document.workPlan
    : buildWorkPlanFromTopic({
        answers: { ...answers, project_type: projectType },
        topic,
        sections: writingStructureFor(projectType),
      });
  if (!workPlan) return document;
  const table = workPlanToScheduleTable(workPlan);
  return {
    ...document,
    workPlan,
    sections: document.sections.map((section) => {
      if (section.id !== "schedule") return section;
      return {
        ...section,
        paragraphs: section.paragraphs?.length
          ? section.paragraphs
          : [
              joinSentences(
                `Planning proposé (${workPlan.meta.durationLabel}, ${workPlan.meta.weeklyLabel})`,
                "Ajustez les dates exactes avec votre encadrement",
                "Ce calendrier est indicatif",
              ),
            ],
        table,
      };
    }),
  };
}

function parseHours(cell: string): number {
  const m = cell.match(/(\d+(?:[.,]\d+)?)\s*h/i);
  if (!m) return 0;
  return Number(m[1].replace(",", ".")) || 0;
}

/** Sum of Charge column hours in schedule table. */
export function sumScheduleHours(document: TopicDocument): number {
  const schedule = document.sections.find((s) => s.id === "schedule");
  if (!schedule?.table?.headers?.length || !schedule.table.rows?.length)
    return 0;
  const headers = schedule.table.headers.map((h) => h.toLowerCase());
  let chargeIdx = headers.findIndex((h) => /charge|heures|hours/.test(h));
  if (chargeIdx < 0) chargeIdx = headers.length - 1;
  return schedule.table.rows.reduce(
    (sum, row) => sum + parseHours(row[chargeIdx] || ""),
    0,
  );
}

export async function generateTopicDocument(input: {
  answers: Record<string, unknown>;
  topic: GeneratedTopic;
  kind: DocumentKind;
  env: Record<string, string>;
  simulate?: boolean;
  profile_analysis?: ProfileAnalysis;
}): Promise<{
  document: TopicDocument;
  file: { filename: string; mimeType: string; base64: string };
  model: string;
  simulated: boolean;
  citationCodes?: string[];
  bibliography?: { cited: VerifiedReading[]; other: VerifiedReading[] };
}> {
  const projectType = normalizeProjectType(input.answers.project_type);
  const outline = getDocumentOutline(projectType, input.kind);
  const outlineIds = outline.sections.map((s) => s.id);

  let document: TopicDocument;
  let model = "simulation";
  let simulated = Boolean(input.simulate);
  let citationCodes: string[] = [];
  let citedIndexes: number[] = [];
  const retainedReadings = (input.topic.readings || []).filter(
    (r) => (r.relevance_score ?? 2) >= 2,
  );

  if (input.simulate) {
    simulated = true;
    document = simulateDocument({
      answers: input.answers,
      topic: input.topic,
      kind: input.kind,
    });
  } else if (!isLlmConfigured(input.env) || !isClaudeProvider()) {
    const err = new Error(
      "Le service de génération est momentanément indisponible.",
    ) as Error & { status: number };
    err.status = 503;
    throw err;
  } else {
    const profile = buildPseudonymizedProfile(input.answers);
    const system = documentSystemPrompt();
    const user = buildDocumentUserPrompt({
      outline,
      topic: input.topic,
      axes: profile.axes,
      fields: {
        ...profile.fields,
        deadline_range: input.answers.deadline_range,
        weekly_time: input.answers.weekly_time,
        expected_length: input.answers.expected_length,
      },
      kind: input.kind,
      projectType,
      answers: input.answers,
      profile_analysis: input.profile_analysis,
    });

    const { modelSmart } = getClaudeSettings();
    const run = async (userPrompt: string) => {
      const result = await callClaudeStructured<unknown>({
        system,
        user: userPrompt,
        toolName: "propose_document",
        inputSchema: proposeDocumentInputSchema,
        zodSchema: proposeDocumentLlmSchema,
        model: modelSmart,
        temperature: input.kind === "work_plan" ? 0.35 : 0.45,
        maxTokens: input.kind === "work_plan" ? 6000 : 16000,
        toolDescription:
          "Rédige le document académique complet selon le schéma fourni.",
      });
      const parsed = parseProposeDocumentToolInput(result.data);
      const aligned = withTopicWorkPlan(
        alignDocument(parsed, outlineIds, input.kind, projectType),
        input.answers,
        input.topic,
        input.kind,
      );
      assertDocumentDensity(aligned);
      return { document: aligned, model: result.model };
    };

    try {
      const first = await run(user);
      document = first.document;
      model = first.model;
    } catch {
      const second = await run(user);
      document = second.document;
      model = second.model;
    }

    if (input.kind === "work_plan") {
      const budget = computeTimeBudget(input.answers);
      const sum = sumScheduleHours(document);
      if (sum > budget.totalHours * 1.1) {
        try {
          const corrected = await run(
            [
              user,
              "## Correction planning",
              `La somme des charges (${sum} h) dépasse le budget (${budget.totalHours} h) de plus de 10 %. Recalibre uniquement le tableau schedule pour rester ≤ ${budget.totalHours} h, puis rappelle propose_document.`,
            ].join("\n\n"),
          );
          document = corrected.document;
          model = corrected.model;
        } catch {
          // Keep first document if corrective call fails.
        }
      }
    }

    const guarded = applyCitationGuard(document, retainedReadings);
    document = guarded.document;
    citationCodes = guarded.codes;
    citedIndexes = guarded.citedIndexes;
    for (const code of citationCodes) {
      if (code === "UNVERIFIED_CITATION")
        console.info(
          JSON.stringify({
            event: "topics.document.citation",
            code: "UNVERIFIED_CITATION",
            at: new Date().toISOString(),
          }),
        );
    }
  }

  document = withTopicWorkPlan(
    document,
    input.answers,
    input.topic,
    input.kind,
  );

  const citedSet = new Set(citedIndexes);
  const bibliography =
    input.kind === "research_project"
      ? {
          cited: retainedReadings.filter((_, i) => citedSet.has(i + 1)),
          other: retainedReadings.filter((_, i) => !citedSet.has(i + 1)),
        }
      : undefined;

  const file = await buildTopicDocx(document, {
    bibliography:
      input.kind === "research_project" ? bibliography : undefined,
    readings:
      input.kind === "research_project" ? retainedReadings : [],
  });
  return {
    document,
    file: {
      filename: file.filename,
      mimeType: file.mimeType,
      base64: file.buffer.toString("base64"),
    },
    model,
    simulated,
    citationCodes,
    bibliography,
  };
}
