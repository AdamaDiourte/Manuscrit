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
  method?: string;
  field?: string;
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
};

type PhaseCopy = {
  objective: string;
  deliverable: string;
  checkpoint: string;
};

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
 * Contenu distinct par rôle — textes courts pour le planning compact.
 * Méthode / terrain cités en entier uniquement en phase méthode.
 */
export const PHASE_CONTENT: Record<
  PhaseRole,
  (ctx: PhaseContext) => PhaseCopy
> = {
  intro: (ctx) => ({
    objective: clampSentence(
      ctx.researchQuestion
        ? `Situer l’objet et relier l’ouverture à la question retenue`
        : `Situer l’objet et le lecteur avant toute analyse`,
      120,
    ),
    deliverable: clampWords("Note d’ouverture : enjeu et fil", 12),
    checkpoint: clampWords("Valider cadrage et ton avec l’encadrement", 15),
  }),
  problem: () => ({
    objective: clampSentence(
      "Formuler une question directrice opérationalisable",
      120,
    ),
    deliverable: clampWords("Fiche problématique et hypothèses", 12),
    checkpoint: clampWords("Valider la formulation avant la collecte", 15),
  }),
  theory: () => ({
    objective: clampSentence(
      "Sélectionner les notions mobilisables pour la méthode retenue",
      120,
    ),
    deliverable: clampWords("Carte conceptuelle annotée", 12),
    checkpoint: clampWords("Contrôler l’absence de références inventées", 15),
  }),
  method: (ctx) => ({
    objective: clampSentence(
      joinSentences(
        "Rendre transparent le protocole",
        ctx.method ? `Décrire « ${ctx.method} »` : false,
        ctx.field ? `Situer « ${ctx.field} »` : false,
      ),
      140,
    ),
    deliverable: clampWords("Fiche protocole et critères", 12),
    checkpoint: clampWords("Valider faisabilité et éthique", 15),
  }),
  fieldwork: (ctx) => ({
    objective: clampSentence(
      ctx.risks?.length
        ? "Organiser la collecte sur votre terrain sans élargir le périmètre"
        : "Organiser la collecte ou le dépouillement sur votre terrain",
      120,
    ),
    deliverable: clampWords("Journal de terrain ou corpus indexé", 12),
    checkpoint: clampWords("Point d’accès et calendrier", 15),
  }),
  analysis: () => ({
    objective: clampSentence(
      "Croiser les preuves selon la méthode retenue, du simple au complexe",
      120,
    ),
    deliverable: clampWords("Tableau de résultats cités", 12),
    checkpoint: clampWords("Relire preuves et progression", 15),
  }),
  discussion: (ctx) => ({
    objective: clampSentence(
      ctx.risks?.length
        ? "Recouper apports et limites sans dépasser les données"
        : "Recouper résultats, portées et limites sans inventer",
      120,
    ),
    deliverable: clampWords("Brouillon de discussion sobre", 12),
    checkpoint: clampWords("Vérifier que rien ne dépasse les matériaux", 15),
  }),
  conclusion: () => ({
    objective: clampSentence(
      "Synthétiser le fil sans nouveau développement empirique",
      120,
    ),
    deliverable: clampWords("Conclusion et checklist de formes", 12),
    checkpoint: clampWords("Lecture d’ensemble avant dépôt", 15),
  }),
  revision: () => ({
    objective: clampSentence(
      "Relire le fil, les citations et les normes avant le rendu",
      120,
    ),
    deliverable: clampWords("Version remisable corrigée", 12),
    checkpoint: clampWords("Intégrer les retours et figer le fichier", 15),
  }),
};

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

  const revisionShare =
    totalDays >= 60 ? 0.18 : totalDays >= 30 ? 0.15 : 0.12;
  const revisionDays = clamp(
    Math.round(totalDays * revisionShare),
    2,
    Math.floor(totalDays * 0.25),
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

  const ctx: PhaseContext = {
    method: (input.method || "").trim() || undefined,
    field: (input.field || "").trim() || undefined,
    risks: (input.risks || []).map((r) => String(r).trim()).filter(Boolean),
    researchQuestion: (input.researchQuestion || "").trim() || undefined,
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

/** Tableau de pilotage compact pour le plan de travail (secours / Word). */
export function workPlanToScheduleTable(plan: WorkPlan): {
  headers: string[];
  rows: string[][];
} {
  return {
    headers: [
      "Phase",
      "Période",
      "Objectif",
      "Livrable",
      "Point d’encadrement",
      "Charge",
    ],
    rows: plan.phases.map((phase) => [
      `${phase.index + 1}. ${phase.title}`,
      `${formatShortDateFr(phase.startDate)} → ${formatShortDateFr(phase.endDate)} (${formatWeekSpan(phase.weekStart, phase.weekEnd)})`,
      phase.objective,
      phase.deliverable,
      phase.checkpoint,
      formatHoursFr(phase.hours),
    ]),
  };
}

/** Construit un WorkPlan à partir d’un sujet + réponses questionnaire. */
export function buildWorkPlanFromTopic(input: {
  answers: Record<string, unknown>;
  topic: {
    research_question?: string;
    method?: string;
    field_or_corpus?: string;
    feasibility?: { risks?: string[] };
  };
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
  return buildWorkPlan({
    sections: input.sections,
    deadlineRange,
    weeklyTime,
    documentType,
    researchQuestion: input.topic.research_question,
    method: input.topic.method,
    field: input.topic.field_or_corpus,
    risks: input.topic.feasibility?.risks,
    startDate: input.startDate,
    endDate: input.endDate,
  });
}
