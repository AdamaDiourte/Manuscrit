/**
 * Couche d’accès Claude (Anthropic / Bedrock / Vertex).
 * Ne journalise jamais prompts, contenus ni clés.
 * Non branchée sur les routes research tant que AI_PROVIDER n’est pas activé (lots 2/3).
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { APIError } from "@anthropic-ai/sdk/error";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ContentBlockParam,
  MessageCreateParamsNonStreaming,
  MessageBatch,
} from "@anthropic-ai/sdk/resources/messages";
import type { z } from "zod";

export type AiProvider =
  | "anthropic"
  | "bedrock"
  | "vertex"
  | "openai-compatible";

export type ClaudeTier = "fast" | "smart";

export type ClaudeTextPart = { type: "text"; text: string };
export type ClaudeImagePart = {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};
export type ClaudePdfPart = {
  type: "document";
  mediaType: "application/pdf";
  data: string;
};
export type ClaudeContentPart =
  | ClaudeTextPart
  | ClaudeImagePart
  | ClaudePdfPart;
export type ClaudeContent = string | ClaudeContentPart[];

export type ClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type CallClaudeParams<T extends z.ZodType> = {
  tier: ClaudeTier;
  system: string;
  content: ClaudeContent;
  schema: T;
  maxTokens: number;
};

export type CallClaudeResult<T> = {
  data: T;
  model: string;
  usage: ClaudeUsage;
};

export type BatchRequestParams = {
  /** Identifiant stable (ex. unitId). */
  customId: string;
  tier: ClaudeTier;
  system: string;
  content: ClaudeContent;
  schema: z.ZodType;
  maxTokens: number;
};

export type BatchStatus = {
  id: string;
  processingStatus: MessageBatch["processing_status"];
  requestCounts: MessageBatch["request_counts"];
  endedAt: string | null;
  expiresAt: string;
  resultsUrl: string | null;
};

export type BatchResultItem = {
  customId: string;
  status: "succeeded" | "errored" | "canceled" | "expired";
  text?: string;
  usage?: ClaudeUsage;
  error?: string;
};

const TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_FAST = "claude-haiku-5-5";
const DEFAULT_SMART = "claude-sonnet-5-5";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BATCH_THRESHOLD = 800;

type ClaudeClient = Anthropic | AnthropicBedrock | AnthropicVertex;

let cachedClient: ClaudeClient | null = null;
let cachedProvider: AiProvider | null = null;

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Fournisseur effectif : absent → openai-compatible (comportement actuel). */
export function resolveAiProvider(): AiProvider {
  const raw = env("AI_PROVIDER").toLowerCase();
  if (!raw || raw === "openai-compatible") return "openai-compatible";
  if (raw === "anthropic" || raw === "bedrock" || raw === "vertex") return raw;
  throw new Error(
    `AI_PROVIDER invalide (« ${raw} »). Valeurs : anthropic | bedrock | vertex | openai-compatible.`,
  );
}

export function isClaudeProvider(provider = resolveAiProvider()): boolean {
  return (
    provider === "anthropic" ||
    provider === "bedrock" ||
    provider === "vertex"
  );
}

export type ProviderCapabilities = {
  batch: boolean;
  promptCaching: boolean;
  vision: boolean;
  pdf: boolean;
};

/**
 * Capacités selon AI_PROVIDER (réf. docs Anthropic / Bedrock / Vertex).
 * Prompt caching : breakpoints explicites `cache_control` sur blocs — supportés
 * sur Anthropic, Bedrock et Vertex (le caching « automatic » top-level n’est pas
 * utilisé ici ; il est limité hors Bedrock runtime).
 */
export function providerCapabilities(
  provider = resolveAiProvider(),
): ProviderCapabilities {
  if (provider === "anthropic")
    return { batch: true, promptCaching: true, vision: true, pdf: true };
  if (provider === "bedrock" || provider === "vertex")
    return { batch: false, promptCaching: true, vision: true, pdf: true };
  return { batch: false, promptCaching: false, vision: false, pdf: false };
}

export function getClaudeSettings() {
  return {
    provider: resolveAiProvider(),
    modelFast: env("AI_MODEL_FAST") || DEFAULT_FAST,
    modelSmart: env("AI_MODEL_SMART") || DEFAULT_SMART,
    concurrency: envInt("AI_CONCURRENCY", DEFAULT_CONCURRENCY),
    batchThreshold: envInt("AI_BATCH_THRESHOLD", DEFAULT_BATCH_THRESHOLD),
    capabilities: providerCapabilities(),
  };
}

function modelForTier(tier: ClaudeTier): string {
  const { modelFast, modelSmart } = getClaudeSettings();
  return tier === "fast" ? modelFast : modelSmart;
}

/**
 * Vérifie la config Claude quand AI_PROVIDER est anthropic|bedrock|vertex.
 * Sans effet si le fournisseur est absent ou openai-compatible.
 */
export function assertClaudeConfig(): void {
  const provider = resolveAiProvider();
  if (!isClaudeProvider(provider)) return;

  if (provider === "anthropic") {
    if (!env("ANTHROPIC_API_KEY"))
      throw new Error(
        "AI_PROVIDER=anthropic : renseignez ANTHROPIC_API_KEY (fichier .env, non versionné).",
      );
    return;
  }

  if (provider === "bedrock") {
    const region = env("AWS_REGION") || env("AWS_DEFAULT_REGION");
    if (!region)
      throw new Error(
        "AI_PROVIDER=bedrock : renseignez AWS_REGION (ou AWS_DEFAULT_REGION). Identifiants AWS via la chaîne de credentials standard (ex. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) ou le profil local.",
      );
    return;
  }

  // vertex
  const region = env("CLOUD_ML_REGION");
  const projectId = env("ANTHROPIC_VERTEX_PROJECT_ID");
  if (!region || !projectId)
    throw new Error(
      "AI_PROVIDER=vertex : renseignez CLOUD_ML_REGION et ANTHROPIC_VERTEX_PROJECT_ID. Authentification via google-auth-library (ADC / compte de service).",
    );
}

function createClient(provider: AiProvider): ClaudeClient {
  if (provider === "anthropic") {
    return new Anthropic({
      apiKey: env("ANTHROPIC_API_KEY"),
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (provider === "bedrock") {
    const awsRegion = env("AWS_REGION") || env("AWS_DEFAULT_REGION");
    const access = env("AWS_ACCESS_KEY_ID");
    const secret = env("AWS_SECRET_ACCESS_KEY");
    const session = env("AWS_SESSION_TOKEN");
    if (access && secret) {
      return new AnthropicBedrock({
        awsRegion,
        awsAccessKey: access,
        awsSecretKey: secret,
        ...(session ? { awsSessionToken: session } : {}),
        timeout: TIMEOUT_MS,
        maxRetries: 0,
      });
    }
    return new AnthropicBedrock({
      awsRegion,
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  if (provider === "vertex") {
    return new AnthropicVertex({
      region: env("CLOUD_ML_REGION"),
      projectId: env("ANTHROPIC_VERTEX_PROJECT_ID"),
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  throw new Error(
    "Le fournisseur actif est openai-compatible : utilisez backend/src/services/llm/client.ts.",
  );
}

function getClient(): ClaudeClient {
  const provider = resolveAiProvider();
  assertClaudeConfig();
  if (!isClaudeProvider(provider))
    throw new Error(
      "Le fournisseur actif est openai-compatible : utilisez backend/src/services/llm/client.ts.",
    );
  if (!cachedClient || cachedProvider !== provider) {
    cachedClient = createClient(provider);
    cachedProvider = provider;
  }
  return cachedClient;
}

function requireAnthropicBatches(): Anthropic {
  const provider = resolveAiProvider();
  if (provider !== "anthropic")
    throw new Error(
      "Le mode lot (Message Batches API) n’est disponible qu’avec AI_PROVIDER=anthropic. Les SDK Bedrock et Vertex n’exposent pas cette API.",
    );
  return getClient() as Anthropic;
}

function toContentBlocks(content: ClaudeContent): ContentBlockParam[] {
  if (typeof content === "string")
    return [{ type: "text", text: content }];
  return content.map((part): ContentBlockParam => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image")
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mediaType,
          data: part.data,
        },
      };
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: part.data,
      },
    };
  });
}

function systemBlocks(system: string, enableCache: boolean) {
  return [
    {
      type: "text" as const,
      text: system,
      ...(enableCache ? { cache_control: { type: "ephemeral" as const } } : {}),
    },
  ];
}

function usageFrom(raw: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | null | undefined): ClaudeUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    cacheCreationInputTokens: raw?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: raw?.cache_read_input_tokens ?? 0,
  };
}

function textFromMessage(content: Array<{ type: string; text?: string }>): string {
  const text = content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  if (!text) throw new Error("Réponse Claude vide ou sans bloc texte.");
  return text;
}

export function parseClaudeOutput<T extends z.ZodType>(
  schema: T,
  text: string,
): z.infer<T> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new Error("Réponse Claude : JSON invalide.");
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success)
    throw new Error("Réponse Claude : schéma Zod non respecté.");
  return parsed.data;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof APIError)) return false;
  const status = err.status;
  if (status === undefined) return false;
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) throw err;
      await sleep(1000 * attempt);
    }
  }
  throw last;
}

function buildMessageParams(
  params: Omit<CallClaudeParams<z.ZodType>, "schema"> & { schema: z.ZodType },
  provider: AiProvider,
): MessageCreateParamsNonStreaming {
  const caching = providerCapabilities(provider).promptCaching;
  return {
    model: modelForTier(params.tier),
    max_tokens: params.maxTokens,
    system: systemBlocks(params.system, caching),
    messages: [{ role: "user", content: toContentBlocks(params.content) }],
    output_config: { format: zodOutputFormat(params.schema) },
  };
}

/**
 * Appel Claude unique avec sortie JSON structurée (output_config.format / json_schema),
 * validée par Zod à la réception. Prompt caching sur le bloc system (si supporté).
 */
export async function callClaude<T extends z.ZodType>(
  params: CallClaudeParams<T>,
): Promise<CallClaudeResult<z.infer<T>>> {
  const provider = resolveAiProvider();
  const client = getClient();
  const messageParams = buildMessageParams(params, provider);

  const message = await withRetries(() =>
    client.messages.create(messageParams),
  );

  const text = textFromMessage(message.content as Array<{ type: string; text?: string }>);
  const data = parseClaudeOutput(params.schema, text);
  return {
    data,
    model: message.model,
    usage: usageFrom(message.usage),
  };
}

/** Soumet un lot Message Batches (custom_id = unitId). Anthropic direct uniquement. */
export async function submitBatch(
  requests: BatchRequestParams[],
): Promise<{ id: string }> {
  if (!requests.length)
    throw new Error("submitBatch : au moins une requête est requise.");
  const ids = new Set(requests.map((r) => r.customId));
  if (ids.size !== requests.length)
    throw new Error("submitBatch : chaque customId (unitId) doit être unique.");

  const client = requireAnthropicBatches();
  const provider = resolveAiProvider();
  const batch = await withRetries(() =>
    client.messages.batches.create({
      requests: requests.map((r) => ({
        custom_id: r.customId,
        params: buildMessageParams(r, provider),
      })),
    }),
  );
  return { id: batch.id };
}

/** Interroge l’état d’un lot. */
export async function pollBatch(id: string): Promise<BatchStatus> {
  const client = requireAnthropicBatches();
  const batch = await withRetries(() => client.messages.batches.retrieve(id));
  return {
    id: batch.id,
    processingStatus: batch.processing_status,
    requestCounts: batch.request_counts,
    endedAt: batch.ended_at,
    expiresAt: batch.expires_at,
    resultsUrl: batch.results_url,
  };
}

/** Récupère les résultats d’un lot terminé (ordre non garanti — indexer par customId). */
export async function fetchBatchResults(
  id: string,
): Promise<BatchResultItem[]> {
  const client = requireAnthropicBatches();
  const status = await pollBatch(id);
  if (status.processingStatus !== "ended")
    throw new Error(
      `fetchBatchResults : le lot ${id} n’est pas terminé (statut : ${status.processingStatus}).`,
    );

  const items: BatchResultItem[] = [];
  const stream = await client.messages.batches.results(id);
  for await (const row of stream) {
    const customId = row.custom_id;
    const result = row.result;
    if (result.type === "succeeded") {
      items.push({
        customId,
        status: "succeeded",
        text: textFromMessage(
          result.message.content as Array<{ type: string; text?: string }>,
        ),
        usage: usageFrom(result.message.usage),
      });
      continue;
    }
    if (result.type === "errored") {
      items.push({
        customId,
        status: "errored",
        error: result.error?.error?.message || "Erreur lot Claude.",
      });
      continue;
    }
    items.push({
      customId,
      status: result.type,
      error:
        result.type === "canceled"
          ? "Requête annulée."
          : "Requête expirée.",
    });
  }
  return items;
}

/** À appeler au démarrage du serveur : échoue clairement si Claude est mal configuré. */
export function assertClaudeConfigAtStartup(): void {
  try {
    assertClaudeConfig();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Configuration Claude invalide.";
    console.error("Manuscrit : configuration IA Claude — " + message);
    throw err;
  }
}
