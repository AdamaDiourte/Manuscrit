import type { RegenReason, TopicAxis } from "../../../../shared/research/topicTypes";
import { REGEN_REASON_LABELS } from "../../../../shared/research/topicTypes";
import { RESEARCH_TOPICS_SYSTEM } from "../../prompts/researchTopicsSystem";

export function systemPrompt(): string {
  return RESEARCH_TOPICS_SYSTEM;
}

export function buildUserPrompt(input: {
  axes: Record<string, Record<string, unknown>>;
  fields: Record<string, unknown>;
  regenerate?: { axis: TopicAxis; reason: RegenReason; previousTitle?: string };
}): string {
  const schemaHint = {
    topics: [
      {
        axis: "mastery | ambition | discovery",
        title: "string",
        context:
          "2 à 3 phrases max : situer le sujet (actualité, histoire, débat public, enjeu disciplinaire)",
        research_question: "string",
        hypotheses: ["string"],
        field_or_corpus: "string",
        method: "string",
        feasibility: {
          level: "high | medium | low",
          risks: ["string"],
          first_steps: ["string"],
        },
        rationale: "string",
        keywords_fr: ["string"],
        keywords_en: ["string"],
        ethical_notes: "string | null",
      },
    ],
  };

  const parts: string[] = [
    "Profil pseudonymisé regroupé par axes (M=maîtrise, A=ambition, D=découverte, F=faisabilité) :",
    JSON.stringify({ axes: input.axes, fields: input.fields }),
    "Schéma de sortie JSON strict :",
    JSON.stringify(schemaHint),
  ];

  if (input.regenerate) {
    parts.push(
      `Régénère en priorité le sujet d’axe "${input.regenerate.axis}". Conserve la cohérence des trois axes mastery, ambition et discovery dans le JSON.`,
      `Motif de régénération : ${REGEN_REASON_LABELS[input.regenerate.reason]}.`,
    );
    if (input.regenerate.previousTitle)
      parts.push(
        `Titre précédent à remplacer : ${input.regenerate.previousTitle}`,
      );
  }

  return parts.join("\n\n");
}
