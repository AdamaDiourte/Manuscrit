import { z } from "zod";
import type { PseudonymizedProfile } from "../../../../shared/privacy/buildPseudonymizedProfile";
import type { TopicAxis } from "../../../../shared/research/topicTypes";
import { computeTimeBudget } from "../../../../shared/research/timeBudget";
import { getProjectLevelGuide } from "../../../../shared/research/projectLevelGuides";
import {
  callClaudeStructured,
  getClaudeSettings,
} from "../llm/claude";
import { clampAtSentence } from "./textLimits";

export type AnglePlanItem = {
  axis: TopicAxis;
  research_object: string;
  material: string;
  angle: string;
};

const angleItemLlmSchema = z.object({
  axis: z.string(),
  research_object: z.string(),
  material: z.string(),
  angle: z.string(),
});

const anglesLlmSchema = z.object({
  angles: z.array(angleItemLlmSchema).min(3).max(3),
});

const anglesInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    angles: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          axis: {
            type: "string",
            enum: ["mastery", "ambition", "discovery"],
          },
          research_object: { type: "string", minLength: 8, maxLength: 250 },
          material: { type: "string", minLength: 3, maxLength: 120 },
          angle: { type: "string", minLength: 8, maxLength: 150 },
        },
        required: ["axis", "research_object", "material", "angle"],
        additionalProperties: false,
      },
    },
  },
  required: ["angles"],
  additionalProperties: false,
};

function normalizeAxis(raw: string): TopicAxis | null {
  const key = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (key === "mastery" || key === "maitrise") return "mastery";
  if (key === "ambition") return "ambition";
  if (key === "discovery" || key === "decouverte") return "discovery";
  return null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const bySentence = clampAtSentence(t, max);
  if (bySentence) return bySentence;
  const window = t.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace >= Math.floor(max * 0.6)) return window.slice(0, lastSpace).trimEnd();
  return window.trimEnd();
}

function parseAngles(data: unknown): AnglePlanItem[] {
  const parsed = anglesLlmSchema.parse(data);
  const byAxis = new Map<TopicAxis, AnglePlanItem>();
  for (const item of parsed.angles) {
    const axis = normalizeAxis(item.axis);
    if (!axis || byAxis.has(axis)) continue;
    byAxis.set(axis, {
      axis,
      research_object: clip(item.research_object, 250),
      material: clip(item.material, 120),
      angle: clip(item.angle, 150),
    });
  }
  if (byAxis.size !== 3) {
    throw new Error("angle_plan_incomplete");
  }
  return ["mastery", "ambition", "discovery"].map(
    (a) => byAxis.get(a as TopicAxis)!,
  );
}

/**
 * Plan des 3 angles avant génération parallèle — modèle rapide.
 */
export async function planTopicAngles(params: {
  profile: PseudonymizedProfile;
  answers: Record<string, unknown>;
}): Promise<{
  angles: AnglePlanItem[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_thinking: number;
  latency_ms: number;
}> {
  const guide = getProjectLevelGuide(
    typeof params.answers.project_type === "string"
      ? params.answers.project_type
      : undefined,
  );
  const budget = computeTimeBudget(params.answers);
  const { modelFast } = getClaudeSettings();

  const system = [
    "Tu es un directeur de recherche. Tu planifies trois angles de sujets distincts.",
    "Tu n'écris pas les sujets complets : seulement un plan court par axe.",
    "Contraintes :",
    "- les 3 research_object diffèrent par la population, le phénomène étudié ou le matériau, pas seulement par la méthode ;",
    "- au plus 2 axes sur 3 peuvent reposer sur le même terrain déclaré, et dans ce cas avec un objet différent ;",
    "- mastery = faisable avec les forces et l'accès déclaré ; ambition = intérêts + méthode à apprendre si présente ; discovery = angle nouveau borné par les contraintes ;",
    "- research_object ≤ 250 caractères ; angle ≤ 150 ; material = type de matériau principal (entretiens, questionnaire, corpus, observation, données secondaires…).",
    "Appelle plan_topic_angles une seule fois avec exactement un item par axe (mastery, ambition, discovery).",
  ].join(" ");

  const user = [
    "## Profil",
    Object.values(params.profile.fields).join("\n") || "(vide)",
    "## Manques",
    params.profile.missing_fields.join(", ") || "(aucun)",
    "## Guide",
    `${guide.label} — ${guide.field_scale}`,
    "## Budget",
    budget.label,
    "Appelle plan_topic_angles.",
  ].join("\n\n");

  const result = await callClaudeStructured<unknown>({
    system,
    user,
    toolName: "plan_topic_angles",
    inputSchema: anglesInputSchema,
    zodSchema: anglesLlmSchema,
    model: modelFast,
    maxTokens: 1200,
    effort: "low",
    toolDescription:
      "Planifie trois angles de recherche distincts (un par axe).",
  });

  const angles = parseAngles(result.data);
  console.info(
    JSON.stringify({
      event: "topics.angle_plan",
      status: "ok",
      axes: angles.map((a) => a.axis),
      materials: angles.map((a) => a.material.slice(0, 40)),
      latency_ms: result.latencyMs,
      model: result.model,
    }),
  );

  return {
    angles,
    model: result.model,
    tokens_in: result.usage.inputTokens,
    tokens_out: result.usage.outputTokens,
    tokens_thinking: result.usage.thinkingTokens,
    latency_ms: result.latencyMs,
  };
}
