/**
 * Contexte projet unique transmis à l’IA (cadrage, sujet, workspace, profil).
 * Fonctions pures — utilisables front et back.
 */

import {
  BRIEF_MAX_CHARS,
  SPECIFIC_INSTRUCTIONS_MAX,
  collectionModeLabels,
  disciplineLabel,
  documentTypeLabel,
  expectedLengthLabel,
  modesFromMaterials,
  writingStructureFor,
  writingTimeLabel,
  type CorpusFrame,
} from "./corpusOrganization";
import {
  PROJECT_TYPE_LABELS,
  normalizeProjectType,
} from "./documentStructures";
import {
  formatGenreExpectations,
  genreProfileFor,
} from "./genreProfiles";
import { topicQuestions } from "./topicQuestions";
import type { GeneratedTopic } from "./topicTypes";
import { SKIP_VALUE } from "./topicTypes";
import { findSubmissionEndDate } from "./workPlan";
import { hashUnitKey } from "./units";
import { pseudonymizeText } from "./pseudonymizeCorpus";

// materialCollectionModeLabel vit dans project.ts (évite cycle units ↔ projectContext).
export { materialCollectionModeLabel } from "./project";

export const PROJECT_CONTEXT_MAX_CHARS = 8000;

export const PROFILE_ANSWER_KEYS = [
  "writing_language",
  "deadline_range",
  "weekly_time",
  "methods_skills",
  "method_to_learn",
] as const;

export type ProfileAnswerKey = (typeof PROFILE_ANSWER_KEYS)[number];

export type ProjectContext = {
  document: {
    typeLabel: string;
    projectTitle: string;
    projectTypeLabel: string;
  };
  discipline: { label: string; specialty: string };
  scope: {
    expectedLengthLabel: string;
    writingTimeLabel: string;
    startDate?: string;
    endDate?: string;
  };
  research: {
    presentation: string;
    researchQuestion: string;
    hypotheses: string[];
    method: string;
    fieldOrCorpus: string;
    keywords: string[];
    risks: string[];
    topicTitle?: string;
    axis?: string;
  };
  collection: {
    modeLabels: string[];
    combinedNote: string;
  };
  workspace: {
    projectTitle: string;
    chapters: { title: string; progress: number }[];
    deadlines: { title: string; date: string }[];
  };
  profile: { label: string; value: string }[];
  revision?: {
    feedback: string;
    previousPlan: { title: string; advice: string }[];
  };
  writingStructure: {
    title: string;
    intent: string;
    role?: string;
    subsections?: { title: string; intent: string }[];
  }[];
  /** Attentes du support (profil) — phrases pour l’IA. */
  genreExpectations: string;
  /** Consignes spécifiques auteur (établissement, directeur, revue, éditeur). */
  specificInstructions: string;
};

export type ProjectContextRequest = {
  revisionFeedback?: string;
  previousPlan?: { title: string; advice: string }[];
};

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function clipLines(values: unknown, maxItems: number, maxEach: number): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => clip(v, maxEach))
    .filter(Boolean)
    .slice(0, maxItems);
}

function optionLabel(questionId: string, value: string): string {
  const q = topicQuestions.find((x) => x.id === questionId);
  if (!q) return value;
  if (q.type === "multi_scale") {
    const opt = q.options?.find((o) => o.value === value);
    return opt?.label || value;
  }
  const opt = q.options?.find((o) => o.value === value);
  return opt?.label || value;
}

/** Libellés lisibles pour le sous-ensemble profil (jamais de codes bruts). */
export function formatProfileAnswers(
  answers: Record<string, unknown> | null | undefined,
): { label: string; value: string }[] {
  if (!answers || typeof answers !== "object") return [];
  const out: { label: string; value: string }[] = [];
  for (const key of PROFILE_ANSWER_KEYS) {
    const q = topicQuestions.find((x) => x.id === key);
    if (!q || !(key in answers)) continue;
    const raw = answers[key];
    if (raw === undefined || raw === null || raw === "" || raw === SKIP_VALUE)
      continue;
    let value = "";
    if (q.type === "single" && typeof raw === "string") {
      value = optionLabel(key, raw);
      if (raw === "other" || raw === "autre") {
        const other = answers[`${key}_other`];
        if (typeof other === "string" && other.trim())
          value = other.trim().slice(0, 120);
      }
    } else if (q.type === "multi" && Array.isArray(raw)) {
      value = raw
        .map((v) => optionLabel(key, String(v)))
        .filter(Boolean)
        .join(", ");
      if (raw.includes("other") || raw.includes("autre")) {
        const other = answers.method_to_learn_other;
        if (typeof other === "string" && other.trim())
          value = [value, other.trim()].filter(Boolean).join(" — ");
      }
    } else if (q.type === "multi_scale" && raw && typeof raw === "object") {
      const min = q.min ?? 0;
      value = Object.entries(raw as Record<string, number>)
        .map(([k, n]) => {
          const level =
            q.scaleLabels?.[n - min] ?? (n === 0 ? "Aucun" : String(n));
          return optionLabel(key, k) + " : " + level;
        })
        .join(", ");
    } else if (typeof raw === "string") {
      value = raw.trim();
    }
    value = clip(value, 400);
    if (!value) continue;
    out.push({ label: q.label, value });
  }
  return out;
}

/** Sous-ensemble d’answers à persister dans le draft (codes bruts OK en stockage). */
export function pickTopicAnswersForDraft(
  answers: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!answers) return {};
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_ANSWER_KEYS) {
    if (key in answers) out[key] = answers[key];
  }
  if (answers.method_to_learn_other !== undefined)
    out.method_to_learn_other = answers.method_to_learn_other;
  if (answers.writing_language_other !== undefined)
    out.writing_language_other = answers.writing_language_other;
  // Préremplissage cadrage
  for (const k of [
    "project_type",
    "project_type_other",
    "discipline_main",
    "discipline_main_other",
    "specialty",
    "expected_length",
  ]) {
    if (k in answers) out[k] = answers[k];
  }
  return out;
}

function resolveTopicAnswers(draft: any): Record<string, unknown> {
  if (draft?.topicAnswers && typeof draft.topicAnswers === "object")
    return draft.topicAnswers;
  const archive = Array.isArray(draft?.topicArchive) ? draft.topicArchive : [];
  for (const entry of archive) {
    if (entry?.answers && typeof entry.answers === "object") return entry.answers;
  }
  return {};
}

function projectTypeLabelOf(project: any, draft: CorpusFrame): string {
  const fromFrame = documentTypeLabel(draft.documentType, draft.documentTypeOther);
  if (fromFrame) return fromFrame;
  const id = normalizeProjectType(project?.type);
  if (id === "other" && project?.typeOther?.trim()) return project.typeOther.trim();
  return PROJECT_TYPE_LABELS[id] || String(project?.type || "");
}

export function buildProjectContext(
  project: any,
  draft: any,
  request: ProjectContextRequest = {},
): ProjectContext {
  const frame = (draft || {}) as CorpusFrame & {
    chosenTopic?: GeneratedTopic | null;
    topicAnswers?: Record<string, unknown>;
  };
  const topic = frame.chosenTopic || null;
  const answers = resolveTopicAnswers(draft);

  const presentation = clip(frame.brief, BRIEF_MAX_CHARS);
  const researchQuestion = clip(
    frame.researchQuestion || topic?.research_question || "",
    500,
  );
  const frameHypotheses = Array.isArray(frame.hypotheses)
    ? frame.hypotheses
    : typeof frame.hypotheses === "string"
      ? frame.hypotheses.split(/\n+/).map((h) => h.trim()).filter(Boolean)
      : [];
  const hypotheses = clipLines(
    frameHypotheses.length ? frameHypotheses : topic?.hypotheses,
    5,
    300,
  );
  const method = clip(frame.method || topic?.method || "", 800);
  const fieldOrCorpus = clip(
    frame.fieldOrCorpus || topic?.field_or_corpus || "",
    800,
  );
  const keywords = clipLines(
    [...(topic?.keywords_fr || []), ...(topic?.keywords_en || [])],
    20,
    40,
  );
  const risks = clipLines(topic?.feasibility?.risks, 8, 200);
  const workingTitle = clip(frame.workingTitle || topic?.title || "", 220);

  const materials = Array.isArray(project?.materials) ? project.materials : [];
  const modeLabels =
    modesFromMaterials(materials).length > 0
      ? modesFromMaterials(materials)
      : collectionModeLabels(
          frame.collectionModes,
          frame.collectionModesOther,
        );

  const chapters = (Array.isArray(project?.chapters) ? project.chapters : [])
    .map((c: any) => ({
      title: clip(c?.title, 120),
      progress: Math.max(0, Math.min(100, Number(c?.progress) || 0)),
    }))
    .filter((c: { title: string }) => c.title)
    .slice(0, 20);

  const deadlines = (Array.isArray(project?.dates) ? project.dates : [])
    .map((d: any) => ({
      title: clip(d?.title, 120),
      date: clip(d?.date, 32),
    }))
    .filter((d: { title: string; date: string }) => d.title && d.date)
    .slice(0, 10);

  const structure = writingStructureFor(frame.documentType) || [];
  const feedback = clip(request.revisionFeedback, 1200);
  const previousPlan = (request.previousPlan || [])
    .slice(0, 12)
    .map((s) => ({
      title: clip(s.title, 220),
      advice: clip(s.advice, 600),
    }))
    .filter((s) => s.title);

  const projectTitle = clip(project?.title, 200);
  const genreProfile = genreProfileFor(frame.documentType);
  const specificInstructions = clip(
    frame.specificInstructions,
    SPECIFIC_INSTRUCTIONS_MAX,
  );

  return {
    document: {
      typeLabel: documentTypeLabel(frame.documentType, frame.documentTypeOther),
      projectTitle,
      projectTypeLabel: projectTypeLabelOf(project, frame),
    },
    discipline: {
      label: disciplineLabel(frame.discipline, frame.disciplineOther),
      specialty: clip(frame.specialty, 300),
    },
    scope: {
      expectedLengthLabel: expectedLengthLabel(frame.expectedLength),
      writingTimeLabel: writingTimeLabel(frame.writingTime),
      startDate: frame.startDate || undefined,
      endDate: findSubmissionEndDate(project?.dates) || undefined,
    },
    research: {
      presentation,
      researchQuestion,
      hypotheses,
      method,
      fieldOrCorpus,
      keywords,
      risks,
      topicTitle: workingTitle || undefined,
      axis: topic?.axis || undefined,
    },
    collection: {
      modeLabels,
      combinedNote: clip(frame.collectionCombinedNote, 800),
    },
    workspace: {
      projectTitle,
      chapters,
      deadlines,
    },
    profile: formatProfileAnswers(answers),
    revision:
      feedback || previousPlan.length
        ? { feedback, previousPlan }
        : undefined,
    writingStructure: structure.map((s) => ({
      title: s.title,
      intent: s.intent,
      ...(s.role ? { role: s.role } : {}),
      ...(s.subsections?.length
        ? {
            subsections: s.subsections.map((sub) => ({
              title: sub.title,
              intent: sub.intent,
            })),
          }
        : {}),
    })),
    genreExpectations: formatGenreExpectations(genreProfile),
    specificInstructions,
  };
}

export type FormatProjectContextOptions = {
  /** Inclure révision / plan précédent (synthèse, plan, affectation). */
  includeRevision?: boolean;
};

/** Texte à rubriques nommées ; rubriques vides omises ; ≤ 8 000 car. */
export function formatProjectContext(
  ctx: ProjectContext,
  opts: FormatProjectContextOptions = {},
): string {
  const parts: string[] = [];
  const push = (title: string, body: string) => {
    const t = body.trim();
    if (!t) return;
    parts.push(`${title} :\n${t}`);
  };

  push("Type de manuscrit visé", ctx.document.typeLabel);
  push("Titre du projet", ctx.document.projectTitle);
  if (
    ctx.document.projectTypeLabel &&
    ctx.document.projectTypeLabel !== ctx.document.typeLabel
  )
    push("Type de projet workspace", ctx.document.projectTypeLabel);
  push("Discipline", ctx.discipline.label);
  push("Spécialité / sous-domaine", ctx.discipline.specialty);
  push("Volume prévisionnel", ctx.scope.expectedLengthLabel);
  push("Temps de rédaction disponible", ctx.scope.writingTimeLabel);
  if (ctx.scope.startDate) push("Date de démarrage", ctx.scope.startDate);
  if (ctx.scope.endDate) push("Échéance de rendu", ctx.scope.endDate);

  push("Présentation du sujet par l’auteur", ctx.research.presentation);
  push("Question de recherche", ctx.research.researchQuestion);
  if (ctx.research.hypotheses.length)
    push(
      "Hypothèses",
      ctx.research.hypotheses.map((h, i) => `${i + 1}. ${h}`).join("\n"),
    );
  push("Méthode envisagée", ctx.research.method);
  push("Terrain / corpus", ctx.research.fieldOrCorpus);
  if (ctx.research.keywords.length)
    push("Mots-clés", ctx.research.keywords.join(", "));
  if (ctx.research.risks.length)
    push("Risques / points de vigilance", ctx.research.risks.join(" ; "));
  if (ctx.research.topicTitle)
    push("Sujet retenu (titre)", ctx.research.topicTitle);

  if (ctx.collection.modeLabels.length)
    push(
      "Modes de recueil / types de matériaux",
      ctx.collection.modeLabels.join(" ; "),
    );
  push(
    "Combinaison des modes (précision de l’auteur)",
    ctx.collection.combinedNote,
  );

  if (ctx.workspace.chapters.length)
    push(
      "Chapitres déjà engagés",
      ctx.workspace.chapters
        .map((c) => `« ${c.title} » (${c.progress} %)`)
        .join(" ; "),
    );
  if (ctx.workspace.deadlines.length)
    push(
      "Échéances du projet",
      ctx.workspace.deadlines
        .map((d) => `${d.date} — ${d.title}`)
        .join(" ; "),
    );

  if (ctx.profile.length)
    push(
      "Profil (contraintes déclarées)",
      ctx.profile.map((p) => `${p.label} : ${p.value}`).join("\n"),
    );

  if (ctx.writingStructure.length)
    push(
      "Architecture typique du genre",
      ctx.writingStructure
        .map((s) => {
          const head = `- ${s.title}${s.role ? ` [${s.role}]` : ""} : ${s.intent}`;
          const subs = (s.subsections || [])
            .map((sub) => `  · ${sub.title} : ${sub.intent}`)
            .join("\n");
          return subs ? `${head}\n${subs}` : head;
        })
        .join("\n"),
    );

  push("Attentes du support visé", ctx.genreExpectations);
  push("Consignes spécifiques", ctx.specificInstructions);

  if (opts.includeRevision && ctx.revision) {
    push("Demande de révision du plan précédent", ctx.revision.feedback);
    if (ctx.revision.previousPlan.length)
      push(
        "Plan précédent (résumé)",
        ctx.revision.previousPlan
          .map((s) => `• ${s.title}${s.advice ? ` — ${s.advice}` : ""}`)
          .join("\n"),
      );
  }

  let text = parts.join("\n\n").trim();
  if (text.length > PROJECT_CONTEXT_MAX_CHARS)
    text = text.slice(0, PROJECT_CONTEXT_MAX_CHARS - 1).trimEnd() + "…";
  return text;
}

/**
 * Empreinte des seuls éléments qui changent le jugement de pertinence
 * (pas la révision ni les échéances).
 */
export function relevanceContextHash(ctx: ProjectContext): string {
  return hashUnitKey(
    [
      ctx.research.researchQuestion,
      ctx.research.hypotheses.join("\n"),
      ctx.document.typeLabel,
      ctx.discipline.label,
    ].join("|"),
  );
}

/** Pseudonymise les champs texte du contexte (présentation, questions, titres…). */
export function pseudonymizeProjectContext(
  ctx: ProjectContext,
  names: string[] = [],
): ProjectContext {
  const map: Record<string, string> = {};
  const one = (s: string) => {
    if (!s) return s;
    const { text } = pseudonymizeText(s, names, map);
    return text;
  };
  return {
    ...ctx,
    document: {
      ...ctx.document,
      projectTitle: one(ctx.document.projectTitle),
      typeLabel: ctx.document.typeLabel,
      projectTypeLabel: ctx.document.projectTypeLabel,
    },
    discipline: {
      ...ctx.discipline,
      specialty: one(ctx.discipline.specialty),
    },
    research: {
      ...ctx.research,
      presentation: one(ctx.research.presentation),
      researchQuestion: one(ctx.research.researchQuestion),
      hypotheses: ctx.research.hypotheses.map(one),
      method: one(ctx.research.method),
      fieldOrCorpus: one(ctx.research.fieldOrCorpus),
      keywords: ctx.research.keywords.map(one),
      risks: ctx.research.risks.map(one),
      topicTitle: ctx.research.topicTitle
        ? one(ctx.research.topicTitle)
        : undefined,
    },
    collection: {
      ...ctx.collection,
      combinedNote: one(ctx.collection.combinedNote),
    },
    workspace: {
      projectTitle: one(ctx.workspace.projectTitle),
      chapters: ctx.workspace.chapters.map((c) => ({
        ...c,
        title: one(c.title),
      })),
      deadlines: ctx.workspace.deadlines.map((d) => ({
        ...d,
        title: one(d.title),
      })),
    },
    profile: ctx.profile.map((p) => ({
      label: p.label,
      value: one(p.value),
    })),
    revision: ctx.revision
      ? {
          feedback: one(ctx.revision.feedback),
          previousPlan: ctx.revision.previousPlan.map((s) => ({
            title: one(s.title),
            advice: one(s.advice),
          })),
        }
      : undefined,
    writingStructure: ctx.writingStructure,
    genreExpectations: ctx.genreExpectations,
    specificInstructions: one(ctx.specificInstructions),
  };
}

/**
 * Préremplit le cadrage depuis un sujet retenu + réponses questionnaire.
 * Ne remplace jamais une valeur déjà saisie.
 */
export function draftFieldsFromTopic(
  topic: GeneratedTopic,
  answers: Record<string, unknown> = {},
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    chosenTopic: topic,
    interests: [
      topic.title,
      topic.research_question,
      "Mots-clés : " + (topic.keywords_fr || []).join(", "),
    ].join("\n\n"),
    aims: [
      topic.research_question,
      ...(topic.hypotheses || []).map((h) => "Hypothèse : " + h),
      topic.rationale,
    ].join("\n\n"),
    methods: [
      "Terrain / corpus : " + topic.field_or_corpus,
      "Méthode : " + topic.method,
      "Faisabilité : " + topic.feasibility.level,
      "Premiers pas : " + (topic.feasibility.first_steps || []).join(" ; "),
    ].join("\n\n"),
    literature: [...(topic.keywords_fr || []), ...(topic.keywords_en || [])].join(
      ", ",
    ),
    topicAnswers: pickTopicAnswersForDraft(answers),
  };

  if (!clip(existing.researchQuestion, 500))
    out.researchQuestion = clip(topic.research_question, 500);
  if (!clip(existing.workingTitle, 220) && topic.title)
    out.workingTitle = clip(topic.title, 220);
  if (
    !clip(existing.hypotheses, 1) &&
    !(Array.isArray(existing.hypotheses) && existing.hypotheses.length) &&
    (topic.hypotheses || []).length
  )
    out.hypotheses = (topic.hypotheses || []).slice(0, 5).join("\n");
  if (!clip(existing.method, 800) && topic.method)
    out.method = clip(topic.method, 800);
  if (!clip(existing.fieldOrCorpus, 800) && topic.field_or_corpus)
    out.fieldOrCorpus = clip(topic.field_or_corpus, 800);

  if (!clip(existing.documentType, 80)) {
    const pt = answers.project_type;
    if (typeof pt === "string" && pt.trim()) {
      out.documentType = normalizeProjectType(pt);
      if (out.documentType === "other") {
        const other = answers.project_type_other;
        if (typeof other === "string" && other.trim() && !existing.documentTypeOther)
          out.documentTypeOther = clip(other, 120);
      }
    }
  }

  if (!clip(existing.discipline, 80)) {
    const d = answers.discipline_main;
    if (typeof d === "string" && d.trim()) {
      out.discipline = d;
      if (d === "autre") {
        const other = answers.discipline_main_other;
        if (
          typeof other === "string" &&
          other.trim() &&
          !clip(existing.disciplineOther, 120)
        )
          out.disciplineOther = clip(other, 120);
      }
    }
  }

  if (!clip(existing.specialty, 300)) {
    const s = answers.specialty;
    if (typeof s === "string" && s.trim() && s !== SKIP_VALUE)
      out.specialty = clip(s, 300);
  }

  if (!clip(existing.expectedLength, 40)) {
    const el = answers.expected_length;
    if (typeof el === "string" && el.trim()) out.expectedLength = el;
  }

  return out;
}
