import {
  getDocumentOutline,
  normalizeProjectType,
  type DocumentKind,
} from "../../../../shared/research/documentStructures";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  TopicDocument,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  enforceWorkPlanHoursAndLoad,
  joinSentences,
  planLoadSummary,
  planLoadSummarySentence,
  RESEARCH_WORK_PLAN_SECTIONS,
  workPlanToScheduleTable,
} from "../../../../shared/research/workPlan";
import { estimateFieldworkHours } from "../../../../shared/research/fieldworkCosts";
import { checkPlanQuantityMismatch } from "../../../../shared/research/planQuantityCheck";
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
import {
  collectDocumentOverLimitFields,
  enforceDocumentLimits,
  formatDocumentLengthHitsForCorrection,
} from "./documentLimits";
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

/**
 * Ajoute `workPlan`, impose les heures fieldworkCosts, aligne la table schedule.
 */
function withTopicWorkPlan(
  document: TopicDocument,
  answers: Record<string, unknown>,
  topic: GeneratedTopic,
  kind: DocumentKind,
  opts?: { logFallback?: boolean },
): TopicDocument {
  if (kind !== "work_plan") return document;
  const schedule = document.sections.find((s) => s.id === "schedule");
  const aiScheduleOk =
    Boolean(schedule?.table?.rows) && (schedule?.table?.rows.length || 0) >= 3;

  const projectType = normalizeProjectType(
    answers.project_type || document.projectType,
  );
  let workPlan =
    document.workPlan?.phases?.length
      ? document.workPlan
      : buildWorkPlanFromTopic({
          answers: { ...answers, project_type: projectType },
          topic,
          sections: RESEARCH_WORK_PLAN_SECTIONS,
        });
  if (!workPlan) return document;

  const estimated =
    typeof topic.estimated_hours === "number" && topic.estimated_hours > 0
      ? topic.estimated_hours
      : estimateFieldworkHours(topic.fieldwork_plan || []);

  const enforced = enforceWorkPlanHoursAndLoad(
    workPlan,
    estimated > 0 ? estimated : undefined,
    topic.fieldwork_plan,
  );
  workPlan = enforced.plan;
  if (enforced.overloadFixedInCode) {
    console.info(
      JSON.stringify({
        event: "topics.document",
        code: "PLAN_OVERLOAD_FIXED_IN_CODE",
        at: new Date().toISOString(),
      }),
    );
  }

  if (!aiScheduleOk && opts?.logFallback !== false) {
    console.info(
      JSON.stringify({
        event: "workplan.fallback",
        reason: "schedule_missing_or_incomplete",
        at: new Date().toISOString(),
      }),
    );
  }

  const table = workPlanToScheduleTable(workPlan);
  const loadSentence = planLoadSummarySentence(workPlan);
  return {
    ...document,
    workPlan,
    sections: document.sections.map((section) => {
      if (section.id !== "schedule") return section;
      const paragraphs = section.paragraphs?.length
        ? section.paragraphs
        : [
            joinSentences(
              `Planning proposé (${workPlan.meta.durationLabel}, ${workPlan.meta.weeklyLabel})`,
              "Ajustez les dates exactes avec votre encadrement",
              "Ce calendrier est indicatif",
            ),
          ];
      const withoutLoad = paragraphs.filter(
        (p) => !/^Charge moyenne\s*:/i.test(p.trim()),
      );
      return {
        ...section,
        paragraphs: [...withoutLoad, loadSentence],
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

function scheduleChargeIndex(headers: string[]): number {
  let chargeIdx = headers.findIndex((h) => /charge|heures|hours/.test(h));
  if (chargeIdx < 0) chargeIdx = Math.max(0, headers.length - 1);
  return chargeIdx;
}

function schedulePhaseText(row: string[], headers: string[]): string {
  const phaseIdx = headers.findIndex((h) =>
    /phase|objectif|p[eé]riode|actions/.test(h),
  );
  if (phaseIdx >= 0) return row.join(" ");
  return row.join(" ");
}

const COLLECT_PHASE_RE =
  /collecte|terrain|enqu[eê]te|observation|entretien|recueil|d[eé]pouillement/i;
const ANALYSIS_PHASE_RE =
  /analyse|traitement|codage|d[eé]pouillement|r[eé]sultats?\s+empir/i;

/** Sum of Charge column hours in schedule table. */
export function sumScheduleHours(document: TopicDocument): number {
  const schedule = document.sections.find((s) => s.id === "schedule");
  if (!schedule?.table?.headers?.length || !schedule.table.rows?.length)
    return 0;
  const headers = schedule.table.headers.map((h) => h.toLowerCase());
  const chargeIdx = scheduleChargeIndex(headers);
  return schedule.table.rows.reduce(
    (sum, row) => sum + parseHours(row[chargeIdx] || ""),
    0,
  );
}

/**
 * PLAN_NO_FIELDWORK : aucune phase de collecte, ou somme collecte+analyse
 * s’écarte de plus de 20 % de estimated_hours.
 */
export function checkPlanNoFieldwork(
  document: TopicDocument,
  estimatedHours: number | undefined,
): { code: "PLAN_NO_FIELDWORK"; detail: string } | null {
  const fromPhases = document.workPlan?.phases || [];
  const hasCollectPhase =
    fromPhases.some((p) => p.role === "fieldwork") ||
    (() => {
      const schedule = document.sections.find((s) => s.id === "schedule");
      if (!schedule?.table?.rows?.length) return false;
      return schedule.table.rows.some((row) =>
        COLLECT_PHASE_RE.test(row.join(" ")),
      );
    })();

  if (!hasCollectPhase) {
    return {
      code: "PLAN_NO_FIELDWORK",
      detail:
        "Le planning ne contient aucune phase de collecte. Ajoutez une phase Collecte avec dates et charge.",
    };
  }

  if (typeof estimatedHours !== "number" || estimatedHours <= 0) return null;

  let fieldAnalysisHours = 0;
  if (fromPhases.length) {
    fieldAnalysisHours = fromPhases
      .filter((p) => p.role === "fieldwork" || p.role === "analysis")
      .reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  } else {
    const schedule = document.sections.find((s) => s.id === "schedule");
    if (schedule?.table?.headers?.length && schedule.table.rows?.length) {
      const headers = schedule.table.headers.map((h) => h.toLowerCase());
      const chargeIdx = scheduleChargeIndex(headers);
      for (const row of schedule.table.rows) {
        const text = schedulePhaseText(row, headers);
        if (COLLECT_PHASE_RE.test(text) || ANALYSIS_PHASE_RE.test(text)) {
          fieldAnalysisHours += parseHours(row[chargeIdx] || "");
        }
      }
    }
  }

  const drift =
    Math.abs(fieldAnalysisHours - estimatedHours) / estimatedHours;
  if (drift > 0.2) {
    return {
      code: "PLAN_NO_FIELDWORK",
      detail: `La somme collecte+analyse (${Math.round(fieldAnalysisHours)} h) s'écarte de plus de 20 % de estimated_hours (${estimatedHours} h). Rééquilibrez ces phases.`,
    };
  }
  return null;
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
    const run = async (
      userPrompt: string,
      opts?: { skipDensity?: boolean; logFallback?: boolean },
    ) => {
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
        { logFallback: opts?.logFallback },
      );
      if (!opts?.skipDensity) assertDocumentDensity(aligned);
      return { document: aligned, model: result.model };
    };

    const finalizeLength = async (doc: TopicDocument, modelName: string) => {
      let next = doc;
      let nextModel = modelName;
      let hits = collectDocumentOverLimitFields(next);
      if (hits.length) {
        console.info(
          JSON.stringify({
            event: "topics.document",
            code: "TOO_LONG",
            kind: input.kind,
            hits: hits.slice(0, 8).map((h) => ({
              field: h.field,
              length: h.length,
              max: h.max,
            })),
          }),
        );
        try {
          const correctionUser = [
            user,
            "## Correction longueur",
            formatDocumentLengthHitsForCorrection(hits),
            "Corrige uniquement les champs listés. Conserve la structure (id) et le sens. Puis rappelle propose_document.",
          ].join("\n\n");
          const corrected = await run(correctionUser, { skipDensity: true });
          next = corrected.document;
          nextModel = corrected.model;
        } catch {
          // coupe locale ci-dessous
        }
        hits = collectDocumentOverLimitFields(next);
        if (hits.length) {
          console.info(
            JSON.stringify({
              event: "topics.document",
              code: "TOO_LONG_AFTER_CORRECTION",
              kind: input.kind,
              hits: hits.slice(0, 8).map((h) => ({
                field: h.field,
                length: h.length,
                max: h.max,
              })),
            }),
          );
        }
      }
      next = enforceDocumentLimits(next);
      assertDocumentDensity(next);
      return { document: next, model: nextModel };
    };

    try {
      try {
        const first = await run(user, { skipDensity: true });
        const finalized = await finalizeLength(first.document, first.model);
        document = finalized.document;
        model = finalized.model;
      } catch (firstErr) {
        console.info(
          JSON.stringify({
            event: "topics.document",
            status: "retry",
            kind: input.kind,
            error:
              firstErr instanceof Error
                ? firstErr.message.slice(0, 160)
                : "unknown",
            issues:
              firstErr &&
              typeof firstErr === "object" &&
              "issues" in firstErr &&
              Array.isArray((firstErr as { issues: unknown[] }).issues)
                ? (
                    firstErr as {
                      issues: Array<{ path?: unknown; message?: string }>;
                    }
                  ).issues
                    .slice(0, 4)
                    .map((i) => ({
                      path: Array.isArray(i.path) ? i.path.join(".") : "",
                      message: String(i.message || "").slice(0, 100),
                    }))
                : [],
          }),
        );
        const second = await run(user, { skipDensity: true });
        const finalized = await finalizeLength(second.document, second.model);
        document = finalized.document;
        model = finalized.model;
      }
    } catch (finalErr) {
      if (input.kind === "work_plan") {
        console.info(
          JSON.stringify({
            event: "workplan.fallback",
            reason: "llm_failed",
            error:
              finalErr instanceof Error
                ? finalErr.message.slice(0, 160)
                : "unknown",
            at: new Date().toISOString(),
          }),
        );
        document = simulateDocument({
          answers: input.answers,
          topic: input.topic,
          kind: input.kind,
        });
        document = enforceDocumentLimits(document);
        model = "workplan.fallback";
        simulated = true;
      } else {
        throw finalErr;
      }
    }

    if (input.kind === "work_plan" && !simulated) {
      const budget = computeTimeBudget(input.answers);
      const sum = sumScheduleHours(document);
      const estimated =
        typeof input.topic.estimated_hours === "number" &&
        input.topic.estimated_hours > 0
          ? input.topic.estimated_hours
          : estimateFieldworkHours(input.topic.fieldwork_plan || []);
      const planIssue = checkPlanNoFieldwork(document, estimated);
      const quantityIssue = checkPlanQuantityMismatch(
        document,
        input.topic.fieldwork_plan,
      );
      const load = document.workPlan
        ? planLoadSummary(document.workPlan)
        : null;
      const overloadIssue =
        load && load.overloadedWeeks.length
          ? {
              code: "PLAN_OVERLOAD" as const,
              detail: `Semaines en surcharge (> ${budget.hoursPerWeek}×1,25 h) : ${load.overloadedWeeks.join(", ")}. Pic ${load.peakHoursPerWeek} h. Étalez les phases ou ajustez les charges sans changer le total ni dépasser la date de rendu.`,
            }
          : null;
      const needBudgetFix = sum > budget.totalHours * 1.1;
      if (needBudgetFix || planIssue || quantityIssue || overloadIssue) {
        try {
          const fixLines = [
            user,
            "## Correction planning",
            needBudgetFix
              ? `La somme des charges (${sum} h) dépasse le budget (${budget.totalHours} h) de plus de 10 %. Recalibre le tableau schedule pour rester ≤ ${budget.totalHours} h.`
              : "",
            planIssue ? `[${planIssue.code}] ${planIssue.detail}` : "",
            quantityIssue
              ? `[${quantityIssue.code}] ${quantityIssue.detail} Reprenez exactement les quantités de fieldwork_plan : ${JSON.stringify(input.topic.fieldwork_plan || [])}.`
              : "",
            overloadIssue
              ? `[${overloadIssue.code}] ${overloadIssue.detail}`
              : "",
            typeof estimated === "number" && estimated > 0
              ? `Charges collecte+analyse imposées : ${estimated} h (calcul fieldworkCosts, ne pas réestimer).`
              : "",
            "Corrige uniquement le planning (phases de recherche : cadrage → préparation → collecte → rédaction cadre théorique/méthodo → analyse → rédaction des résultats → relecture). L'introduction n'est jamais en premier. Puis rappelle propose_document.",
          ].filter(Boolean);
          const corrected = await run(fixLines.join("\n\n"), {
            skipDensity: true,
          });
          const finalized = await finalizeLength(
            corrected.document,
            corrected.model,
          );
          document = finalized.document;
          model = finalized.model;
          const still = checkPlanNoFieldwork(document, estimated);
          if (still) {
            console.info(
              JSON.stringify({
                event: "topics.document",
                code: still.code,
                detail: still.detail.slice(0, 160),
              }),
            );
          }
          const stillQty = checkPlanQuantityMismatch(
            document,
            input.topic.fieldwork_plan,
          );
          if (stillQty) {
            console.info(
              JSON.stringify({
                event: "topics.document",
                code: stillQty.code,
                detail: stillQty.detail.slice(0, 160),
              }),
            );
          }
        } catch {
          // Keep first document if corrective call fails.
          for (const issue of [planIssue, quantityIssue, overloadIssue]) {
            if (!issue) continue;
            console.info(
              JSON.stringify({
                event: "topics.document",
                code: issue.code,
                detail: issue.detail.slice(0, 160),
              }),
            );
          }
        }
      }
    }

    // research_project : une correction ciblée si quantités ≠ fieldwork_plan
    if (input.kind === "research_project" && !simulated) {
      const quantityIssue = checkPlanQuantityMismatch(
        document,
        input.topic.fieldwork_plan,
      );
      if (quantityIssue) {
        try {
          const fixLines = [
            user,
            "## Correction quantités",
            `[${quantityIssue.code}] ${quantityIssue.detail}`,
            `Reprenez exactement fieldwork_plan : ${JSON.stringify(input.topic.fieldwork_plan || [])}.`,
            "Corrige uniquement les passages qui mentionnent de mauvaises quantités. Puis rappelle propose_document.",
          ];
          const corrected = await run(fixLines.join("\n\n"), {
            skipDensity: true,
          });
          const finalized = await finalizeLength(
            corrected.document,
            corrected.model,
          );
          document = finalized.document;
          model = finalized.model;
        } catch {
          console.info(
            JSON.stringify({
              event: "topics.document",
              code: quantityIssue.code,
              detail: quantityIssue.detail.slice(0, 160),
            }),
          );
        }
      }
    }

    if (!simulated) {
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
  }

  document = withTopicWorkPlan(
    document,
    input.answers,
    input.topic,
    input.kind,
    // Déjà journalisé à la première injection ; éviter un double log.
    { logFallback: false },
  );
  document = enforceDocumentLimits(document);

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
