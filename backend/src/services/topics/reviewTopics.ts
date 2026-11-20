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
  callClaudeStructured,
  getClaudeSettings,
} from "../llm/claude";
import { truncateAtWord } from "../scholarly/sourceTypes";

export type ReviewCode =
  | "TESTABILITY"
  | "ORIGINALITY"
  | "UNSUPPORTED_CLAIM"
  | "VAGUE_OBJECT"
  | "METHOD_MISMATCH"
  | "OVERLAP";

export type ReviewIssue = {
  axis: TopicAxis;
  code: ReviewCode;
  severity: "blocking" | "minor";
  explanation: string;
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
};

const METHOD_MISMATCH_STAT_QUAL_RE =
  /statist|fr[eé]quen|proportion|sous-groupe|qualitat|entretien|petit\s+(échantillon|corpus|n)|moins de\s*\d+\s*entretien/i;

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
  if (
    upper === "TESTABILITY" ||
    upper === "ORIGINALITY" ||
    upper === "UNSUPPORTED_CLAIM" ||
    upper === "VAGUE_OBJECT" ||
    upper === "METHOD_MISMATCH" ||
    upper === "OVERLAP"
  ) {
    return upper;
  }
  const lower = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return CODE_ALIASES[lower] || null;
}

function normalizeSeverity(raw: unknown): "blocking" | "minor" {
  if (typeof raw !== "string") return "minor";
  const s = raw.trim().toLowerCase();
  if (s === "blocking" || s === "bloque" || s === "bloquant") return "blocking";
  return "minor";
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
        },
        required: ["axis", "code", "severity", "explanation"],
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
    let severity = normalizeSeverity(item.severity);
    const explanation = truncateAtWord(
      String(item.explanation || "").trim() || "Problème signalé.",
      200,
    );
    if (code === "TESTABILITY" || code === "OVERLAP") severity = "blocking";
    if (
      code === "METHOD_MISMATCH" &&
      METHOD_MISMATCH_STAT_QUAL_RE.test(explanation)
    ) {
      severity = "blocking";
    }
    if (
      code === "ORIGINALITY" &&
      (projectType === "thesis" || projectType === "article")
    ) {
      severity = "blocking";
    }
    out.push({ axis, code, severity, explanation });
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

  const accessHint =
    typeof params.answers.field_access === "string" &&
    params.answers.field_access.trim()
      ? ` Fenêtre d'accès déclarée : « ${params.answers.field_access.trim()} ». Si la collecte sur ce terrain dépasse clairement cette fenêtre sans plan de prolongation, signale TESTABILITY.`
      : "";

  const system = [
    "Tu es un relecteur critique de sujets de recherche. Tu ne réécris rien.",
    "Pour chaque sujet, signale uniquement les problèmes réels selon cette grille :",
    "TESTABILITY : une hypothèse ne peut pas être testée avec le terrain prévu (variation absente, données inadaptées), ou le dispositif n'est pas réalisable dans la fenêtre d'accès au terrain déclarée.",
    "ORIGINALITY : la contribution ne correspond pas au niveau (pour thèse ou article, simple réplication d'un résultat connu).",
    "UNSUPPORTED_CLAIM : le rationale, le contexte ou les liens affirment sur la personne ou sur le monde quelque chose d'absent du profil et non général — y compris un genre attribué à la personne.",
    "VAGUE_OBJECT : l'objet manque de précision (population, type de lieu ou période flous).",
    "METHOD_MISMATCH : la méthode ne permet pas de répondre à la question ; ou une hypothèse statistique (fréquences, proportions, écarts entre groupes) testée sur un matériau qualitatif de petite taille (blocking dans ce cas).",
    "OVERLAP (toujours blocking) : uniquement si au moins deux sujets sont fournis. Deux sujets partagent le même objet, ou le même terrain avec des questions proches. Compare research_object, field_or_corpus et les hypothèses. Signale l'axe le moins adapté au cahier des charges de son axe. Si un seul sujet est fourni, n'émets jamais OVERLAP.",
    "Pour TESTABILITY : utilise hypothesis_tests (comparison_or_variable + data_source) et vérifie la cohérence avec field_or_corpus / fieldwork_plan ; ne reconstruis pas le test toi-même." +
      accessHint,
    "axis doit être exactement mastery, ambition ou discovery (anglais, minuscules).",
    "code doit être exactement TESTABILITY, ORIGINALITY, UNSUPPORTED_CLAIM, VAGUE_OBJECT, METHOD_MISMATCH ou OVERLAP.",
    "severity = blocking ou minor.",
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
    rationale: t.rationale,
    context: t.context,
    expected_contribution: t.expected_contribution,
    ethical_notes: t.ethical_notes,
    profile_links: t.profile_links,
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
