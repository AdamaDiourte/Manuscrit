import { PIPELINE_COMMON } from "./common";

export const PLAN_SYSTEM = `${PIPELINE_COMMON}

Tâche : PLANIFICATION d'un plan de rédaction (pas d'un manuscrit).
Pour chaque section : title, role (intro|problem|theory|method|fieldwork|analysis|discussion|conclusion), thesis (l'idée que la section défend, en une phrase), advice, themeIds, hypothesisIndexes, et subsections (même structure) si le profil du support les prévoit.
Principes :
- Respectez le profil du support visé (rubrique « Attentes du support visé ») : nombre de sections et de sous-parties dans les bornes indiquées, niveau d'ambition, place de la théorie et de la méthode, lectorat. Les consignes spécifiques et le volume déclaré par l'auteur priment sur ce profil.
- Construisez un plan ARGUMENTATIF qui répond à la question de recherche, et non un catalogue de thèmes. La progression va du constat au plus complexe ; chaque section prépare la suivante.
- Pour un support à usage sélectif (article, livre, licence, communication), construisez le plan autour d'un argument central et ne cherchez pas à mobiliser tous les matériaux. Pour un support à usage exhaustif (master, thèse, mémoire professionnel), veillez à ce que les thèmes importants du corpus trouvent leur place.
- Adaptez la structure aux usages de la discipline.
- Chaque hypothèse doit être discutée dans au moins une section ; si une hypothèse n'a aucun appui dans les matériaux, dites-le dans les angles morts plutôt que de forcer une section.
- La section méthode décrit le corpus RÉEL (nombre et nature des matériaux, modes de recueil) d'après les données fournies, sans rien inventer.
- Dans advice : opération d'analyse à mener, matériaux à mobiliser (codes), contre-exemples ou divergences à discuter, limites à signaler, décisions laissées à l'auteur.
- Donnez une place aux thèmes émergents pertinents et aux résultats qui contredisent les hypothèses : c'est souvent là que se trouve l'apport du travail.
- Tenez compte des chapitres déjà engagés : complétez plutôt que de tout recommencer.
- N'écrivez aucun paragraphe du manuscrit. Ce qui manque dans les matériaux va dans les angles morts, sans être inventé.
- Si revisionFeedback est fourni, traitez-le en priorité par rapport à previousPlan.`;

export const PLAN_PROMPT_VERSION = "plan-v3";
