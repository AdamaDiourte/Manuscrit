import { buildPseudonymizedProfile } from "../privacy/buildPseudonymizedProfile";
import { chatCompletion } from "../llm/client";
import { buildUserPrompt, systemPrompt } from "./promptBuilder";
import { parseTopicsOutput } from "./validateOutput";
import type {
  RegenReason,
  TopicAxis,
  TopicsOutput,
} from "../../../../shared/research/topicTypes";

export async function generateTopics(
  answers: Record<string, unknown>,
  env: Record<string, string>,
  regenerate?: {
    axis: TopicAxis;
    reason: RegenReason;
    previousTitle?: string;
    previousTopics?: TopicsOutput["topics"];
  },
): Promise<{ topics: TopicsOutput["topics"]; model: string; tokens?: number }> {
  const profile = buildPseudonymizedProfile(answers);
  const messages = [
    { role: "system" as const, content: systemPrompt() },
    {
      role: "user" as const,
      content: buildUserPrompt({
        axes: profile.axes,
        fields: profile.fields,
        regenerate: regenerate
          ? {
              axis: regenerate.axis,
              reason: regenerate.reason,
              previousTitle: regenerate.previousTitle,
            }
          : undefined,
      }),
    },
  ];

  const run = async () => {
    const result = await chatCompletion(messages, env, {
      temperature: regenerate ? 0.55 : 0.4,
      maxTokens: 4500,
    });
    return {
      topics: parseTopicsOutput(result.content).topics,
      model: result.model,
      tokens: result.usage?.total_tokens,
    };
  };

  try {
    const first = await run();
    if (regenerate?.previousTopics?.length === 3) {
      const replacement = first.topics.find((t) => t.axis === regenerate.axis);
      if (replacement) {
        return {
          ...first,
          topics: regenerate.previousTopics.map((t) =>
            t.axis === regenerate.axis ? replacement : t,
          ),
        };
      }
    }
    return first;
  } catch {
    // One retry on invalid JSON / schema
    const second = await run();
    if (regenerate?.previousTopics?.length === 3) {
      const replacement = second.topics.find((t) => t.axis === regenerate.axis);
      if (replacement) {
        return {
          ...second,
          topics: regenerate.previousTopics.map((t) =>
            t.axis === regenerate.axis ? replacement : t,
          ),
        };
      }
    }
    return second;
  }
}
