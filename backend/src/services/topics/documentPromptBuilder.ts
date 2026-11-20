import {
  documentKindLabel,
  mainDocumentLabel,
  PROJECT_TYPE_LABELS,
  type DocumentKind,
  type DocumentOutline,
  type ProjectTypeId,
} from "../../../../shared/research/documentStructures";
import { writingStructureFor } from "../../../../shared/research/corpusOrganization";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  workPlanToScheduleTable,
} from "../../../../shared/research/workPlan";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import { getProjectLevelGuide } from "../../../../shared/research/projectLevelGuides";
import { RESEARCH_DOCUMENT_SYSTEM } from "../../prompts/researchDocumentSystem";

export function documentSystemPrompt(): string {
  return RESEARCH_DOCUMENT_SYSTEM;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

/** Only score≥2 readings; numbered [R1]… with abstract + relevance_reason. */
function formatReadings(readings: VerifiedReading[]): string {
  const retained = readings.filter(
    (r) => (r.relevance_score ?? 2) >= 2,
  );
  if (!retained.length)
    return "(Aucune lecture vérifiée fournie — n'invente aucune référence.)";
  return retained
    .map((r, i) => {
      const authors =
        r.authors.length > 0 ? r.authors.join(", ") : "Auteur inconnu";
      const year = r.year ?? "s. d.";
      const venue = r.venue ? ` ${r.venue}.` : "";
      const reason = r.relevance_reason
        ? ` Pertinence : ${truncate(r.relevance_reason, 120)}.`
        : "";
      const abstractHint = r.abstract ? truncate(r.abstract, 400) : "";
      const abstractLine = abstractHint ? ` Résumé : ${abstractHint}` : "";
      return `[R${i + 1}] ${authors} (${year}). ${r.title}.${venue}${reason}${abstractLine}`;
    })
    .join("\n");
}

export function buildDocumentUserPrompt(input: {
  outline: DocumentOutline;
  topic: GeneratedTopic;
  axes: Record<string, Record<string, unknown>>;
  fields: Record<string, unknown>;
  kind: DocumentKind;
  projectType: ProjectTypeId;
  answers: Record<string, unknown>;
  profile_analysis?: ProfileAnalysis;
}): string {
  const kindLabel = documentKindLabel(input.kind, input.projectType);
  const mainLabel = mainDocumentLabel(input.projectType);
  const guide = getProjectLevelGuide(input.projectType);
  const budget = computeTimeBudget(input.answers);
  const readings = (input.topic.readings || []).filter(
    (r) => (r.relevance_score ?? 2) >= 2,
  );

  const workPlan =
    input.kind === "work_plan"
      ? buildWorkPlanFromTopic({
          answers: {
            ...input.fields,
            project_type: input.projectType,
          },
          topic: input.topic,
          sections: writingStructureFor(input.projectType),
        })
      : null;
  const scheduleTable = workPlan ? workPlanToScheduleTable(workPlan) : null;

  const workPlanExtra =
    input.kind === "work_plan"
      ? [
          "Contraintes de temps à respecter absolument (issues du formulaire) :",
          JSON.stringify({
            deadline_range:
              input.fields.deadline_range ?? input.axes?.F?.deadline_range,
            weekly_time:
              input.fields.weekly_time ?? input.axes?.F?.weekly_time,
            expected_length:
              input.fields.expected_length ?? input.axes?.F?.expected_length,
            project_type: input.projectType,
            budget,
          }),
          `Livrable à organiser : ${mainLabel} (${PROJECT_TYPE_LABELS[input.projectType]}).`,
          "Le plan doit proposer un planning d’organisation concret : découper le délai de rendu en périodes, et dimensionner la colonne Charge selon le temps à consacrer au sujet par semaine (sans dépasser ce rythme).",
          `La somme des charges du tableau ne doit pas dépasser ${budget.totalHours} h.`,
          "Obligatoire : section schedule avec champ table rempli (4 à 7 lignes) — Période | Objectif | Actions | Livrable | Charge.",
          scheduleTable
            ? "Tableau de référence indicatif pour la section schedule (reprenez ces lignes, vous pouvez reformuler légèrement Actions ; conservez Période, Objectif, Livrable et Charge) :"
            : "",
          scheduleTable ? JSON.stringify(scheduleTable) : "",
          workPlan
            ? "Métadonnées du planning de référence (indicatif, à ajuster avec l’encadrement) :"
            : "",
          workPlan
            ? JSON.stringify({
                meta: workPlan.meta,
                rhythm: workPlan.rhythm,
                warnings: workPlan.warnings,
              })
            : "",
          "Volume : 1 à 2 pages. Style directif. Pas de reformulation du projet.",
        ].filter(Boolean)
      : [
          `Document demandé : ${mainLabel} pour un ${PROJECT_TYPE_LABELS[input.projectType]}.`,
          "Volume : environ 5 pages minimum, contenu substantiel.",
        ];

  return [
    `Type de document : ${kindLabel}.`,
    `Type de projet : ${PROJECT_TYPE_LABELS[input.projectType]}.`,
    input.outline.guidance,
    "## Guide de niveau",
    JSON.stringify(guide),
    "## Budget de temps",
    `${budget.label} (total ${budget.totalHours} h)`,
    "## Objet de recherche",
    input.topic.research_object || input.topic.title,
    "## Analyse de profil",
    input.profile_analysis
      ? JSON.stringify(input.profile_analysis)
      : "(non disponible)",
    "## Lectures vérifiées (seules citations autorisées via [Rn])",
    formatReadings(readings),
    "Structure obligatoire (conserve tous les id, dans cet ordre) :",
    JSON.stringify(input.outline.sections),
    "Sujet retenu :",
    JSON.stringify({
      ...input.topic,
      readings: undefined,
    }),
    "Profil pseudonymisé :",
    JSON.stringify({ axes: input.axes, fields: input.fields }),
    ...workPlanExtra,
    "## Consigne",
    "Appelle l'outil propose_document.",
  ].join("\n\n");
}
