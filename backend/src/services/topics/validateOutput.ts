import { z } from "zod";
import {
  estimateFieldworkHours,
  FIELDWORK_UNITS,
  isFieldworkUnit,
  type FieldworkPlanItem,
} from "../../../../shared/research/fieldworkCosts";
import type {
  HypothesisTest,
  ProfileAnalysis,
  TopicsOutput,
} from "../../../../shared/research/topicTypes";
import { TOPIC_LIMITS } from "./textLimits";

/**
 * Accepte le texte sans troncature silencieuse.
 * Soft max = 2× la limite (détection TOO_LONG en qualityCheck).
 */
const nonemptyString = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .pipe(z.string().min(min).max(Math.max(max * 2, max + 80)));

const stringList = (maxItem: number, maxItems: number, minItems = 0) =>
  z
    .array(z.string())
    .transform((arr) =>
      arr
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, maxItems),
    )
    .pipe(
      z
        .array(
          z
            .string()
            .min(1)
            .max(Math.max(maxItem * 2, maxItem + 80)),
        )
        .max(maxItems)
        .min(minItems),
    );

const profileLinkSchema = z.object({
  field: nonemptyString(TOPIC_LIMITS.profile_link_field),
  profile_value: nonemptyString(TOPIC_LIMITS.profile_link_value),
  use: nonemptyString(TOPIC_LIMITS.profile_link_use),
});

const nullishText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === undefined || v === null) return null;
      const t = v.trim();
      return t ? t : null;
    })
    .pipe(
      z.union([
        z.null(),
        z.string().max(Math.max(max * 2, max + 80)),
      ]),
    );

const fieldworkPlanItemSchema = z.object({
  unit: z.string().transform((u, ctx) => {
    if (!isFieldworkUnit(u)) {
      ctx.addIssue({
        code: "custom",
        message: `Unité de collecte inconnue : ${u}`,
      });
      return z.NEVER;
    }
    return u;
  }),
  quantity: z.coerce.number().positive().max(10_000),
});

function normalizeFieldworkPlan(raw: unknown): FieldworkPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldworkPlanItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const unit = String((item as { unit?: unknown }).unit || "");
    const quantity = Number((item as { quantity?: unknown }).quantity);
    if (!isFieldworkUnit(unit) || !Number.isFinite(quantity) || quantity <= 0)
      continue;
    out.push({ unit, quantity });
  }
  return out.slice(0, 8);
}

const topicSchema = z
  .object({
    axis: z.enum(["mastery", "ambition", "discovery"]),
    title: nonemptyString(TOPIC_LIMITS.title, 3),
    context: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => (typeof v === "string" ? v.trim() : ""))
      .pipe(
        z
          .string()
          .max(
            Math.max(TOPIC_LIMITS.context * 2, TOPIC_LIMITS.context + 80),
          ),
      ),
    research_question: nonemptyString(TOPIC_LIMITS.research_question, 8),
    hypotheses: stringList(TOPIC_LIMITS.hypotheses, 5, 1),
    field_or_corpus: nonemptyString(TOPIC_LIMITS.field_or_corpus, 3),
    method: nonemptyString(TOPIC_LIMITS.method, 3),
    feasibility: z.object({
      level: z.enum(["high", "medium", "low"]),
      risks: stringList(TOPIC_LIMITS.risks, 6, 0),
      first_steps: stringList(TOPIC_LIMITS.first_steps, 6, 0).transform(
        (steps) =>
          steps.length
            ? steps
            : ["Préciser le protocole de collecte sur l'objet retenu"],
      ),
    }),
    rationale: nonemptyString(TOPIC_LIMITS.rationale, 8),
    pitch: nonemptyString(TOPIC_LIMITS.pitch, 8),
    stakes: stringList(TOPIC_LIMITS.stakes, 3, 2),
    leads: stringList(TOPIC_LIMITS.leads, 3, 2),
    keywords_fr: stringList(TOPIC_LIMITS.keywords, 12, 2),
    keywords_en: stringList(TOPIC_LIMITS.keywords, 12, 2),
    ethical_notes: nullishText(TOPIC_LIMITS.ethical_notes),
    research_object: nonemptyString(TOPIC_LIMITS.research_object, 8),
    profile_links: z
      .array(profileLinkSchema)
      .transform((arr) => arr.slice(0, 4))
      .pipe(z.array(profileLinkSchema).min(2).max(4)),
    title_writing_language: nullishText(TOPIC_LIMITS.title_writing_language),
    expected_contribution: nonemptyString(
      TOPIC_LIMITS.expected_contribution,
      8,
    ),
    fieldwork_plan: z
      .array(fieldworkPlanItemSchema)
      .min(1)
      .max(8)
      .transform((arr) => arr as FieldworkPlanItem[]),
    hypothesis_tests: z
      .array(
        z.object({
          hypothesis_index: z.coerce.number().int().min(0).max(10),
          comparison_or_variable: nonemptyString(
            TOPIC_LIMITS.comparison_or_variable,
            3,
          ),
          data_source: nonemptyString(TOPIC_LIMITS.data_source, 3),
        }),
      )
      .min(1)
      .max(5)
      .transform((arr) => arr as HypothesisTest[]),
    /** Never trusted from the model — stripped on parse. */
    readings: z.array(z.unknown()).optional(),
    estimated_hours: z.unknown().optional(),
    literature_density: z.unknown().optional(),
  })
  .transform(
    ({
      readings: _readings,
      estimated_hours: _eh,
      literature_density: _ld,
      fieldwork_plan,
      hypothesis_tests,
      ...rest
    }) => {
      const plan = normalizeFieldworkPlan(fieldwork_plan);
      return {
        ...rest,
        fieldwork_plan: plan.length ? plan : fieldwork_plan,
        hypothesis_tests: hypothesis_tests || [],
        estimated_hours: estimateFieldworkHours(
          plan.length ? plan : fieldwork_plan,
        ),
        readings: [] as [],
      };
    },
  );

const profileAnalysisSchema = z.object({
  strengths: stringList(TOPIC_LIMITS.profile_analysis_item, 5, 0),
  interests: stringList(TOPIC_LIMITS.profile_analysis_item, 5, 0),
  wants_to_learn: stringList(TOPIC_LIMITS.profile_analysis_item, 5, 0),
  constraints: stringList(TOPIC_LIMITS.profile_analysis_item, 5, 0),
  missing: stringList(TOPIC_LIMITS.profile_analysis_item, 5, 0),
});

const uniqueAxesRefine = {
  refine: (topics: Array<{ axis: string }>): boolean => {
    const axes = new Set(topics.map((t) => t.axis));
    return (
      axes.has("mastery") && axes.has("ambition") && axes.has("discovery")
    );
  },
  message: "Les trois axes mastery, ambition et discovery sont requis.",
} as const;

export const topicsOutputSchema = z.object({
  topics: z
    .array(topicSchema)
    .length(3)
    .refine(uniqueAxesRefine.refine, { message: uniqueAxesRefine.message }),
  profile_analysis: profileAnalysisSchema.optional(),
  personalization_level: z.enum(["high", "medium", "low"]).optional(),
});

export const proposeTopicsSchema = z.object({
  profile_analysis: profileAnalysisSchema,
  personalization_level: z.enum(["high", "medium", "low"]),
  topics: z
    .array(topicSchema)
    .length(3)
    .refine(uniqueAxesRefine.refine, { message: uniqueAxesRefine.message }),
});

export const proposeTopicSchema = z.object({
  topic: topicSchema,
  /** Rempli uniquement par l'appel « mastery » en génération parallèle. */
  profile_analysis: profileAnalysisSchema.optional(),
  personalization_level: z.enum(["high", "medium", "low"]).optional(),
});

/**
 * Schéma Zod « plat » (sans transform) pour output_config / zodOutputFormat.
 * La validation permissive reste dans proposeTopicsSchema.
 */
const topicLlmSchema = z.object({
  axis: z.enum(["mastery", "ambition", "discovery"]),
  title: z.string(),
  context: z.string(),
  research_question: z.string(),
  hypotheses: z.array(z.string()),
  field_or_corpus: z.string(),
  method: z.string(),
  feasibility: z.object({
    level: z.enum(["high", "medium", "low"]),
    risks: z.array(z.string()),
    first_steps: z.array(z.string()),
  }),
  rationale: z.string(),
  pitch: z.string(),
  stakes: z.array(z.string()),
  leads: z.array(z.string()),
  keywords_fr: z.array(z.string()),
  keywords_en: z.array(z.string()),
  ethical_notes: z.string().nullable(),
  research_object: z.string(),
  profile_links: z.array(
    z.object({
      field: z.string(),
      profile_value: z.string(),
      use: z.string(),
    }),
  ),
  title_writing_language: z.string().nullable(),
  expected_contribution: z.string(),
  fieldwork_plan: z.array(
    z.object({
      unit: z.string(),
      quantity: z.number(),
    }),
  ),
  hypothesis_tests: z.array(
    z.object({
      hypothesis_index: z.number(),
      comparison_or_variable: z.string(),
      data_source: z.string(),
    }),
  ),
});

export const proposeTopicsLlmSchema = z.object({
  profile_analysis: z.object({
    strengths: z.array(z.string()),
    interests: z.array(z.string()),
    wants_to_learn: z.array(z.string()),
    constraints: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  personalization_level: z.enum(["high", "medium", "low"]),
  topics: z.array(topicLlmSchema).length(3),
});

export const proposeTopicLlmSchema = z.object({
  topic: topicLlmSchema,
  profile_analysis: z
    .object({
      strengths: z.array(z.string()),
      interests: z.array(z.string()),
      wants_to_learn: z.array(z.string()),
      constraints: z.array(z.string()),
      missing: z.array(z.string()),
    })
    .optional(),
  personalization_level: z.enum(["high", "medium", "low"]).optional(),
});

export type ProposeTopicsToolInput = z.infer<typeof proposeTopicsSchema>;
export type ProposeTopicToolInput = z.infer<typeof proposeTopicSchema>;

const topicJsonSchemaProperties: Record<string, unknown> = {
  axis: { type: "string", enum: ["mastery", "ambition", "discovery"] },
  title: { type: "string", minLength: 3, maxLength: TOPIC_LIMITS.title },
  context: { type: "string", maxLength: TOPIC_LIMITS.context },
  research_question: {
    type: "string",
    minLength: 8,
    maxLength: TOPIC_LIMITS.research_question,
  },
  hypotheses: {
    type: "array",
    items: {
      type: "string",
      minLength: 3,
      maxLength: TOPIC_LIMITS.hypotheses,
    },
    minItems: 1,
    maxItems: 5,
  },
  field_or_corpus: {
    type: "string",
    minLength: 3,
    maxLength: TOPIC_LIMITS.field_or_corpus,
  },
  method: {
    type: "string",
    minLength: 3,
    maxLength: TOPIC_LIMITS.method,
  },
  feasibility: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["high", "medium", "low"] },
      risks: {
        type: "array",
        items: {
          type: "string",
          minLength: 2,
          maxLength: TOPIC_LIMITS.risks,
        },
        maxItems: 6,
      },
      first_steps: {
        type: "array",
        items: {
          type: "string",
          minLength: 2,
          maxLength: TOPIC_LIMITS.first_steps,
        },
        minItems: 1,
        maxItems: 6,
      },
    },
    required: ["level", "risks", "first_steps"],
    additionalProperties: false,
  },
  rationale: {
    type: "string",
    minLength: 8,
    maxLength: TOPIC_LIMITS.rationale,
  },
  pitch: {
    type: "string",
    minLength: 8,
    maxLength: TOPIC_LIMITS.pitch,
  },
  stakes: {
    type: "array",
    items: {
      type: "string",
      minLength: 2,
      maxLength: TOPIC_LIMITS.stakes,
    },
    minItems: 2,
    maxItems: 3,
  },
  leads: {
    type: "array",
    items: {
      type: "string",
      minLength: 2,
      maxLength: TOPIC_LIMITS.leads,
    },
    minItems: 2,
    maxItems: 3,
  },
  keywords_fr: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: TOPIC_LIMITS.keywords,
    },
    minItems: 2,
    maxItems: 12,
  },
  keywords_en: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: TOPIC_LIMITS.keywords,
    },
    minItems: 2,
    maxItems: 12,
  },
  ethical_notes: {
    type: ["string", "null"],
    maxLength: TOPIC_LIMITS.ethical_notes,
  },
  research_object: {
    type: "string",
    minLength: 8,
    maxLength: TOPIC_LIMITS.research_object,
  },
  profile_links: {
    type: "array",
    items: {
      type: "object",
      properties: {
        field: {
          type: "string",
          minLength: 1,
          maxLength: TOPIC_LIMITS.profile_link_field,
        },
        profile_value: {
          type: "string",
          minLength: 1,
          maxLength: TOPIC_LIMITS.profile_link_value,
        },
        use: {
          type: "string",
          minLength: 1,
          maxLength: TOPIC_LIMITS.profile_link_use,
        },
      },
      required: ["field", "profile_value", "use"],
      additionalProperties: false,
    },
    minItems: 2,
    maxItems: 4,
  },
  title_writing_language: {
    type: ["string", "null"],
    maxLength: TOPIC_LIMITS.title_writing_language,
  },
  expected_contribution: {
    type: "string",
    minLength: 8,
    maxLength: TOPIC_LIMITS.expected_contribution,
  },
  fieldwork_plan: {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: {
      type: "object",
      properties: {
        unit: { type: "string", enum: [...FIELDWORK_UNITS] },
        quantity: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["unit", "quantity"],
      additionalProperties: false,
    },
  },
  hypothesis_tests: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: {
      type: "object",
      properties: {
        hypothesis_index: { type: "integer", minimum: 0, maximum: 10 },
        comparison_or_variable: {
          type: "string",
          minLength: 3,
          maxLength: TOPIC_LIMITS.comparison_or_variable,
        },
        data_source: {
          type: "string",
          minLength: 3,
          maxLength: TOPIC_LIMITS.data_source,
        },
      },
      required: ["hypothesis_index", "comparison_or_variable", "data_source"],
      additionalProperties: false,
    },
  },
};

const topicJsonRequired = [
  "axis",
  "title",
  "context",
  "research_question",
  "hypotheses",
  "field_or_corpus",
  "method",
  "feasibility",
  "rationale",
  "pitch",
  "stakes",
  "leads",
  "keywords_fr",
  "keywords_en",
  "ethical_notes",
  "research_object",
  "profile_links",
  "title_writing_language",
  "expected_contribution",
  "fieldwork_plan",
  "hypothesis_tests",
];

const profileAnalysisJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    strengths: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: TOPIC_LIMITS.profile_analysis_item,
      },
      maxItems: 5,
    },
    interests: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: TOPIC_LIMITS.profile_analysis_item,
      },
      maxItems: 5,
    },
    wants_to_learn: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: TOPIC_LIMITS.profile_analysis_item,
      },
      maxItems: 5,
    },
    constraints: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: TOPIC_LIMITS.profile_analysis_item,
      },
      maxItems: 5,
    },
    missing: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: TOPIC_LIMITS.profile_analysis_item,
      },
      maxItems: 5,
    },
  },
  required: [
    "strengths",
    "interests",
    "wants_to_learn",
    "constraints",
    "missing",
  ],
  additionalProperties: false,
};

/** JSON Schema for Anthropic tool input_schema — propose_topics. */
export const proposeTopicsInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    profile_analysis: profileAnalysisJsonSchema,
    personalization_level: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    topics: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: topicJsonSchemaProperties,
        required: topicJsonRequired,
        additionalProperties: false,
      },
    },
  },
  required: ["profile_analysis", "personalization_level", "topics"],
  additionalProperties: false,
};

/** JSON Schema for Anthropic tool input_schema — propose_topic (regen / axe). */
export const proposeTopicInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: {
      type: "object",
      properties: topicJsonSchemaProperties,
      required: topicJsonRequired,
      additionalProperties: false,
    },
    profile_analysis: profileAnalysisJsonSchema,
    personalization_level: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
  required: ["topic"],
  additionalProperties: false,
};

/** Variante mastery : profile_analysis obligatoire. */
export const proposeTopicMasteryInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: {
      type: "object",
      properties: topicJsonSchemaProperties,
      required: topicJsonRequired,
      additionalProperties: false,
    },
    profile_analysis: profileAnalysisJsonSchema,
    personalization_level: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
  },
  required: ["topic", "profile_analysis", "personalization_level"],
  additionalProperties: false,
};

export function zodIssueCodes(err: z.ZodError): string[] {
  return [
    ...new Set(
      err.issues.map((i) => `${i.path.join(".") || "root"}:${i.code}`),
    ),
  ].slice(0, 40);
}

function shapeMeta(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { root: Array.isArray(input) ? "array" : typeof input };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = `array(${v.length})`;
    else if (v === null) out[k] = "null";
    else out[k] = typeof v;
  }
  return out;
}

/** Normalise quelques formes alternatives renvoyées par le modèle. */
function normalizeProposeTopicsInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = { ...(input as Record<string, unknown>) };
  for (const wrap of ["input", "result", "data", "output"]) {
    const inner = obj[wrap];
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      ("topics" in (inner as object) || "profile_analysis" in (inner as object))
    ) {
      return normalizeProposeTopicsInput(inner);
    }
  }
  if (obj.topics && !Array.isArray(obj.topics) && typeof obj.topics === "object") {
    const vals = Object.values(obj.topics as Record<string, unknown>);
    if (vals.length === 3) obj.topics = vals;
  }
  return obj;
}

export function parseProposeTopicsToolInput(
  input: unknown,
): ProposeTopicsToolInput {
  const normalized = normalizeProposeTopicsInput(input);
  const result = proposeTopicsSchema.safeParse(normalized);
  if (!result.success) {
    console.info(
      JSON.stringify({
        event: "topics.validate",
        status: "error",
        tool: "propose_topics",
        shape: shapeMeta(normalized),
        issues: zodIssueCodes(result.error),
      }),
    );
    throw result.error;
  }
  return result.data;
}

export function parseProposeTopicToolInput(
  input: unknown,
): ProposeTopicToolInput {
  const result = proposeTopicSchema.safeParse(input);
  if (!result.success) {
    console.info(
      JSON.stringify({
        event: "topics.validate",
        status: "error",
        tool: "propose_topic",
        issues: zodIssueCodes(result.error),
      }),
    );
    throw result.error;
  }
  return result.data;
}

export function parseTopicsOutput(raw: string): TopicsOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON invalide.");
    parsed = JSON.parse(match[0]);
  }
  const data = topicsOutputSchema.parse(parsed);
  return {
    topics: data.topics,
    profile_analysis: data.profile_analysis as ProfileAnalysis | undefined,
    personalization_level: data.personalization_level,
  };
}

/** Champs du sujet acceptés dans un patch correctif (sans axis). */
const patchFieldLlmSchema = z.object({
  title: z.string().optional(),
  context: z.string().optional(),
  research_question: z.string().optional(),
  hypotheses: z.array(z.string()).optional(),
  field_or_corpus: z.string().optional(),
  method: z.string().optional(),
  feasibility: z
    .object({
      level: z.enum(["high", "medium", "low"]).optional(),
      risks: z.array(z.string()).optional(),
      first_steps: z.array(z.string()).optional(),
    })
    .optional(),
  rationale: z.string().optional(),
  pitch: z.string().optional(),
  stakes: z.array(z.string()).optional(),
  leads: z.array(z.string()).optional(),
  keywords_fr: z.array(z.string()).optional(),
  keywords_en: z.array(z.string()).optional(),
  ethical_notes: z.string().nullable().optional(),
  research_object: z.string().optional(),
  profile_links: z
    .array(
      z.object({
        field: z.string(),
        profile_value: z.string(),
        use: z.string(),
      }),
    )
    .optional(),
  title_writing_language: z.string().nullable().optional(),
  expected_contribution: z.string().optional(),
  fieldwork_plan: z
    .array(
      z.object({
        unit: z.string(),
        quantity: z.number(),
      }),
    )
    .optional(),
  hypothesis_tests: z
    .array(
      z.object({
        hypothesis_index: z.number(),
        comparison_or_variable: z.string(),
        data_source: z.string(),
      }),
    )
    .optional(),
});

export const patchTopicLlmSchema = z.object({
  fields: patchFieldLlmSchema,
});

/** JSON Schema allégé — pas de minLength strict (revalidation au merge). */
const patchJsonProperties: Record<string, unknown> = {
  title: { type: "string" },
  context: { type: "string" },
  research_question: { type: "string" },
  hypotheses: { type: "array", items: { type: "string" } },
  field_or_corpus: { type: "string" },
  method: { type: "string" },
  feasibility: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["high", "medium", "low"] },
      risks: { type: "array", items: { type: "string" } },
      first_steps: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
  rationale: { type: "string" },
  pitch: { type: "string" },
  stakes: { type: "array", items: { type: "string" } },
  leads: { type: "array", items: { type: "string" } },
  keywords_fr: { type: "array", items: { type: "string" } },
  keywords_en: { type: "array", items: { type: "string" } },
  ethical_notes: { type: ["string", "null"] },
  research_object: { type: "string" },
  profile_links: {
    type: "array",
    items: {
      type: "object",
      properties: {
        field: { type: "string" },
        profile_value: { type: "string" },
        use: { type: "string" },
      },
      required: ["field", "profile_value", "use"],
      additionalProperties: false,
    },
  },
  title_writing_language: { type: ["string", "null"] },
  expected_contribution: { type: "string" },
  fieldwork_plan: {
    type: "array",
    items: {
      type: "object",
      properties: {
        unit: { type: "string" },
        quantity: { type: "number" },
      },
      required: ["unit", "quantity"],
      additionalProperties: false,
    },
  },
  hypothesis_tests: {
    type: "array",
    items: {
      type: "object",
      properties: {
        hypothesis_index: { type: "integer" },
        comparison_or_variable: { type: "string" },
        data_source: { type: "string" },
      },
      required: ["hypothesis_index", "comparison_or_variable", "data_source"],
      additionalProperties: false,
    },
  },
};

/** JSON Schema tool — patch_topic (champs optionnels uniquement). */
export const patchTopicInputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    fields: {
      type: "object",
      properties: patchJsonProperties,
      additionalProperties: false,
    },
  },
  required: ["fields"],
  additionalProperties: false,
};

export type PatchTopicFields = z.infer<typeof patchFieldLlmSchema>;

export function parsePatchTopicToolInput(input: unknown): {
  fields: PatchTopicFields;
} {
  const result = patchTopicLlmSchema.safeParse(input);
  if (!result.success) {
    console.info(
      JSON.stringify({
        event: "topics.validate",
        status: "error",
        tool: "patch_topic",
        issues: zodIssueCodes(result.error),
      }),
    );
    throw result.error;
  }
  return result.data;
}

/**
 * Fusionne un patch partiel sur un sujet existant, puis revalide via topicSchema.
 */
export function mergeTopicPatch(
  base: Record<string, unknown>,
  fields: PatchTopicFields,
): z.infer<typeof topicSchema> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === "feasibility" && value && typeof value === "object") {
      const prev = (base.feasibility || {}) as Record<string, unknown>;
      const next = value as Record<string, unknown>;
      merged.feasibility = {
        level: next.level ?? prev.level,
        risks: next.risks ?? prev.risks,
        first_steps: next.first_steps ?? prev.first_steps,
      };
      continue;
    }
    merged[key] = value;
  }
  // Ne jamais laisser le patch changer l'axe.
  merged.axis = base.axis;
  delete merged.warnings;
  delete merged.literature_density;
  const parsed = topicSchema.safeParse(merged);
  if (!parsed.success) {
    console.info(
      JSON.stringify({
        event: "topics.validate",
        status: "error",
        tool: "patch_topic_merge",
        issues: zodIssueCodes(parsed.error),
      }),
    );
    throw parsed.error;
  }
  return parsed.data;
}
