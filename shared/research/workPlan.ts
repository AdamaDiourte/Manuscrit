/**
 * Modèle unique de planning de travail / rédaction.
 * Fonction pure partagée front et back — sans effet de bord.
 */

import { z } from "zod";
import {
  WRITING_TIME_OPTIONS,
  documentTypeLabel,
  writingTimeLabel,
} from "./corpusOrganization";
import {
  PROJECT_TYPE_LABELS,
  normalizeProjectType,
  type ProjectTypeId,
} from "./documentStructures";
import {
  formatFieldworkPlanSummary,
  type FieldworkPlanItem,
} from "./fieldworkCosts";
import { topicQuestions } from "./topicQuestions";
import {
  clampSentence,
  clampWords,
  formatHoursFr,
  formatShortDateFr,
  formatWeekSpan,
} from "./planDisplay";

export const PHASE_ROLES = [
  "intro",
  "problem",
  "theory",
  "method",
  "fieldwork",
  "analysis",
  "discussion",
  "conclusion",
  "revision",
] as const;

export type PhaseRole = (typeof PHASE_ROLES)[number];

export const phaseRoleSchema = z.enum(PHASE_ROLES);

/** Section de plan (réponse IA ou structure type) — `role` toujours optionnel. */
export const workPlanSectionSchema = z.object({
  title: z.string().trim().min(1).max(220),
  advice: z.string().trim().max(4000).optional(),
  intent: z.string().trim().max(800).optional(),
  role: phaseRoleSchema.optional(),
  subsections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(220),
        advice: z.string().trim().max(4000).optional(),
        intent: z.string().trim().max(800).optional(),
      }),
    )
    .max(4)
    .optional(),
});

/**
 * Dictionnaire unique durée / rythme.
 * - writingTime et deadline_range → jours (milieu de plage pour les intervalles)
 * - weekly_time → heures / semaine
 * - Rythme absent → DEFAULT_WEEKLY_HOURS (7,5 h, profil « 5 à 10 h »)
 */
export const TIME_PROFILES = {
  writingTime: Object.fromEntries(
    WRITING_TIME_OPTIONS.map((o) => [o.value, o.days]),
  ) as Record<(typeof WRITING_TIME_OPTIONS)[number]["value"], number>,
  deadline_range: {
    /** Moins de 3 mois → milieu ≈ 1,5 mois */
    lt3m: 45,
    /** 3 à 6 mois → milieu ≈ 4,5 mois */
    "3to6m": 137,
    /** 6 à 12 mois → milieu ≈ 9 mois */
    "6to12m": 274,
    /** Plus d’un an (avant le palier 3 ans) → milieu ≈ 2 ans */
    gt1y: 730,
    /** Plus de 3 ans → repère ≈ 4 ans */
    gt3y: 1461,
  } as Record<string, number>,
  weekly_time: {
    lt5: 4,
    "5to10": 7.5,
    "10to20": 15,
    fulltime: 35,
  } as Record<string, number>,
  /** Heures / semaine si `weekly_time` est absent. */
  DEFAULT_WEEKLY_HOURS: 7.5,
  DEFAULT_WEEKLY_CODE: "5to10" as const,
} as const;

export type WorkPlanSectionInput = {
  title?: string;
  role?: PhaseRole;
  intent?: string;
  advice?: string;
  /** Sous-parties (affichage pilotage uniquement — pas de ligne Gantt). */
  subsections?: { title?: string; advice?: string; intent?: string }[];
};

export type WorkPlanInput = {
  sections?: WorkPlanSectionInput[];
  /** Code WRITING_TIME_OPTIONS (parcours corpus). */
  writingTime?: string;
  /** Code deadline_range (questionnaire sujets). */
  deadlineRange?: string;
  /** Code weekly_time ; défaut documenté si absent. */
  weeklyTime?: string;
  documentType?: string;
  documentTypeOther?: string;
  researchQuestion?: string;
  researchObject?: string;
  method?: string;
  field?: string;
  fieldworkPlan?: FieldworkPlanItem[];
  risks?: string[];
  firstSteps?: string[];
  /** ISO (YYYY-MM-DD ou datetime) ; aujourd’hui si absent. */
  startDate?: string;
  /**
   * ISO de fin (ex. jalon de rendu) — priorité sur startDate + durée.
   */
  endDate?: string;
  /**
   * Durée explicite en jours (ex. ancien `writingTimeDays`).
   * Prioritaire sur les codes writingTime / deadlineRange si ≥ 7.
   */
  totalDays?: number;
  /** Libellé de durée si `totalDays` est fourni sans code. */
  durationLabel?: string;
};

export type WorkPlanPhase = {
  index: number;
  sectionIndex?: number;
  role: PhaseRole;
  title: string;
  startDate: string;
  endDate: string;
  dayStart: number;
  dayEnd: number;
  weekStart: number;
  weekEnd: number;
  sharePct: number;
  hours: number;
  objective: string;
  deliverable: string;
  checkpoint: string;
  risk?: string;
  /** Sous-parties pour le tableau de pilotage (pas de barre Gantt dédiée). */
  subsections?: { title: string }[];
};

export type WorkPlan = {
  meta: {
    typeLabel: string;
    durationLabel: string;
    weeklyLabel: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    totalWeeks: number;
    hoursPerWeek: number;
    totalHours: number;
  };
  phases: WorkPlanPhase[];
  rhythm: string[];
  warnings: string[];
};

type PhaseContext = {
  method?: string;
  field?: string;
  risks?: string[];
  researchQuestion?: string;
  researchObject?: string;
  /** Résumé du plan de collecte (ex. « 20 entretien(s) »). */
  fieldworkSummary?: string;
};

type PhaseCopy = {
  objective: string;
  deliverable: string;
  checkpoint: string;
};

/** Libellé court sans coupure au milieu d’un mot ; pas de points de suspension. */
function shortSnippet(text: string | undefined, max = 90): string {
  const t = (text || "").replace(/\s+/g, " ").trim().replace(/[.!?…]+$/u, "");
  if (!t) return "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  if (at < Math.floor(max * 0.45)) return t.slice(0, max).trimEnd();
  return cut.slice(0, at).trimEnd();
}

function methodLabel(ctx: PhaseContext): string {
  const m = (ctx.method || "").trim();
  if (!m) return "";
  // Libellé court : jusqu’à la première virgule ou point.
  const first = m.split(/[,.;]/)[0]?.trim() || m;
  return shortSnippet(first, 60);
}

function fieldLabel(ctx: PhaseContext): string {
  const obj = (ctx.researchObject || "").trim();
  if (obj) {
    // Garder un groupe nominal lisible (avant la première virgule).
    const first = obj.split(/[,.;]/)[0]?.trim() || obj;
    return shortSnippet(first, 70);
  }
  const f = (ctx.field || "").trim();
  if (!f) return "";
  const first = f.split(/[,.;]/)[0]?.trim() || f;
  return shortSnippet(first, 70);
}

function optionLabel(
  questionId: string,
  value: string | undefined,
): string {
  if (!value) return "";
  const q = topicQuestions.find((item) => item.id === questionId);
  return q?.options?.find((o) => o.value === value)?.label || "";
}

/**
 * Retire la ponctuation finale avant concaténation (évite « .. »).
 * Dans les guillemets, retire aussi le point avant » (pas de « texte. »).
 */
export function joinSentences(
  ...parts: Array<string | null | undefined | false>
): string {
  const cleaned = parts
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      p
        .replace(/«\s*([^»]*?)[.!?…]+\s*»/gu, "« $1 »")
        .replace(/[.!?…]+$/u, "")
        .trim(),
    )
    .filter(Boolean);
  if (!cleaned.length) return "";
  return `${cleaned.join(". ")}.`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseStartDate(iso?: string): Date {
  if (iso && String(iso).trim()) {
    const raw = String(iso).trim();
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dayOnly) {
      return new Date(
        Date.UTC(
          Number(dayOnly[1]),
          Number(dayOnly[2]) - 1,
          Number(dayOnly[3]),
        ),
      );
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return startOfUtcDay(parsed);
  }
  return startOfUtcDay(new Date());
}

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Déduit un rôle à partir du titre (mêmes indices que l’ancien sectionWeight). */
export function inferPhaseRole(
  title: string,
  index: number,
  total: number,
): PhaseRole {
  const t = title.toLowerCase();
  if (/terrain|empirique|observation|enqu[eê]te/.test(t) && !/analys/.test(t))
    return "fieldwork";
  if (/analys|r[eé]sultat|empir/.test(t)) return "analysis";
  if (/discussion/.test(t) && !/conclu/.test(t)) return "discussion";
  if (/m[eé]thode|mat[eé]riau|corpus|dispositif|design de recherche|d[eé]marche/.test(t))
    return "method";
  if (/cadre th[eé]or|revue|litt[eé]rature|[eé]tat de l’art|[eé]tat des lieux|notions cl[eé]/.test(t))
    return "theory";
  if (/intro|cadrage|positionnement|accroche|enjeux|contribution|contexte/.test(t))
    return "intro";
  if (/probl[eé]mat|hypoth|questions?/.test(t)) return "problem";
  if (/conclu|synth[eè]se|limite|ouverture|bilan|perspectives|livrables/.test(t))
    return "conclusion";
  if (/relecture|ajustement|r[eé]vision|finalisation/.test(t)) return "revision";
  if (index === 0) return "intro";
  if (index === total - 1) return "conclusion";
  /** Rôle générique si le titre ne matche aucune regex. */
  return "analysis";
}

function roleWeight(role: PhaseRole, index: number, total: number): number {
  switch (role) {
    case "analysis":
    case "fieldwork":
    case "discussion":
      return 1.45;
    case "method":
    case "theory":
      return 1.15;
    case "intro":
    case "problem":
      return 0.85;
    case "conclusion":
      return 0.75;
    case "revision":
      return 1;
    default:
      if (index === 0) return 0.85;
      if (index === total - 1) return 0.8;
      return 1;
  }
}

/**
 * Contenu distinct par rôle — langage clair pour l’étudiant.
 * Terrain, méthode et matériau sont injectés quand disponibles.
 */
export const PHASE_CONTENT: Record<
  PhaseRole,
  (ctx: PhaseContext) => PhaseCopy
> = {
  intro: (ctx) => {
    const obj = fieldLabel(ctx);
    return {
      objective: clampSentence(
        obj
          ? `Clarifier l’objet de votre travail : ${obj}`
          : `Clarifier l’objet de votre travail et ce que vous voulez montrer`,
        160,
      ),
      deliverable: clampWords("Note d’ouverture : enjeu et fil conducteur", 12),
      checkpoint: clampWords("Valider le cadrage avec votre encadrement", 15),
    };
  },
  problem: (ctx) => ({
    objective: clampSentence(
      ctx.researchQuestion
        ? `Stabiliser votre question : ${shortSnippet(ctx.researchQuestion, 100)}`
        : `Formuler une question de recherche claire et testable`,
      160,
    ),
    deliverable: clampWords("Fiche problématique et hypothèses", 12),
    checkpoint: clampWords("Valider la formulation avant la collecte", 15),
  }),
  theory: (ctx) => {
    const method = methodLabel(ctx);
    const field = fieldLabel(ctx);
    const bits = [
      "Rédiger le cadre théorique et la méthodologie",
      method ? `pour la méthode « ${method} »` : "",
      field ? `appliquée à « ${field} »` : "",
    ].filter(Boolean);
    return {
      objective: clampSentence(bits.join(" "), 180),
      deliverable: clampWords(
        "Brouillon du cadre théorique et de la méthodologie",
        14,
      ),
      checkpoint: clampWords(
        "Faire relire ce chapitre par votre encadrement",
        15,
      ),
    };
  },
  method: (ctx) => {
    const method = methodLabel(ctx);
    const field = fieldLabel(ctx);
    const bits = [
      "Préparer le protocole de collecte",
      method ? `selon « ${method} »` : "",
      field ? `pour « ${field} »` : "",
      ctx.fieldworkSummary ? `en visant ${ctx.fieldworkSummary}` : "",
    ].filter(Boolean);
    return {
      objective: clampSentence(bits.join(" "), 180),
      deliverable: clampWords("Grille, autorisations et fiche protocole", 12),
      checkpoint: clampWords(
        "Valider faisabilité, accès et éthique avec l’encadrement",
        15,
      ),
    };
  },
  fieldwork: (ctx) => {
    const field = fieldLabel(ctx);
    const method = methodLabel(ctx);
    const bits = [
      ctx.fieldworkSummary && field
        ? `Mener ${ctx.fieldworkSummary} auprès de « ${field} »`
        : ctx.fieldworkSummary
          ? `Mener ${ctx.fieldworkSummary}`
          : field
            ? `Réaliser la collecte sur « ${field} »`
            : "Réaliser la collecte prévue pour votre sujet",
      method ? `avec « ${method} »` : "",
    ].filter(Boolean);
    return {
      objective: clampSentence(bits.join(" "), 180),
      deliverable: clampWords("Journal de terrain ou corpus indexé", 12),
      checkpoint: clampWords("Faire le point sur l’accès et le calendrier", 15),
    };
  },
  analysis: (ctx) => {
    const method = methodLabel(ctx);
    const bits = [
      "Analyser les matériaux recueillis",
      method ? `avec « ${method} »` : "",
      ctx.fieldworkSummary ? `à partir de ${ctx.fieldworkSummary}` : "",
    ].filter(Boolean);
    return {
      objective: clampSentence(bits.join(" "), 160),
      deliverable: clampWords("Tableau de résultats et extraits cités", 12),
      checkpoint: clampWords(
        "Relire preuves et progression avec l’encadrement",
        15,
      ),
    };
  },
  discussion: (ctx) => ({
    objective: clampSentence(
      ctx.researchQuestion
        ? "Rédiger les résultats et la discussion en répondant à votre question de recherche"
        : "Rédiger les résultats et la discussion à partir de votre analyse",
      160,
    ),
    deliverable: clampWords("Brouillon des résultats et de la discussion", 12),
    checkpoint: clampWords(
      "Vérifier que chaque affirmation s’appuie sur vos données",
      15,
    ),
  }),
  conclusion: () => ({
    objective: clampSentence(
      "Synthétiser la réponse à votre question sans ajouter de nouveaux résultats",
      140,
    ),
    deliverable: clampWords("Conclusion et checklist de forme", 12),
    checkpoint: clampWords("Lecture d’ensemble avant dépôt", 15),
  }),
  revision: () => ({
    objective: clampSentence(
      "Relire le fil, les citations et les normes avant le rendu",
      120,
    ),
    deliverable: clampWords("Version finale corrigée", 12),
    checkpoint: clampWords("Intégrer les retours et figer le fichier", 15),
  }),
};

/**
 * Parts du budget hors collecte et analyse (modifiables).
 * Somme = 1. Appliquées au reste après estimated_hours.
 */
export const NON_FIELDWORK_BUDGET_SHARES = {
  /** Cadrage et lectures (role theory). */
  framing: 0.25,
  /** Préparation du terrain (role method). */
  field_prep: 0.08,
  /** Rédaction (role discussion / conclusion / intro). */
  writing: 0.55,
  /** Relecture (role revision). */
  revision: 0.12,
} as const;

/** La relecture ne doit pas dépasser cette part du budget total. */
export const MAX_REVISION_SHARE_OF_TOTAL = 0.15;

/** Charge minimale indicative (heures) selon le genre — pour les avertissements. */
const MIN_HOURS_BY_TYPE: Partial<Record<ProjectTypeId, number>> = {
  licence: 80,
  m1: 120,
  m2: 180,
  pro: 140,
  internship: 70,
  thesis: 600,
  article: 60,
  book: 250,
  talk: 30,
  research_dossier: 90,
  reading_sheet: 25,
  other: 80,
};

/** Pourcentages entiers via la méthode du plus fort reste (somme = 100). */
export function largestRemainderPercents(
  parts: number[],
  total: number,
): number[] {
  if (!parts.length) return [];
  const safeTotal = total > 0 ? total : 1;
  const exact = parts.map((p) => (Math.max(0, p) / safeTotal) * 100);
  const floored = exact.map((e) => Math.floor(e));
  let left = 100 - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - floored[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floored];
  for (let k = 0; k < left; k += 1) {
    out[order[k % order.length].i] += 1;
  }
  return out;
}

function resolveDurationDays(input: WorkPlanInput): {
  days: number;
  durationLabel: string;
} {
  const explicit = Number(input.totalDays) || 0;
  if (explicit >= 7) {
    return {
      days: explicit,
      durationLabel:
        (input.durationLabel || "").trim() ||
        writingTimeLabel(input.writingTime) ||
        optionLabel("deadline_range", input.deadlineRange) ||
        `${explicit} jours`,
    };
  }
  if (input.writingTime) {
    const fromProfile =
      TIME_PROFILES.writingTime[
        input.writingTime as keyof typeof TIME_PROFILES.writingTime
      ];
    const days = Number(fromProfile) || 0;
    return {
      days,
      durationLabel: writingTimeLabel(input.writingTime) || `${days} jours`,
    };
  }
  if (input.deadlineRange) {
    const days = TIME_PROFILES.deadline_range[input.deadlineRange] || 0;
    const label =
      optionLabel("deadline_range", input.deadlineRange) || `${days} jours`;
    return { days, durationLabel: label };
  }
  return { days: 0, durationLabel: "" };
}

function resolveWeekly(input: WorkPlanInput): {
  hoursPerWeek: number;
  weeklyLabel: string;
} {
  if (input.weeklyTime && TIME_PROFILES.weekly_time[input.weeklyTime] != null) {
    return {
      hoursPerWeek: TIME_PROFILES.weekly_time[input.weeklyTime],
      weeklyLabel:
        optionLabel("weekly_time", input.weeklyTime) ||
        `${TIME_PROFILES.weekly_time[input.weeklyTime]} h / semaine`,
    };
  }
  return {
    hoursPerWeek: TIME_PROFILES.DEFAULT_WEEKLY_HOURS,
    weeklyLabel:
      optionLabel("weekly_time", TIME_PROFILES.DEFAULT_WEEKLY_CODE) ||
      "5 à 10 h (valeur par défaut)",
  };
}

function buildRhythm(hoursPerWeek: number, totalWeeks: number): string[] {
  if (hoursPerWeek <= 5) {
    return [
      "Deux créneaux courts (environ 2 h) plutôt qu’une longue séance fatigante",
      "Une relecture de 30 minutes en fin de semaine pour noter les blocages",
      "Reporter les tâches administratives (normes, bibliographie) aux semaines plus légères",
    ];
  }
  if (hoursPerWeek <= 10) {
    return [
      "Un bloc de rédaction de 3 à 4 h en début de semaine",
      "Un créneau d’analyse ou de lectures ciblées en milieu de semaine",
      "Une revue de livrable (1 h) avant le week-end pour préparer le point d’encadrement",
    ];
  }
  if (hoursPerWeek <= 20) {
    return [
      "Alterner journées « production » (brouillon) et journées « preuve » (extraits, tableaux)",
      "Réserver 2 h hebdomadaires à la bibliographie et aux normes",
      totalWeeks >= 12
        ? "Planifier une semaine tampon tous les deux mois pour absorber les retards"
        : "Garder une demi-journée tampon avant chaque jalon de rendu interne",
    ];
  }
  return [
    "Traiter la rédaction comme un mi-temps structuré : matin production, après-midi relecture",
    "Fixer un livrable interne chaque vendredi (même court)",
    "Prévoir des pauses de relecture croisée avec l’encadrement à rythme bi-mensuel",
  ];
}

function buildWarnings(input: {
  totalDays: number;
  totalHours: number;
  documentType?: string;
  typeLabel: string;
}): string[] {
  const warnings: string[] = [];
  if (input.totalDays < 30) {
    warnings.push(
      "Durée très courte : ce calendrier est indicatif et devra probablement être recentré avec votre encadrement sur l’essentiel.",
    );
  }
  const typeId = normalizeProjectType(input.documentType);
  const minHours = MIN_HOURS_BY_TYPE[typeId] ?? 80;
  if (input.totalHours < minHours) {
    warnings.push(
      joinSentences(
        `Charge horaire totale estimée (${Math.round(input.totalHours)} h) faible pour un ${input.typeLabel}`,
        "Priorisez les livrables centraux et validez le périmètre avec votre encadrement",
      ),
    );
  }
  return warnings;
}

/**
 * Construit un planning unifié.
 * Retourne `null` si durée &lt; 7 jours ou aucune section titrée (même règle qu’aujourd’hui).
 */
export function buildWorkPlan(input: WorkPlanInput): WorkPlan | null {
  const { days: profileDays, durationLabel } = resolveDurationDays(input);
  const sections = (input.sections || []).filter((s) =>
    String(s.title || "").trim(),
  );
  if (!sections.length) return null;

  const start = parseStartDate(input.startDate);
  let totalDays = profileDays;
  let end = addDaysUtc(start, Math.max(profileDays, 1) - 1);

  if (input.endDate && String(input.endDate).trim()) {
    const parsedEnd = parseStartDate(input.endDate);
    const diffMs = parsedEnd.getTime() - start.getTime();
    const span = Math.floor(diffMs / 86_400_000) + 1;
    if (span >= 7) {
      totalDays = span;
      end = parsedEnd;
    }
  }

  if (totalDays < 7) return null;

  const { hoursPerWeek, weeklyLabel } = resolveWeekly(input);
  const totalWeeks = Math.round((totalDays / 7) * 10) / 10;
  const totalHours = Math.round(hoursPerWeek * (totalDays / 7) * 10) / 10;
  const typeLabel =
    documentTypeLabel(input.documentType, input.documentTypeOther) ||
    PROJECT_TYPE_LABELS[normalizeProjectType(input.documentType)];

  // Relecture : part calendaire bornée (≤ MAX_REVISION_SHARE_OF_TOTAL).
  const revisionShare = Math.min(
    NON_FIELDWORK_BUDGET_SHARES.revision,
    MAX_REVISION_SHARE_OF_TOTAL,
  );
  const revisionDays = clamp(
    Math.round(totalDays * revisionShare),
    2,
    Math.floor(totalDays * MAX_REVISION_SHARE_OF_TOTAL),
  );
  const draftingDays = Math.max(sections.length, totalDays - revisionDays);

  const roles = sections.map((s, i) =>
    s.role && PHASE_ROLES.includes(s.role)
      ? s.role
      : inferPhaseRole(String(s.title || ""), i, sections.length),
  );
  const weights = roles.map((role, i) =>
    roleWeight(role, i, sections.length),
  );
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  let cursor = 1;
  let allocated = 0;
  const daySpans: number[] = [];
  const rawEnds: number[] = [];
  sections.forEach((_, i) => {
    const share =
      i === sections.length - 1
        ? Math.max(1, draftingDays - allocated)
        : Math.max(1, Math.round((weights[i] / weightSum) * draftingDays));
    allocated += share;
    const dayStart = cursor;
    const dayEnd = Math.min(draftingDays, dayStart + share - 1);
    daySpans.push(Math.max(1, dayEnd - dayStart + 1));
    rawEnds.push(dayEnd);
    cursor = dayEnd + 1;
  });

  const revisionSpan = Math.max(1, totalDays - draftingDays);
  const allSpans = [...daySpans, revisionSpan];
  const percents = largestRemainderPercents(allSpans, totalDays);

  const fieldworkSummary = formatFieldworkPlanSummary(
    input.fieldworkPlan || [],
  ).trim();
  const ctx: PhaseContext = {
    method: (input.method || "").trim() || undefined,
    field: (input.field || "").trim() || undefined,
    risks: (input.risks || []).map((r) => String(r).trim()).filter(Boolean),
    researchQuestion: (input.researchQuestion || "").trim() || undefined,
    researchObject: (input.researchObject || "").trim() || undefined,
    fieldworkSummary: fieldworkSummary || undefined,
  };
  if (ctx.risks && !ctx.risks.length) delete ctx.risks;

  const phases: WorkPlanPhase[] = sections.map((s, i) => {
    const dayStart = i === 0 ? 1 : rawEnds[i - 1] + 1;
    const dayEnd = rawEnds[i];
    const span = daySpans[i];
    const sharePct = percents[i];
    const hours =
      Math.round(((sharePct / 100) * totalHours) * 10) / 10;
    const role = roles[i];
    const copy = PHASE_CONTENT[role](ctx);
    const phaseStart = addDaysUtc(start, dayStart - 1);
    const phaseEnd = addDaysUtc(start, dayEnd - 1);
    const risk =
      role === "fieldwork" || role === "analysis" || role === "discussion"
        ? ctx.risks?.[0]
        : undefined;
    const subsections = (s.subsections || [])
      .map((sub) => ({ title: String(sub.title || "").trim() }))
      .filter((sub) => sub.title);
    return {
      index: i,
      sectionIndex: i,
      role,
      title: String(s.title || `Section ${i + 1}`).trim(),
      startDate: toISODate(phaseStart),
      endDate: toISODate(phaseEnd),
      dayStart,
      dayEnd,
      weekStart: Math.ceil(dayStart / 7),
      weekEnd: Math.ceil(dayEnd / 7),
      sharePct,
      hours,
      objective: copy.objective,
      deliverable: copy.deliverable,
      checkpoint: copy.checkpoint,
      ...(risk ? { risk } : {}),
      ...(subsections.length ? { subsections } : {}),
    };
  });

  const revCopy = PHASE_CONTENT.revision(ctx);
  const revStartDay = draftingDays + 1;
  const revEndDay = totalDays;
  const revShare = percents[percents.length - 1];
  phases.push({
    index: phases.length,
    role: "revision",
    title: "Relecture et ajustements",
    startDate: toISODate(addDaysUtc(start, revStartDay - 1)),
    endDate: toISODate(addDaysUtc(start, revEndDay - 1)),
    dayStart: revStartDay,
    dayEnd: revEndDay,
    weekStart: Math.ceil(revStartDay / 7),
    weekEnd: Math.ceil(revEndDay / 7),
    sharePct: revShare,
    hours: Math.round(((revShare / 100) * totalHours) * 10) / 10,
    objective: revCopy.objective,
    deliverable: revCopy.deliverable,
    checkpoint: revCopy.checkpoint,
  });

  // Réajustement éventuel des heures pour coller au total (arrondis).
  const hoursSum = phases.reduce((a, p) => a + p.hours, 0);
  const drift = Math.round((totalHours - hoursSum) * 10) / 10;
  if (drift !== 0 && phases.length) {
    const last = phases[phases.length - 1];
    last.hours = Math.round((last.hours + drift) * 10) / 10;
  }

  return {
    meta: {
      typeLabel,
      durationLabel: durationLabel || `${totalDays} jours`,
      weeklyLabel,
      startDate: toISODate(start),
      endDate: toISODate(end),
      totalDays,
      totalWeeks,
      hoursPerWeek,
      totalHours,
    },
    phases,
    rhythm: buildRhythm(hoursPerWeek, totalWeeks),
    warnings: buildWarnings({
      totalDays,
      totalHours,
      documentType: input.documentType,
      typeLabel,
    }),
  };
}

/** Libellé court d’une date ISO (usage UI / export) : « 19 nov. 2026 ». */
export function workPlanDateLabel(iso: string): string {
  return formatShortDateFr(iso);
}

/**
 * Repère un jalon de rendu dans `project.dates`.
 * Prend la date la plus tardive dont le titre évoque un rendu / dépôt / soutenance.
 */
export function findSubmissionEndDate(
  dates?: { title?: string; date?: string }[] | null,
): string | undefined {
  if (!Array.isArray(dates) || !dates.length) return undefined;
  const matched = dates
    .filter((d) => {
      const date = String(d?.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
      const title = String(d?.title || "");
      return /rendu|d[eé]p[oô]t|soutenance|remise|deadline|livrable final|version finale|date limite/i.test(
        title,
      );
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = matched[matched.length - 1];
  return last?.date ? String(last.date).slice(0, 10) : undefined;
}

/**
 * Charge hebdomadaire par semaine calendaire du plan (chevauchements compris).
 * Chaque phase répartit sa charge uniformément sur ses semaines.
 */
export function weeklyLoadByWeek(plan: WorkPlan): number[] {
  const maxWeek = Math.max(
    1,
    Math.ceil(plan.meta.totalWeeks) || 1,
    ...plan.phases.map((p) => p.weekEnd || 1),
  );
  const load = Array.from({ length: maxWeek + 1 }, () => 0);
  for (const phase of plan.phases) {
    const start = Math.max(1, phase.weekStart || 1);
    const end = Math.max(start, phase.weekEnd || start);
    const span = end - start + 1;
    const perWeek = (Number(phase.hours) || 0) / span;
    for (let w = start; w <= end; w++) {
      load[w] = Math.round((load[w] + perWeek) * 10) / 10;
    }
  }
  return load;
}

/** Heures / semaine pour une phase seule (charge / nombre de semaines). */
export function phaseHoursPerWeek(phase: WorkPlanPhase): number {
  const start = Math.max(1, phase.weekStart || 1);
  const end = Math.max(start, phase.weekEnd || start);
  const span = end - start + 1;
  return Math.round(((Number(phase.hours) || 0) / span) * 10) / 10;
}

export function planLoadSummary(plan: WorkPlan): {
  averageHoursPerWeek: number;
  peakHoursPerWeek: number;
  peakWeek: number;
  overloadedWeeks: number[];
  budgetHoursPerWeek: number;
} {
  const load = weeklyLoadByWeek(plan);
  const weeks = load.slice(1);
  const budget = plan.meta.hoursPerWeek;
  const threshold = budget * 1.25;
  let sum = 0;
  let peak = 0;
  let peakWeek = 1;
  const overloaded: number[] = [];
  weeks.forEach((h, i) => {
    sum += h;
    if (h > peak) {
      peak = h;
      peakWeek = i + 1;
    }
    if (h > threshold) overloaded.push(i + 1);
  });
  const n = weeks.length || 1;
  return {
    averageHoursPerWeek: Math.round((sum / n) * 10) / 10,
    peakHoursPerWeek: Math.round(peak * 10) / 10,
    peakWeek,
    overloadedWeeks: overloaded,
    budgetHoursPerWeek: budget,
  };
}

export function planLoadSummarySentence(plan: WorkPlan): string {
  const s = planLoadSummary(plan);
  return `Charge moyenne : ${formatHoursFr(s.averageHoursPerWeek)} par semaine ; semaine la plus chargée : ${formatHoursFr(s.peakHoursPerWeek)} (budget déclaré : ${formatHoursFr(s.budgetHoursPerWeek)} par semaine).`;
}

/**
 * Allonge les phases en surcharge d’une semaine à la fois vers l’aval
 * (semaines les moins chargées), sans dépasser la date de rendu ni
 * changer le total d’heures.
 */
export function rebalanceOverloadedPhases(plan: WorkPlan): WorkPlan {
  const budget = plan.meta.hoursPerWeek;
  const threshold = budget * 1.25;
  const maxWeek = Math.max(
    1,
    Math.ceil(plan.meta.totalWeeks) || 1,
    ...plan.phases.map((p) => p.weekEnd || 1),
  );
  const phases = plan.phases.map((p) => ({ ...p }));
  let anyChange = false;

  for (let pass = 0; pass < maxWeek * 2; pass++) {
    const load = weeklyLoadByWeek({ ...plan, phases });
    const overloaded = load
      .map((h, w) => ({ h, w }))
      .filter((x) => x.w >= 1 && x.h > threshold)
      .sort((a, b) => b.h - a.h);
    if (!overloaded.length) break;

    const { w } = overloaded[0];
    // Phase la plus intensive sur cette semaine, encore extensible.
    const candidates = phases
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p }) =>
          p.weekStart <= w && p.weekEnd >= w && p.weekEnd < maxWeek,
      )
      .sort(
        (a, b) => phaseHoursPerWeek(b.p) - phaseHoursPerWeek(a.p),
      );
    if (!candidates.length) break;

    const target = candidates[0];
    const newEnd = target.p.weekEnd + 1;
    // Choisit la cible d’extension qui baisse le plus le pic global.
    let bestIdx = target.i;
    let bestPeak = Math.max(...load.slice(1));
    for (const c of candidates.slice(0, 3)) {
      const trial = phases.map((p, i) =>
        i === c.i
          ? {
              ...p,
              weekEnd: p.weekEnd + 1,
              dayEnd: Math.min(plan.meta.totalDays, p.dayEnd + 7),
            }
          : p,
      );
      if (trial[c.i].weekEnd > maxWeek) continue;
      const trialLoad = weeklyLoadByWeek({ ...plan, phases: trial });
      const peak = Math.max(...trialLoad.slice(1));
      if (peak < bestPeak) {
        bestPeak = peak;
        bestIdx = c.i;
      }
    }

    const cur = phases[bestIdx];
    if (cur.weekEnd >= maxWeek) break;
    phases[bestIdx] = {
      ...cur,
      weekEnd: cur.weekEnd + 1,
      dayEnd: Math.min(plan.meta.totalDays, cur.dayEnd + 7),
    };
    anyChange = true;
  }

  if (!anyChange) return plan;

  const startMs = Date.parse(plan.meta.startDate + "T12:00:00");
  for (const p of phases) {
    if (!Number.isFinite(startMs)) break;
    const endMs = startMs + (p.dayEnd - 1) * 86400000;
    const capped = Math.min(
      endMs,
      Date.parse(plan.meta.endDate + "T12:00:00") || endMs,
    );
    p.endDate = new Date(capped).toISOString().slice(0, 10);
  }

  return { ...plan, phases };
}

/** Tableau de pilotage compact pour le plan de travail (secours / Word). */
export function workPlanToScheduleTable(plan: WorkPlan): {
  headers: string[];
  rows: string[][];
} {
  const load = weeklyLoadByWeek(plan);
  return {
    headers: [
      "Phase",
      "Période",
      "Objectif",
      "Livrable",
      "Point d’encadrement",
      "Charge",
      "Heures par semaine",
    ],
    rows: plan.phases.map((phase) => {
      // Moyenne de la charge globale sur les semaines de la phase (chevauchements).
      let sum = 0;
      let n = 0;
      for (let w = phase.weekStart; w <= phase.weekEnd; w++) {
        sum += load[w] || 0;
        n += 1;
      }
      const weekly =
        n > 0
          ? Math.round((sum / n) * 10) / 10
          : phaseHoursPerWeek(phase);
      return [
        `${phase.index + 1}. ${phase.title}`,
        `${formatShortDateFr(phase.startDate)} → ${formatShortDateFr(phase.endDate)} (${formatWeekSpan(phase.weekStart, phase.weekEnd)})`,
        phase.objective,
        phase.deliverable,
        phase.checkpoint,
        formatHoursFr(phase.hours),
        formatHoursFr(weekly),
      ];
    }),
  };
}

/**
 * Phases d’un plan de travail de recherche (déroulement, pas chapitres).
 * La rédaction du cadre théorique / méthodo chevauche la collecte ;
 * la rédaction des résultats vient après l’analyse.
 */
export const RESEARCH_WORK_PLAN_SECTIONS: WorkPlanSectionInput[] = [
  {
    title: "Cadrage et lectures",
    role: "intro",
    intent:
      "Cadrer la question et commencer les lectures utiles au sujet.",
  },
  {
    title: "Préparation du terrain",
    role: "method",
    intent:
      "Préparer grille ou questionnaire, autorisations et accès au terrain.",
  },
  {
    title: "Collecte",
    role: "fieldwork",
    intent:
      "Recueillir les matériaux prévus sur le terrain ou le corpus retenu.",
  },
  {
    title: "Rédaction du cadre théorique et de la méthodologie",
    role: "theory",
    intent:
      "Rédiger cadre théorique et méthodologie pendant la collecte (chevauchement).",
  },
  {
    title: "Analyse",
    role: "analysis",
    intent: "Traiter et interpréter les matériaux collectés.",
  },
  {
    title: "Rédaction des résultats et de la discussion",
    role: "discussion",
    intent:
      "Rédiger les résultats et la discussion après l’analyse ; finaliser l’introduction ici.",
  },
];

/** Parse une durée d’accès terrain (« N mois », « N semaines ») → semaines. */
export function parseFieldAccessWeeks(fieldAccess: unknown): number | null {
  if (typeof fieldAccess !== "string" || !fieldAccess.trim()) return null;
  const t = fieldAccess
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const months = t.match(/(\d+)\s*mois/);
  if (months) {
    const n = Number(months[1]);
    if (Number.isFinite(n) && n > 0) return n * 4;
  }
  const weeks = t.match(/(\d+)\s*semaines?/);
  if (weeks) {
    const n = Number(weeks[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function topicDependsOnFieldAccess(
  fieldOrCorpus: string | undefined,
  fieldAccess: string,
): boolean {
  const field = (fieldOrCorpus || "").toLowerCase();
  if (!field.trim() || !fieldAccess.trim()) return false;
  if (/stage|m[eé]diath[eè]que|biblioth|terrain|structure|accueil/i.test(field))
    return true;
  const accessTokens = fieldAccess
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const fieldNorm = field
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let hits = 0;
  for (const tok of accessTokens) {
    if (fieldNorm.includes(tok)) hits += 1;
  }
  return hits >= 2;
}

/**
 * Réassigne les heures : collecte + analyse ≈ estimated_hours ;
 * le reste selon NON_FIELDWORK_BUDGET_SHARES (cadrage, préparation,
 * rédaction, relecture). Contrôle : relecture ≤ MAX_REVISION_SHARE_OF_TOTAL.
 */
export function applyEstimatedHoursToPhases(
  plan: WorkPlan,
  estimatedHours: number,
): WorkPlan {
  const target = Math.max(1, Math.round(estimatedHours * 10) / 10);
  const total = plan.meta.totalHours;
  const fieldIdx = plan.phases.findIndex((p) => p.role === "fieldwork");
  const analysisIdx = plan.phases.findIndex((p) => p.role === "analysis");
  if (fieldIdx < 0 && analysisIdx < 0) return plan;

  const fieldShare = fieldIdx >= 0 && analysisIdx >= 0 ? 0.55 : 1;
  const analysisShare = fieldIdx >= 0 && analysisIdx >= 0 ? 0.45 : 1;
  const phases = plan.phases.map((p) => ({ ...p }));

  if (fieldIdx >= 0) {
    phases[fieldIdx].hours = Math.round(target * fieldShare * 10) / 10;
  }
  if (analysisIdx >= 0) {
    phases[analysisIdx].hours = Math.round(target * analysisShare * 10) / 10;
  }
  // Ajuster le couple pour coller exactement à target.
  if (fieldIdx >= 0 && analysisIdx >= 0) {
    const pair =
      phases[fieldIdx].hours + phases[analysisIdx].hours;
    const drift = Math.round((target - pair) * 10) / 10;
    phases[analysisIdx].hours =
      Math.round((phases[analysisIdx].hours + drift) * 10) / 10;
  }

  const usedField =
    (fieldIdx >= 0 ? phases[fieldIdx].hours : 0) +
    (analysisIdx >= 0 ? phases[analysisIdx].hours : 0);
  let remaining = Math.max(0, Math.round((total - usedField) * 10) / 10);

  const theoryIdx = phases.findIndex((p) => p.role === "theory");
  const methodIdx = phases.findIndex((p) => p.role === "method");
  const revisionIdx = phases.findIndex((p) => p.role === "revision");
  const writingIdx = phases
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        i !== fieldIdx &&
        i !== analysisIdx &&
        i !== theoryIdx &&
        i !== methodIdx &&
        i !== revisionIdx,
    )
    .map(({ i }) => i);

  const shares = NON_FIELDWORK_BUDGET_SHARES;
  let framingH = Math.round(remaining * shares.framing * 10) / 10;
  let prepH = Math.round(remaining * shares.field_prep * 10) / 10;
  let writingH = Math.round(remaining * shares.writing * 10) / 10;
  let revisionH = Math.round(remaining * shares.revision * 10) / 10;

  const maxRevision =
    Math.round(total * MAX_REVISION_SHARE_OF_TOTAL * 10) / 10;
  if (revisionH > maxRevision) {
    const excess = Math.round((revisionH - maxRevision) * 10) / 10;
    revisionH = maxRevision;
    writingH = Math.round((writingH + excess) * 10) / 10;
  }

  // Coller exactement au remaining (arrondis).
  const assigned = framingH + prepH + writingH + revisionH;
  const driftRem = Math.round((remaining - assigned) * 10) / 10;
  writingH = Math.round((writingH + driftRem) * 10) / 10;

  if (theoryIdx >= 0) phases[theoryIdx].hours = Math.max(0.5, framingH);
  if (methodIdx >= 0) phases[methodIdx].hours = Math.max(0.5, prepH);
  if (revisionIdx >= 0) phases[revisionIdx].hours = Math.max(0.5, revisionH);
  if (writingIdx.length) {
    const per =
      Math.round((writingH / writingIdx.length) * 10) / 10;
    let allocated = 0;
    writingIdx.forEach((i, k) => {
      const h =
        k === writingIdx.length - 1
          ? Math.round((writingH - allocated) * 10) / 10
          : per;
      phases[i].hours = Math.max(0.5, h);
      allocated += phases[i].hours;
    });
  }

  // Recalcule sharePct approximatif.
  const hoursSum = phases.reduce((a, p) => a + p.hours, 0) || 1;
  for (const p of phases) {
    p.sharePct = Math.round((p.hours / hoursSum) * 1000) / 10;
  }

  return { ...plan, phases };
}

/**
 * Chevauchement calendaire : rédaction du cadre théorique et de la
 * méthodologie pendant la collecte (même fenêtre que le terrain).
 */
function applyTheoryMethodOverlap(plan: WorkPlan): WorkPlan {
  const phases = plan.phases.map((p) => ({ ...p }));
  const theoryIdx = phases.findIndex((p) => p.role === "theory");
  const methodIdx = phases.findIndex((p) => p.role === "method");
  const fieldIdx = phases.findIndex((p) => p.role === "fieldwork");
  if (fieldIdx < 0) return plan;

  const field = phases[fieldIdx];
  const fieldSpan = Math.max(1, field.dayEnd - field.dayStart + 1);
  const start = parseStartDate(plan.meta.startDate);

  if (methodIdx >= 0) {
    const extend = Math.max(4, Math.floor(fieldSpan * 0.65));
    // Préparation avant + début de collecte.
    phases[methodIdx].dayEnd = Math.min(
      field.dayEnd,
      field.dayStart + extend - 1,
    );
    if (phases[methodIdx].dayEnd < phases[methodIdx].dayStart) {
      phases[methodIdx].dayEnd = phases[methodIdx].dayStart;
    }
  }

  if (theoryIdx >= 0) {
    // Cadre théorique / méthodo : parallèle à la collecte.
    phases[theoryIdx].dayStart = field.dayStart;
    phases[theoryIdx].dayEnd = field.dayEnd;
  }

  // Si la phase theory était placée après la collecte, recaler l'analyse
  // juste après la fin de collecte (pas après l'ancien créneau theory).
  const analysisIdx = phases.findIndex((p) => p.role === "analysis");
  if (analysisIdx >= 0 && theoryIdx > fieldIdx) {
    const analysis = phases[analysisIdx];
    const span = Math.max(1, analysis.dayEnd - analysis.dayStart + 1);
    analysis.dayStart = field.dayEnd + 1;
    analysis.dayEnd = Math.min(
      plan.meta.totalDays,
      analysis.dayStart + span - 1,
    );
    // Décaler rédaction / conclusion après l'analyse.
    for (const p of phases) {
      if (p.role === "discussion" || p.role === "conclusion") {
        const pSpan = Math.max(1, p.dayEnd - p.dayStart + 1);
        p.dayStart = analysis.dayEnd + 1;
        p.dayEnd = Math.min(plan.meta.totalDays, p.dayStart + pSpan - 1);
      }
    }
  }

  for (const p of phases) {
    if (p.role === "revision") continue;
    p.startDate = toISODate(addDaysUtc(start, p.dayStart - 1));
    p.endDate = toISODate(addDaysUtc(start, p.dayEnd - 1));
    p.weekStart = Math.ceil(p.dayStart / 7);
    p.weekEnd = Math.ceil(p.dayEnd / 7);
  }
  const rev = phases.find((p) => p.role === "revision");
  if (rev) {
    rev.startDate = toISODate(addDaysUtc(start, rev.dayStart - 1));
    rev.endDate = toISODate(addDaysUtc(start, rev.dayEnd - 1));
    rev.weekStart = Math.ceil(rev.dayStart / 7);
    rev.weekEnd = Math.ceil(rev.dayEnd / 7);
  }

  return { ...plan, phases };
}

/**
 * Si le terrain dépend de field_access, place la collecte dans la fenêtre
 * (à compter du début), précédée d’une préparation courte.
 */
function applyFieldAccessWindow(
  plan: WorkPlan,
  accessWeeks: number,
): WorkPlan {
  const accessDays = Math.max(7, Math.round(accessWeeks * 7));
  const totalDays = plan.meta.totalDays;
  if (accessDays >= totalDays) return plan;

  const start = parseStartDate(plan.meta.startDate);
  const phases = plan.phases.map((p) => ({ ...p }));
  const framingIdx = phases.findIndex(
    (p) => p.role === "intro" || p.role === "problem",
  );
  const theoryIdx = phases.findIndex((p) => p.role === "theory");
  const methodIdx = phases.findIndex((p) => p.role === "method");
  const fieldIdx = phases.findIndex((p) => p.role === "fieldwork");
  const analysisIdx = phases.findIndex((p) => p.role === "analysis");
  if (fieldIdx < 0) return plan;

  const prepDays = clamp(Math.round(accessDays * 0.15), 3, 14);
  const collectDays = Math.max(7, accessDays - prepDays);
  // Cadrage / lectures en début de période (avant ou pendant la préparation).
  if (framingIdx >= 0) {
    const framingDays = clamp(
      Math.round(prepDays * 0.8),
      5,
      Math.floor(accessDays * 0.4),
    );
    phases[framingIdx].dayStart = 1;
    phases[framingIdx].dayEnd = framingDays;
  }
  if (methodIdx >= 0) {
    phases[methodIdx].dayStart = Math.max(
      1,
      Math.floor(prepDays * 0.4),
    );
    phases[methodIdx].dayEnd = prepDays;
  }
  phases[fieldIdx].dayStart = prepDays + 1;
  phases[fieldIdx].dayEnd = prepDays + collectDays;

  // Cadre théorique / méthodo : parallèle à la collecte.
  if (theoryIdx >= 0) {
    phases[theoryIdx].dayStart = phases[fieldIdx].dayStart;
    phases[theoryIdx].dayEnd = phases[fieldIdx].dayEnd;
  }

  let afterCollect = prepDays + collectDays + 1;
  if (analysisIdx >= 0) {
    const analysisDays = clamp(
      Math.round((totalDays - afterCollect + 1) * 0.35),
      7,
      Math.floor((totalDays - afterCollect + 1) * 0.5),
    );
    phases[analysisIdx].dayStart = afterCollect;
    phases[analysisIdx].dayEnd = Math.min(
      totalDays - 7,
      afterCollect + analysisDays - 1,
    );
    afterCollect = phases[analysisIdx].dayEnd + 1;
  }
  for (const p of phases) {
    if (p.role === "discussion" || p.role === "conclusion") {
      p.dayStart = afterCollect;
      p.dayEnd = Math.max(
        p.dayStart,
        totalDays - Math.max(5, Math.floor(totalDays * 0.12)),
      );
    }
    if (p.role === "revision") {
      p.dayStart = Math.min(totalDays, p.dayEnd + 1);
      p.dayEnd = totalDays;
    }
  }
  // Fix revision as last block (≤ MAX_REVISION_SHARE_OF_TOTAL).
  const revIdx = phases.findIndex((p) => p.role === "revision");
  if (revIdx >= 0) {
    const revShare = Math.min(
      NON_FIELDWORK_BUDGET_SHARES.revision,
      MAX_REVISION_SHARE_OF_TOTAL,
    );
    const revDays = clamp(
      Math.round(totalDays * revShare),
      3,
      Math.floor(totalDays * MAX_REVISION_SHARE_OF_TOTAL),
    );
    phases[revIdx].dayStart = totalDays - revDays + 1;
    phases[revIdx].dayEnd = totalDays;
    for (const p of phases) {
      if (p.role === "discussion" || p.role === "conclusion") {
        p.dayEnd = Math.min(p.dayEnd, phases[revIdx].dayStart - 1);
        if (p.dayEnd < p.dayStart) p.dayEnd = p.dayStart;
      }
    }
  }

  for (const p of phases) {
    p.startDate = toISODate(addDaysUtc(start, p.dayStart - 1));
    p.endDate = toISODate(addDaysUtc(start, p.dayEnd - 1));
    p.weekStart = Math.ceil(p.dayStart / 7);
    p.weekEnd = Math.ceil(p.dayEnd / 7);
  }

  // Les heures hors collecte/analyse restent celles de
  // NON_FIELDWORK_BUDGET_SHARES (pas de redistribution au prorata des jours).
  return { ...plan, phases };
}

/** Construit un WorkPlan à partir d’un sujet + réponses questionnaire. */
export function buildWorkPlanFromTopic(input: {
  answers: Record<string, unknown>;
  topic: {
    research_question?: string;
    research_object?: string;
    method?: string;
    field_or_corpus?: string;
    estimated_hours?: number;
    fieldwork_plan?: FieldworkPlanItem[];
    feasibility?: { risks?: string[] };
  };
  /** Si omis : phases de recherche (pas la structure par chapitres). */
  sections?: WorkPlanSectionInput[];
  startDate?: string;
  endDate?: string;
}): WorkPlan | null {
  const deadlineRange =
    typeof input.answers.deadline_range === "string"
      ? input.answers.deadline_range
      : undefined;
  const weeklyTime =
    typeof input.answers.weekly_time === "string"
      ? input.answers.weekly_time
      : undefined;
  const documentType =
    typeof input.answers.project_type === "string"
      ? input.answers.project_type
      : undefined;
  const sections = input.sections?.length
    ? input.sections
    : RESEARCH_WORK_PLAN_SECTIONS;

  let plan = buildWorkPlan({
    sections,
    deadlineRange,
    weeklyTime,
    documentType,
    researchQuestion: input.topic.research_question,
    researchObject: input.topic.research_object,
    method: input.topic.method,
    field: input.topic.field_or_corpus,
    fieldworkPlan: input.topic.fieldwork_plan,
    risks: input.topic.feasibility?.risks,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  if (!plan) return null;

  const estimated =
    typeof input.topic.estimated_hours === "number" &&
    input.topic.estimated_hours > 0
      ? input.topic.estimated_hours
      : undefined;
  const fieldAccess =
    typeof input.answers.field_access === "string"
      ? input.answers.field_access.trim()
      : "";
  const accessWeeks = parseFieldAccessWeeks(fieldAccess);
  if (
    accessWeeks != null &&
    topicDependsOnFieldAccess(input.topic.field_or_corpus, fieldAccess)
  ) {
    plan = applyFieldAccessWindow(plan, accessWeeks);
  }

  plan = applyTheoryMethodOverlap(plan);

  // Heures après calendrier : parts hors collecte/analyse + plafond relecture.
  if (estimated != null) {
    plan = applyEstimatedHoursToPhases(plan, estimated);
  }

  return plan;
}

/** Réécrit les objectifs collecte/analyse pour coller à fieldwork_plan. */
export function alignFieldworkObjectives(
  plan: WorkPlan,
  fieldworkPlan?: FieldworkPlanItem[],
): WorkPlan {
  const summary = formatFieldworkPlanSummary(fieldworkPlan || []);
  if (!summary) return plan;
  const phases = plan.phases.map((p) => {
    if (p.role === "fieldwork") {
      return {
        ...p,
        objective: `Mener ${summary}.`,
      };
    }
    if (p.role === "analysis") {
      return {
        ...p,
        objective: `Analyser les matériaux recueillis à partir de ${summary}.`,
      };
    }
    return p;
  });
  return { ...plan, phases };
}

/**
 * Impose heures collecte/analyse depuis estimated_hours, puis rééquilibre
 * les surcharges hebdomadaires si besoin.
 */
export function enforceWorkPlanHoursAndLoad(
  plan: WorkPlan,
  estimatedHours?: number,
  fieldworkPlan?: FieldworkPlanItem[],
): { plan: WorkPlan; overloadFixedInCode: boolean } {
  let next = alignFieldworkObjectives(plan, fieldworkPlan);
  next =
    typeof estimatedHours === "number" && estimatedHours > 0
      ? applyEstimatedHoursToPhases(next, estimatedHours)
      : next;
  const before = planLoadSummary(next);
  let overloadFixedInCode = false;
  if (before.overloadedWeeks.length) {
    const rebalanced = rebalanceOverloadedPhases(next);
    const after = planLoadSummary(rebalanced);
    if (
      after.overloadedWeeks.length < before.overloadedWeeks.length ||
      after.peakHoursPerWeek < before.peakHoursPerWeek
    ) {
      next = rebalanced;
      overloadFixedInCode = true;
    }
  }
  return { plan: next, overloadFixedInCode };
}
