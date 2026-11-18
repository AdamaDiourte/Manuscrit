import {
  getDocumentOutline,
  normalizeProjectType,
  type DocumentKind,
} from "../../../../shared/research/documentStructures";
import type {
  GeneratedTopic,
  TopicDocument,
} from "../../../../shared/research/topicTypes";
import { buildPseudonymizedProfile } from "../privacy/buildPseudonymizedProfile";
import { chatCompletion } from "../llm/client";
import {
  buildDocumentUserPrompt,
  documentSystemPrompt,
} from "./documentPromptBuilder";
import {
  assertDocumentDensity,
  parseTopicDocument,
} from "./validateDocument";
import { simulateDocument } from "./simulateContent";
import { buildTopicDocx } from "./buildDocx";

function alignDocument(
  parsed: TopicDocument,
  outlineIds: string[],
  kind: DocumentKind,
  projectType: string,
): TopicDocument {
  const byId = new Map(parsed.sections.map((s) => [s.id, s]));
  const sections = outlineIds
    .map((id) => byId.get(id))
    .filter((s): s is TopicDocument["sections"][number] => Boolean(s));
  if (sections.length < outlineIds.length)
    throw new Error("Structure du document incomplète.");
  return {
    ...parsed,
    kind,
    projectType,
    sections,
  };
}

export async function generateTopicDocument(input: {
  answers: Record<string, unknown>;
  topic: GeneratedTopic;
  kind: DocumentKind;
  env: Record<string, string>;
  simulate?: boolean;
}): Promise<{
  document: TopicDocument;
  file: { filename: string; mimeType: string; base64: string };
  model: string;
  simulated: boolean;
}> {
  const projectType = normalizeProjectType(input.answers.project_type);
  const outline = getDocumentOutline(projectType, input.kind);
  const outlineIds = outline.sections.map((s) => s.id);

  let document: TopicDocument;
  let model = "simulation";
  let simulated = Boolean(input.simulate);

  if (input.simulate || !input.env.AI_API_KEY) {
    simulated = true;
    document = simulateDocument({
      answers: input.answers,
      topic: input.topic,
      kind: input.kind,
    });
  } else {
    const profile = buildPseudonymizedProfile(input.answers);
    const messages = [
      { role: "system" as const, content: documentSystemPrompt() },
      {
        role: "user" as const,
        content: buildDocumentUserPrompt({
          outline,
          topic: input.topic,
          axes: profile.axes,
          fields: {
            ...profile.fields,
            deadline_range: input.answers.deadline_range,
            weekly_time: input.answers.weekly_time,
            expected_length: input.answers.expected_length,
          },
          kind: input.kind,
          projectType,
        }),
      },
    ];

    const run = async () => {
      const result = await chatCompletion(messages, input.env, {
        temperature: input.kind === "work_plan" ? 0.35 : 0.45,
        maxTokens: input.kind === "work_plan" ? 3500 : 8000,
        timeoutMs: 180000,
      });
      const parsed = parseTopicDocument(result.content);
      const aligned = alignDocument(
        parsed,
        outlineIds,
        input.kind,
        projectType,
      );
      assertDocumentDensity(aligned);
      return { document: aligned, model: result.model };
    };

    try {
      const first = await run();
      document = first.document;
      model = first.model;
    } catch {
      const second = await run();
      document = second.document;
      model = second.model;
    }
  }

  const file = await buildTopicDocx(document);
  return {
    document,
    file: {
      filename: file.filename,
      mimeType: file.mimeType,
      base64: file.buffer.toString("base64"),
    },
    model,
    simulated,
  };
}
