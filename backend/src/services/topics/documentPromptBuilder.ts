import {
  documentKindLabel,
  mainDocumentLabel,
  PROJECT_TYPE_LABELS,
  type DocumentKind,
  type DocumentOutline,
  type ProjectTypeId,
} from "../../../../shared/research/documentStructures";
import type { GeneratedTopic } from "../../../../shared/research/topicTypes";
import { RESEARCH_DOCUMENT_SYSTEM } from "../../prompts/researchDocumentSystem";

export function documentSystemPrompt(): string {
  return RESEARCH_DOCUMENT_SYSTEM;
}

export function buildDocumentUserPrompt(input: {
  outline: DocumentOutline;
  topic: GeneratedTopic;
  axes: Record<string, Record<string, unknown>>;
  fields: Record<string, unknown>;
  kind: DocumentKind;
  projectType: ProjectTypeId;
}): string {
  const kindLabel = documentKindLabel(input.kind, input.projectType);
  const mainLabel = mainDocumentLabel(input.projectType);

  const schemaHint =
    input.kind === "work_plan"
      ? {
          kind: "work_plan",
          projectType: input.projectType,
          title: "string",
          subtitle: "string | optional",
          sections: [
            {
              id: "identity | map | schedule | priorities | checklist",
              heading: "string",
              paragraphs: ["1 paragraphe court max (sauf identity : 1 seul)"],
              bullets: ["branches courtes pour map / priorities / checklist"],
              table: {
                headers: [
                  "Période",
                  "Objectif",
                  "Actions",
                  "Livrable",
                  "Charge",
                ],
                rows: [
                  [
                    "ex. Semaines 1-2",
                    "Cadrer",
                    "Action 1 ; action 2",
                    "Note 1 page",
                    "8 h",
                  ],
                ],
              },
            },
          ],
        }
      : {
          kind: input.kind,
          projectType: input.projectType,
          title: "string",
          subtitle: "string | optional",
          sections: [
            {
              id: "section_id from outline",
              heading: "string",
              paragraphs: ["string", "string"],
              bullets: ["optional"],
            },
          ],
        };

  const workPlanExtra =
    input.kind === "work_plan"
      ? [
          "Contraintes de temps à respecter absolument (issues du formulaire) :",
          JSON.stringify({
            deadline_range:
              input.fields.deadline_range ?? input.axes?.F?.deadline_range,
            weekly_time:
              input.fields.weekly_time ?? input.axes?.F?.weekly_time,
            expected_length:
              input.fields.expected_length ?? input.axes?.F?.expected_length,
            project_type: input.projectType,
          }),
          `Livrable à organiser : ${mainLabel} (${PROJECT_TYPE_LABELS[input.projectType]}).`,
          "Le plan doit proposer un planning d’organisation concret : découper le délai de rendu en périodes, et dimensionner la colonne Charge selon le temps à consacrer au sujet par semaine (sans dépasser ce rythme).",
          "Obligatoire : section schedule avec champ table rempli (4 à 7 lignes) — Période | Objectif | Actions | Livrable | Charge.",
          "Volume : 1 à 2 pages. Style directif. Pas de reformulation du projet.",
        ]
      : [
          `Document demandé : ${mainLabel} pour un ${PROJECT_TYPE_LABELS[input.projectType]}.`,
          "Volume : environ 5 pages minimum, contenu substantiel.",
        ];

  return [
    `Type de document : ${kindLabel}.`,
    `Type de projet : ${PROJECT_TYPE_LABELS[input.projectType]}.`,
    input.outline.guidance,
    "Structure obligatoire (conserve tous les id, dans cet ordre) :",
    JSON.stringify(input.outline.sections),
    "Sujet retenu :",
    JSON.stringify(input.topic),
    "Profil pseudonymisé :",
    JSON.stringify({ axes: input.axes, fields: input.fields }),
    ...workPlanExtra,
    "Schéma JSON de sortie :",
    JSON.stringify(schemaHint),
    "Rappel : style naturel, pas de fausses références, pas de tirets dans les paragraphes.",
  ].join("\n\n");
}
