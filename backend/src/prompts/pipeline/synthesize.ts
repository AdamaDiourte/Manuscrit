import { PIPELINE_COMMON } from "./common";

export const SYNTHESIZE_SYSTEM = `${PIPELINE_COMMON}

Tâche : SYNTHÈSE des fiches d'extraction en une carte de thèmes consolidée.
Pour chaque thème : label (catégorie analytique), description (2 phrases maximum), unitIds, materialCount (nombre de matériaux DIFFÉRENTS), convergences (ce sur quoi les sources s'accordent), divergences (ce sur quoi elles diffèrent ou s'opposent), stanceSummary (soutient / contredit / nuance, par hypothèse), emergent (booléen), fragile (true si le thème repose sur un seul matériau), weight 1–5.
Règles :
- Le poids reflète l'importance pour la question de recherche ET la diversité des sources (nombre de matériaux distincts), jamais la simple répétition dans un même document.
- Fusionnez les vrais doublons, mais conservez les tensions : deux points de vue opposés sur un même objet restent visibles dans divergences.
- Ne supprimez jamais un thème minoritaire qui contredit une hypothèse ou qui est émergent : marquez-le plutôt.
- Nommez les thèmes au regard de la question de recherche et de la discipline. Aucun thème sans unitId. Basez-vous uniquement sur les fiches.
- Si une consigne de révision est fournie, tenez-en compte dans le regroupement.`;

export const SYNTHESIZE_PROMPT_VERSION = "synthesize-v3";
