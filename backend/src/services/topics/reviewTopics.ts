import { z } from "zod";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import type {
  GeneratedTopic,
  TopicAxis,
} from "../../../../shared/research/topicTypes";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import {
  getProjectLevelGuide,
} from "../../../../shared/research/projectLevelGuides";
import {
  formatMethodThresholdsSummary,
  formatUnitOfAnalysisRule,
} from "../../../../shared/research/methodThresholds";
import {
  callClaudeStructured,
  getClaudeSettings,
} from "../llm/claude";
import { truncateAtWord } from "../scholarly/sourceTypes";
import { parseFieldAccessWeeks } from "./textLimits";

export type ReviewCode =
  | "TESTABILITY"
  | "ORIGINALITY"
  | "UNSUPPORTED_CLAIM"
  | "VAGUE_OBJECT"
  | "METHOD_MISMATCH"
  | "OVERLAP"
  | "FEASIBILITY_RISK"
  | "CLARITY"
  | "RELEVANCE"
  | "INCONSISTENT"
  | "ETHICS";

export type ReviewIssue = {
  axis: TopicAxis;
  code: ReviewCode;
  severity: "blocking" | "minor";
  explanation: string;
  /** true seulement si un défaut réel est constaté (filtre anti-faux positifs). */
  confirmed_defect: boolean;
};

export type ReviewStatus = "ok" | "failed";

const AXIS_ALIASES: Record<string, TopicAxis> = {
  mastery: "mastery",
  ambition: "ambition",
  discovery: "discovery",
  maitrise: "mastery",
  decouverte: "discovery",
};

const CODE_ALIASES: Record<string, ReviewCode> = {
  testability: "TESTABILITY",
  originality: "ORIGINALITY",
  unsupported_claim: "UNSUPPORTED_CLAIM",
  vague_object: "VAGUE_OBJECT",
  method_mismatch: "METHOD_MISMATCH",
  overlap: "OVERLAP",
  feasibility_risk: "FEASIBILITY_RISK",
  clarity: "CLARITY",
  relevance: "RELEVANCE",
  inconsistent: "INCONSISTENT",
  ethics: "ETHICS",
};

const VALID_CODES = new Set<ReviewCode>([
  "TESTABILITY",
  "ORIGINALITY",
  "UNSUPPORTED_CLAIM",
  "VAGUE_OBJECT",
  "METHOD_MISMATCH",
  "OVERLAP",
  "FEASIBILITY_RISK",
  "CLARITY",
  "RELEVANCE",
  "INCONSISTENT",
  "ETHICS",
]);

function normalizeAxis(raw: unknown): TopicAxis | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return AXIS_ALIASES[key] || AXIS_ALIASES[raw.trim().toLowerCase()] || null;
}

function normalizeCode(raw: unknown): ReviewCode | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (VALID_CODES.has(upper as ReviewCode)) return upper as ReviewCode;
  const lower = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return CODE_ALIASES[lower] || null;
}

function normalizeSeverity(raw: unknown): "blocking" | "minor" {
  if (typeof raw !== "string") return "minor";
  const s = raw.trim().toLowerCase();
  if (s === "blocking" || s === "bloque" || s === "bloquant") return "blocking";
  return "minor";
}

function normalizeConfirmedDefect(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "oui" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "non" || s === "no") return false;
  }
  if (typeof raw === "number") return raw !== 0;
  // Absent ou illisible : ne pas compter (évite les faux positifs).
  return false;
}

/**
 * Schéma plat pour output_config — strings libres (pas d'enum Zod strict).
 * La normalisation axis/code se fait ensuite (évite invalid_value si le
 * modèle renvoie « Maîtrise » / une variante).
 * Ne pas utiliser z.unknown() : zodOutputFormat exige un type JSON Schema.
 */
const reviewLlmFlatSchema = z.object({
  issues: z.array(
    z.object({
      axis: z.string(),
      code: z.string(),
      severity: z.string(),
      explanation: z.string(),
      confirmed_defect: z.union([z.boolean(), z.string()]).optional(),
    }),
  ),
});

const reviewInputSchema = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          axis: { type: "string" },
          code: { type: "string" },
          severity: { type: "string" },
          explanation: { type: "string", maxLength: 200 },
          confirmed_defect: { type: "boolean" },
        },
        required: [
          "axis",
          "code",
          "severity",
          "explanation",
          "confirmed_defect",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
} as const;

function zodErrorMeta(err: unknown): {
  code: string;
  path: string;
  message: string;
} {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as z.ZodError).issues || [];
    const first = issues[0];
    if (first) {
      return {
        code: String(first.code || "zod_error"),
        path: Array.isArray(first.path) ? first.path.join(".") : "unknown",
        message: String(first.message || "").slice(0, 160),
      };
    }
  }
  if (err instanceof Error) {
    return {
      code: "error",
      path: "",
      message: err.message.slice(0, 160).replace(/\s+/g, " "),
    };
  }
  return { code: "unknown", path: "", message: "unknown" };
}

function parseIssues(
  data: unknown,
  projectType: string,
): ReviewIssue[] {
  // Accepte aussi une enveloppe { issues } manquante / null.
  const rawObj =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const list = Array.isArray(rawObj.issues)
    ? rawObj.issues
    : Array.isArray(data)
      ? data
      : [];
  const flat = reviewLlmFlatSchema.parse({ issues: list });
  const out: ReviewIssue[] = [];
  const skipped: string[] = [];
  for (const item of flat.issues) {
    const axis = normalizeAxis(item.axis);
    const code = normalizeCode(item.code);
    if (!axis || !code) {
      skipped.push(
        `axis=${String(item.axis).slice(0, 40)} code=${String(item.code).slice(0, 40)}`,
      );
      continue;
    }
    const confirmed_defect = normalizeConfirmedDefect(
      (item as { confirmed_defect?: unknown }).confirmed_defect,
    );
    // Filtre anti-faux positifs : ne compter que les défauts confirmés.
    if (!confirmed_defect) {
      skipped.push(`unconfirmed:${code}`);
      continue;
    }
    let severity = normalizeSeverity(item.severity);
    const explanation = truncateAtWord(
      String(item.explanation || "").trim() || "Problème signalé.",
      200,
    );
    if (
      code === "TESTABILITY" ||
      code === "OVERLAP" ||
      code === "METHOD_MISMATCH" ||
      code === "CLARITY" ||
      code === "RELEVANCE" ||
      code === "INCONSISTENT" ||
      code === "ETHICS"
    )
      severity = "blocking";
    if (code === "FEASIBILITY_RISK") severity = "minor";
    if (
      code === "ORIGINALITY" &&
      (projectType === "thesis" || projectType === "article")
    ) {
      severity = "blocking";
    }
    out.push({ axis, code, severity, explanation, confirmed_defect: true });
  }
  if (skipped.length) {
    console.info(
      JSON.stringify({
        event: "topics.review_skip_item",
        count: skipped.length,
        // Métadonnées courtes seulement (pas d'explication complète).
        samples: skipped.slice(0, 3),
      }),
    );
  }
  return out.slice(0, 20);
}

async function callReviewOnce(params: {
  system: string;
  user: string;
}): Promise<{
  data: unknown;
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
}> {
  const { modelFast } = getClaudeSettings();
  const result = await callClaudeStructured<unknown>({
    system: params.system,
    user: params.user,
    toolName: "review_topics",
    inputSchema: reviewInputSchema as unknown as Record<string, unknown>,
    zodSchema: reviewLlmFlatSchema,
    model: modelFast,
    maxTokens: 2000,
    effort: "low",
    toolDescription:
      "Liste les problèmes de relecture critique des sujets (sans réécriture).",
  });
  return {
    data: result.data,
    model: result.model,
    tokens_in: result.usage.inputTokens,
    tokens_out: result.usage.outputTokens,
    tokens_thinking: result.usage.thinkingTokens,
    latency_ms: result.latencyMs,
  };
}

/**
 * Relecteur critique (modèle rapide) — ne réécrit rien.
 * Un nouvel essai en cas d'échec ; sinon status failed (jamais « 0 problème » fictif).
 */
export async function reviewTopics(params: {
  topics: GeneratedTopic[];
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
}): Promise<{
  status: ReviewStatus;
  issues: ReviewIssue[];
  blocking: ReviewIssue[];
  minor: ReviewIssue[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
  error_code?: string;
  error_path?: string;
}> {
  const guide = getProjectLevelGuide(
    typeof params.answers.project_type === "string"
      ? params.answers.project_type
      : undefined,
  );
  const budget = computeTimeBudget(params.answers);
  const projectType = String(params.answers.project_type || "");
  const accessWeeks = parseFieldAccessWeeks(params.answers.field_access);
  const accessDeclared =
    typeof params.answers.field_access === "string" &&
    params.answers.field_access.trim()
      ? params.answers.field_access.trim()
      : "";

  const accessHint = accessDeclared
    ? ` Fenêtre d'accès déclarée : « ${accessDeclared} »${
        accessWeeks != null ? ` (≈ ${accessWeeks} semaines)` : ""
      }. Elle ne s'applique qu'aux sujets dont field_or_corpus repose sur cet accès. Un terrain en ligne ou un corpus indépendant n'est pas borné par cette fenêtre. Si la collecte sur l'accès déclaré dépasse clairement la fenêtre sans plan de prolongation, signale FEASIBILITY_RISK (mineur), pas TESTABILITY.`
    : "";

  const system = [
    "Tu es un relecteur critique de sujets de recherche. Tu ne réécris rien.",
    "Pour chaque sujet, signale uniquement les problèmes réels selon cette grille :",
    "TESTABILITY (blocking) : une hypothèse ne peut pas être éprouvée du tout, parce que la variable, la variation ou la donnée nécessaire n'est pas recueillie. Un recrutement incertain, un calendrier tendu ou un risque d'attrition ne relèvent PAS de ce code.",
    "FEASIBILITY_RISK (toujours minor) : risque de faisabilité (recrutement non garanti, calendrier tendu, attrition, accès fragile). Pas un blocage.",
    "ORIGINALITY : la contribution ne correspond pas au niveau (pour thèse ou article, simple réplication d'un résultat connu).",
    "UNSUPPORTED_CLAIM : le rationale, le pitch, le contexte ou les liens affirment sur la personne ou sur le monde quelque chose d'absent du profil et non général — y compris un genre attribué à la personne.",
    "VAGUE_OBJECT : l'objet manque de précision (population, type de lieu ou période flous).",
    "CLARITY (blocking) : titre ou question ambigus, doubles, jargonneux, ou qui juxtaposent des mots-clés au lieu de nommer un objet et un angle. Dans l'explication, propose une reformulation courte.",
    "RELEVANCE (blocking) : le sujet ne découle pas réellement du profil (ignore centres d'intérêt, accès au terrain ou méthodes déclarés alors qu'ils sont renseignés, ou ne tient pas compte de ce que la personne saura faire).",
    "METHOD_MISMATCH (blocking) uniquement si la règle de l'unité d'analyse ci-dessous est enfreinte, ou si la méthode ne permet pas de répondre à la question. Dans l'explication, cite l'effectif ou le volume estimé sur lequel tu t'appuies.",
    formatUnitOfAnalysisRule().replace(/\n/g, " "),
    formatMethodThresholdsSummary().replace(/\n/g, " "),
    "INCONSISTENT (blocking) : le pitch, les enjeux (stakes) ou les pistes (leads) décrivent un matériau, une méthode ou un objet différents de ceux de la question, des hypothèses et du terrain ; ou bien la méthode ne peut pas mesurer ce que la question cherche. Tu reçois pitch, stakes et leads : vérifie-les.",
    "ETHICS (blocking) : recrutement à partir d'un fichier de données personnelles (usagers, abonnés, clients, élèves, salariés), collecte cachée de données sensibles, enquête auprès de mineurs sans autorisation prévue, ou pistes (leads) qui proposent l'une de ces pratiques. Relayer une invitation via la structure est acceptable.",
    "OVERLAP (blocking) : uniquement si au moins deux sujets sont fournis. Seulement si deux sujets partagent à la fois la même population (ou le même type de documents), le même terrain ou matériau, ET une question de recherche proche. Partager le thème d'intérêt du profil est attendu et n'est PAS un chevauchement. Signale l'axe le moins adapté au cahier des charges de son axe. Si un seul sujet est fourni, n'émets jamais OVERLAP.",
    "Axe ambition : un dispositif exigeant ou une méthode à apprendre sont voulus. Ne demande pas de les réduire (pas de METHOD_MISMATCH ni TESTABILITY pour « trop ambitieux ») tant que le plan n'est pas signalé hors budget en code.",
    "Pour TESTABILITY : utilise hypothesis_tests (comparison_or_variable + data_source) et vérifie la cohérence avec field_or_corpus / fieldwork_plan ; ne reconstruis pas le test toi-même." +
      accessHint,
    "axis doit être exactement mastery, ambition ou discovery (anglais, minuscules).",
    "code doit être exactement TESTABILITY, ORIGINALITY, UNSUPPORTED_CLAIM, VAGUE_OBJECT, METHOD_MISMATCH, OVERLAP, FEASIBILITY_RISK, CLARITY, RELEVANCE, INCONSISTENT ou ETHICS.",
    "severity = blocking ou minor.",
    "confirmed_defect = true seulement si un défaut réel est constaté ; false si tu hésites, si le point est limite, ou si tu conclurais « pas de violation ». Ne compte que confirmed_defect=true.",
    "explanation ≤ 200 caractères. Si aucun problème, renvoie issues: [].",
  ].join(" ");

  const compactTopics = params.topics.map((t) => ({
    axis: t.axis,
    title: t.title,
    research_object: t.research_object,
    research_question: t.research_question,
    hypotheses: t.hypotheses,
    hypothesis_tests: t.hypothesis_tests,
    field_or_corpus: t.field_or_corpus,
    fieldwork_plan: t.fieldwork_plan,
    estimated_hours: t.estimated_hours,
    method: t.method,
    pitch: t.pitch,
    stakes: t.stakes,
    leads: t.leads,
    rationale: t.rationale,
    context: t.context,
    expected_contribution: t.expected_contribution,
    ethical_notes: t.ethical_notes,
    profile_links: t.profile_links,
    risks: t.feasibility?.risks,
  }));

  const user = [
    "## Profil (libellés)",
    Object.values(params.profile.fields).join("\n") || "(vide)",
    "## Manques",
    params.profile.missing_fields.join(", ") || "(aucun)",
    "## Guide de niveau",
    `${guide.label} — originalité : ${guide.originality} — échelle : ${guide.field_scale}`,
    "## Budget",
    budget.label,
    "## Sujets",
    JSON.stringify(compactTopics),
    "Appelle review_topics avec la liste des problèmes (éventuellement vide).",
  ].join("\n\n");

  let tokens_in = 0;
  let tokens_out = 0;
  let tokens_thinking = 0;
  let latency_ms = 0;
  let model = getClaudeSettings().modelFast;
  let lastMeta = { code: "unknown", path: "", message: "unknown" };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await callReviewOnce({ system, user });
      tokens_in += result.tokens_in;
      tokens_out += result.tokens_out;
      tokens_thinking += result.tokens_thinking;
      latency_ms += result.latency_ms;
      model = result.model;

      const issues = parseIssues(result.data, projectType);
      const blocking = issues.filter((i) => i.severity === "blocking");
      const minor = issues.filter((i) => i.severity === "minor");

      console.info(
        JSON.stringify({
          event: "topics.review",
          status: "ok",
          at: new Date().toISOString(),
          attempt,
          blocking_count: blocking.length,
          minor_count: minor.length,
          codes: [...new Set(issues.map((i) => i.code))],
          axes: [...new Set(issues.map((i) => i.axis))],
          latency_ms,
          model,
        }),
      );

      for (const m of minor) {
        console.info(
          JSON.stringify({
            event: "topics.review_minor",
            axis: m.axis,
            code: m.code,
          }),
        );
      }

      return {
        status: "ok",
        issues,
        blocking,
        minor,
        model,
        tokens_in,
        tokens_out,
        tokens_thinking,
        latency_ms,
      };
    } catch (err) {
      lastMeta = zodErrorMeta(err);
      console.info(
        JSON.stringify({
          event: "topics.review",
          status: attempt === 1 ? "retry" : "error",
          at: new Date().toISOString(),
          attempt,
          error_code: lastMeta.code,
          error_path: lastMeta.path || null,
          // Message court, sans dump de contenu sujet.
          message: lastMeta.message.slice(0, 120),
        }),
      );
    }
  }

  return {
    status: "failed",
    issues: [],
    blocking: [],
    minor: [],
    model,
    tokens_in,
    tokens_out,
    tokens_thinking,
    latency_ms,
    error_code: lastMeta.code,
    error_path: lastMeta.path || undefined,
  };
}

export function formatReviewIssuesForCorrection(
  issues: ReviewIssue[],
): string {
  return issues
    .map(
      (i) =>
        `Sujet ${i.axis} [${i.code}/${i.severity}] : ${i.explanation}`,
    )
    .join("\n");
}

/**
 * Intègre les FEASIBILITY_RISK mineurs dans risks s'ils n'y figurent pas déjà.
 */
export function attachFeasibilityRisksFromReview(
  topics: GeneratedTopic[],
  issues: ReviewIssue[],
): GeneratedTopic[] {
  return topics.map((topic) => {
    const risks = [...(topic.feasibility?.risks || [])];
    const relevant = issues.filter(
      (i) =>
        i.code === "FEASIBILITY_RISK" &&
        i.axis === topic.axis &&
        i.explanation.trim(),
    );
    for (const issue of relevant) {
      const needle = issue.explanation
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .slice(0, 48);
      const already = risks.some((r) =>
        r
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .includes(needle),
      );
      if (!already) {
        risks.push(truncateAtWord(issue.explanation, 220));
      }
    }
    return {
      ...topic,
      feasibility: {
        ...topic.feasibility,
        level: topic.feasibility?.level || "medium",
        risks: risks.slice(0, 6),
        first_steps: topic.feasibility?.first_steps || [],
      },
    };
  });
}
