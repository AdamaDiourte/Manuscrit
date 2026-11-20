/**
 * Client LLM unifié : OpenAI-compatible (défaut) ou Claude si AI_PROVIDER=anthropic|bedrock|vertex.
 * Never log prompts, completions, or API keys.
 */

import {
  callClaudeChat,
  isClaudeProvider,
  isLlmConfigured,
} from "./claude";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmResult = {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export { isLlmConfigured };

function splitMessages(messages: ChatMessage[]): {
  system: string;
  user: string;
} {
  const systemParts: string[] = [];
  const other: string[] = [];
  for (const message of messages) {
    if (message.role === "system") systemParts.push(message.content);
    else
      other.push(
        (message.role === "assistant" ? "Assistant : " : "") + message.content,
      );
  }
  const user = other.join("\n\n").trim();
  if (!user)
    throw Object.assign(new Error("Demande IA vide."), { status: 500 });
  return {
    system: systemParts.join("\n\n").trim() || "Répondez en JSON valide.",
    user,
  };
}

async function chatCompletionViaClaude(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<LlmResult> {
  const { system, user } = splitMessages(messages);
  const result = await callClaudeChat({
    tier: "smart",
    system,
    user,
    maxTokens: options?.maxTokens ?? 4500,
    temperature: options?.temperature,
  });
  return {
    content: result.content,
    model: result.model,
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  env: Record<string, string>,
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<LlmResult> {
  if (!isLlmConfigured(env))
    throw Object.assign(new Error("Le service IA n’est pas encore configuré."), {
      status: 503,
    });

  if (isClaudeProvider()) return chatCompletionViaClaude(messages, options);

  if (!env.AI_BASE_URL || !env.AI_MODEL || !env.AI_API_KEY)
    throw Object.assign(new Error("Le service IA n’est pas encore configuré."), {
      status: 503,
    });
  const url = new URL(env.AI_BASE_URL.replace(/\/+$/, "") + "/chat/completions");
  if (url.protocol !== "https:" && process.env.NODE_ENV !== "development")
    throw new Error("Le service IA requiert une connexion HTTPS.");

  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(options?.timeoutMs ?? 90000),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.AI_API_KEY,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? 4500,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(
        response.status === 429
          ? "Service IA saturé. Réessayez ultérieurement."
          : "Le fournisseur IA n’a pas pu réaliser la génération.",
      ),
      { status: response.status === 429 ? 429 : 502 },
    );
  }

  const completion = (await response.json()) as {
    model?: string;
    usage?: LlmResult["usage"];
    choices?: { finish_reason?: string; message?: { content?: string } }[];
  };
  const choice = completion.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (
    !choice ||
    !content ||
    (choice.finish_reason && choice.finish_reason !== "stop")
  )
    throw new Error("Réponse IA vide ou interrompue.");

  return {
    content,
    model: completion.model || env.AI_MODEL,
    usage: completion.usage,
  };
}
