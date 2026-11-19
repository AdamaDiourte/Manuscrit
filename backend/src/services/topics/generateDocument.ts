import {
  getDocumentOutline,
  normalizeProjectType,
  type DocumentKind,
} from "../../../../shared/research/documentStructures";
import { writingStructureFor } from "../../../../shared/research/corpusOrganization";
import type {
  GeneratedTopic,
  TopicDocument,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  joinSentences,
  workPlanToScheduleTable,
} from "../../../../shared/research/workPlan";
import { buildPseudonymizedProfile } from "../privacy/buildPseudonymizedProfile";
import { chatCompletion } from "../llm/client";
import {
  buildDocumentUserPrompt,
  documentSystemPrompt,
} from "./documentPromptBuilder";
import {
  assertDocumentDensity,
  parseTopicDocument,
} from "./validateDocument";
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
    if (schedule?.table?.rows && schedule.table.rows.length >= 3) return document;
  }
  const projectType = normalizeProjectType(
    answers.project_type || document.projectType,
  );
  const workPlan =
    document.workPlan?.phases?.length
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
        paragraphs:
          section.paragraphs?.length
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

export async function generateTopicDocument(input: {
  answers: Record<string, unknown>;
  topic: GeneratedTopic;
  kind: DocumentKind;
  env: Record<string, string>;
  simulate?: boolean;
}): Promise<{
  document: TopicDocument;
  file: { filename: string; mimeType: string; base64: string };
  model: string;
  simulated: boolean;
}> {
  const projectType = normalizeProjectType(input.answers.project_type);
  const outline = getDocumentOutline(projectType, input.kind);
  const outlineIds = outline.sections.map((s) => s.id);

  let document: TopicDocument;
  let model = "simulation";
  let simulated = Boolean(input.simulate);

  if (input.simulate || !input.env.AI_API_KEY) {
    simulated = true;
    document = simulateDocument({
      answers: input.answers,
      topic: input.topic,
      kind: input.kind,
    });
  } else {
    const profile = buildPseudonymizedProfile(input.answers);
    const messages = [
      { role: "system" as const, content: documentSystemPrompt() },
      {
        role: "user" as const,
        content: buildDocumentUserPrompt({
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
        }),
      },
    ];

    const run = async () => {
      const result = await chatCompletion(messages, input.env, {
        temperature: input.kind === "work_plan" ? 0.35 : 0.45,
        maxTokens: input.kind === "work_plan" ? 3500 : 8000,
        timeoutMs: 180000,
      });
      const parsed = parseTopicDocument(result.content);
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
      const first = await run();
      document = first.document;
      model = first.model;
    } catch {
      const second = await run();
      document = second.document;
      model = second.model;
    }
  }

  document = withTopicWorkPlan(
    document,
    input.answers,
    input.topic,
    input.kind,
  );

  const file = await buildTopicDocx(document);
  return {
    document,
    file: {
      filename: file.filename,
      mimeType: file.mimeType,
      base64: file.buffer.toString("base64"),
    },
    model,
    simulated,
  };
}
