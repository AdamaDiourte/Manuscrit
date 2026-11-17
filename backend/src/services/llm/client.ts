/**
 * Single OpenAI-compatible Chat Completions client.
 * Never log prompts, completions, or API keys.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmResult = {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

export async function chatCompletion(
  messages: ChatMessage[],
  env: Record<string, string>,
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<LlmResult> {
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
