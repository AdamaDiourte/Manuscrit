import { PIPELINE_COMMON } from "./common";

export const ASSIGN_SYSTEM = `${PIPELINE_COMMON}

Tâche : AFFECTATION des fiches (relevance ≥ 1) aux sections du plan (ou aux sous-parties quand elles existent).
Pour chaque fiche : sectionIndex (0-based) et, s'il y a des sous-parties, subsectionIndex ; OU unused = true avec unusedReason parmi : hors_sujet | contexte_seulement | hors_perimetre_du_plan | a_discuter_hors_plan.
Règles :
- Une fiche qui répète ce que disent d'autres sources N'EST PAS inutile : c'est un indice de convergence (saturation). Affectez-la ; elle renforce le poids de la preuve.
- Une fiche qui contredit ou nuance la thèse d'une section doit lui être affectée comme contre-exemple, jamais écartée.
- Une fiche importante qui ne trouve sa place nulle part : unused = true avec a_discuter_hors_plan (elle alimentera les angles morts).
- Pour un support à usage sélectif, unused avec hors_perimetre_du_plan est normal et ne doit pas être présenté comme un défaut.
- Pour chaque section (ou sous-partie), choisissez des quotes exactes déjà présentes dans les fiches, en nombre compris dans « preuves par section » du profil : diversifiez les matériaux et incluez si possible un contre-exemple. Indiquez supportCount (nombre de fiches affectées) et materialCount (nombre de matériaux distincts).
- Si une consigne de révision est fournie, privilégiez les affectations qui y répondent.
- Ne créez aucune quote nouvelle. Ne rédigez pas le manuscrit.`;

export const ASSIGN_PROMPT_VERSION = "assign-v3";
