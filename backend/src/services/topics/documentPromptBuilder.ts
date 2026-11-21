import {
  documentKindLabel,
  mainDocumentLabel,
  PROJECT_TYPE_LABELS,
  type DocumentKind,
  type DocumentOutline,
  type ProjectTypeId,
} from "../../../../shared/research/documentStructures";
import type {
  GeneratedTopic,
  ProfileAnalysis,
  VerifiedReading,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  parseFieldAccessWeeks,
  RESEARCH_WORK_PLAN_SECTIONS,
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

  const fieldAccess =
    typeof input.answers.field_access === "string"
      ? input.answers.field_access.trim()
      : typeof input.fields.field_access === "string"
        ? String(input.fields.field_access).trim()
        : "";
  const accessWeeks = parseFieldAccessWeeks(fieldAccess);

  const workPlan =
    input.kind === "work_plan"
      ? buildWorkPlanFromTopic({
          answers: {
            ...input.fields,
            project_type: input.projectType,
            field_access: fieldAccess || undefined,
            deadline_range:
              input.fields.deadline_range ?? input.answers.deadline_range,
            weekly_time:
              input.fields.weekly_time ?? input.answers.weekly_time,
          },
          topic: input.topic,
          sections: RESEARCH_WORK_PLAN_SECTIONS,
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
            field_access: fieldAccess || null,
            field_access_weeks: accessWeeks,
            budget,
          }),
          `Livrable à organiser : ${mainLabel} (${PROJECT_TYPE_LABELS[input.projectType]}).`,
          "Le plan suit le déroulement d'une recherche (pas les chapitres du mémoire) : 1) cadrage et lectures ; 2) préparation du terrain ; 3) collecte ; 4) rédaction du cadre théorique et de la méthodologie (en parallèle de la collecte) ; 5) analyse ; 6) rédaction des résultats et de la discussion ; 7) relecture. L'introduction se finalise à la fin, jamais en premier.",
          "Découpez le délai de rendu en périodes ; dimensionnez la colonne Charge selon le temps hebdomadaire déclaré (sans dépasser ce rythme).",
          `La somme des charges du tableau ne doit pas dépasser ${budget.totalHours} h.`,
          typeof input.topic.estimated_hours === "number"
            ? `Charges collecte+analyse imposées (fieldworkCosts, ne pas réestimer) : ${input.topic.estimated_hours} h. Le reste du budget (${budget.totalHours} h) pour lectures, rédaction et relecture.`
            : "Répartissez estimated_hours sur collecte/analyse ; le reste du budget pour lectures, rédaction et relecture.",
          `Quantités terrain à reprendre exactement (fieldwork_plan) : ${JSON.stringify(input.topic.fieldwork_plan || [])}. Ne changez aucun chiffre.`,
          `Rythme hebdomadaire déclaré : ${budget.hoursPerWeek} h/semaine. Aucune semaine ne doit dépasser ${Math.round(budget.hoursPerWeek * 1.25 * 10) / 10} h (chevauchements compris) : étalez les phases si besoin sans changer le total ni la date de rendu.`,
          accessWeeks != null
            ? `Fenêtre d'accès au terrain déclarée : « ${fieldAccess} » (≈ ${accessWeeks} semaines). Si le terrain du sujet en dépend, la collecte tient dans cette fenêtre à compter du début du planning, précédée d'une préparation courte.`
            : "",
          "Obligatoire : section schedule avec champ table rempli (4 à 7 lignes) — Phase | Période | Objectif | Livrable | Point d’encadrement | Charge | Heures par semaine. Inclure une ligne de collecte explicite.",
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

  const topicCore = {
    axis: input.topic.axis,
    title: input.topic.title,
    research_object: input.topic.research_object,
    research_question: input.topic.research_question,
    hypotheses: input.topic.hypotheses,
    hypothesis_tests: input.topic.hypothesis_tests,
    pitch: input.topic.pitch,
    stakes: input.topic.stakes,
    leads: input.topic.leads,
    expected_contribution: input.topic.expected_contribution,
    fieldwork_plan: input.topic.fieldwork_plan,
    estimated_hours: input.topic.estimated_hours,
    field_or_corpus: input.topic.field_or_corpus,
    method: input.topic.method,
    context: input.topic.context,
    rationale: input.topic.rationale,
    feasibility: input.topic.feasibility,
    keywords_fr: input.topic.keywords_fr,
    keywords_en: input.topic.keywords_en,
    ethical_notes: input.topic.ethical_notes,
  };

  return [
    `Type de document : ${kindLabel}.`,
    `Type de projet : ${PROJECT_TYPE_LABELS[input.projectType]}.`,
    input.outline.guidance,
    "## Guide de niveau",
    JSON.stringify(guide),
    "## Budget de temps",
    `${budget.label} (total ${budget.totalHours} h ; heures disponibles déclarées à respecter)`,
    "## Éléments à injecter fidèlement",
    JSON.stringify({
      pitch: input.topic.pitch,
      stakes: input.topic.stakes,
      leads: input.topic.leads,
      expected_contribution: input.topic.expected_contribution,
      fieldwork_plan: input.topic.fieldwork_plan,
      estimated_hours: input.topic.estimated_hours,
      available_hours: budget.totalHours,
      hypothesis_tests: input.topic.hypothesis_tests,
    }),
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
    JSON.stringify(topicCore),
    "Profil pseudonymisé :",
    JSON.stringify({ axes: input.axes, fields: input.fields }),
    ...workPlanExtra,
    "## Consigne",
    "Appelle l'outil propose_document.",
    "Rappelle : problématique = question + pour chaque hypothèse comment elle sera éprouvée ; design = fieldwork_plan sans changer les quantités ; planning = phases de recherche (cadrage → préparation → collecte → rédaction cadre théorique/méthodo pendant la collecte → analyse → rédaction des résultats → relecture), estimated_hours pour collecte/analyse ; hors collecte/analyse : cadrage 25 %, préparation 8 %, rédaction 55 %, relecture 12 % (relecture ≤ 15 % du total) ; enjeux et apport dans la section enjeu/résultats ; ton = celui du pitch.",
  ].join("\n\n");
}
