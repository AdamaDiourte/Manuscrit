export const questions = [
  [
    "interests",
    "Quels sujets vous intéressent ?",
    "Un phénomène, une expérience ou une question qui vous intrigue.",
  ],
  [
    "discipline",
    "Dans quelle discipline travaillez-vous ?",
    "Votre discipline et, si utile, votre spécialité.",
  ],
  [
    "skills",
    "Quelles compétences pouvez-vous mobiliser ?",
    "Lectures, techniques d’enquête ou outils déjà maîtrisés.",
  ],
  [
    "aims",
    "Qu’aimeriez-vous comprendre ?",
    "Vos objectifs scientifiques, personnels ou professionnels.",
  ],
  [
    "methods",
    "Quel terrain et quelles méthodes envisagez-vous ?",
    "Accès aux personnes ou aux archives, préférences, temps disponible.",
  ],
  [
    "literature",
    "Quels travaux avez-vous déjà repérés ?",
    "Références lues, débats ou limites à explorer.",
  ],
] as const;
/** Mode de recueil lisible d’une fiche (outil, sinon type de données). */
export function materialCollectionModeLabel(m: {
  toolType?: string;
  type?: string;
}): string {
  const tool = String(m.toolType || "").trim();
  if (tool && tool !== "Aucun") return tool;
  return String(m.type || "").trim();
}

export function materialCode(m: { id: string; type: string }) {
  const prefixes: Record<string, string> = {
    "Grille d’entretien": "GRI",
    Questionnaire: "QST",
    "Grille d’observation": "GOB",
    "Autre outil": "OUT",
    Aucun: "AUC",
    "Entretien réalisé": "ENT",
    "Réponses au questionnaire": "REP",
    "Notes d’observation": "OBS",
    "Notes de lecture bibliographiques": "LEC",
    "Archives/données secondaires": "ARC",
    "Cartes / SIG": "MAP",
    Autres: "AUT",
    // Anciens libellés (fiches déjà enregistrées)
    Entretien: "ENT",
    Archive: "ARC",
    Observation: "OBS",
    "Référence bibliographique": "BIB",
    "Analyse statistique": "STA",
    "Tableau statistique": "TAB",
    Graphique: "FIG",
    Carte: "MAP",
    "Note de lecture": "LEC",
    "Données empiriques": "EMP",
    Résultat: "RES",
    Document: "DOC",
    Note: "NOT",
  };
  return (prefixes[m.type] || "MAT") + "-" + m.id.slice(0, 8).toUpperCase();
}
/**
 * Texte agrégé pour l’IA et les offsets evidence.
 * Les transcriptions vision (hydratées depuis ObjectStore) sont TOUJOURS
 * concaténées à la fin, pour ne pas décaler les offsets des plans existants.
 * Sans transcription, le résultat est identique à l’agrégat historique
 * (observation + text + extracted + toolExtracted + extra).
 */
export function materialText(m: any) {
  const base = [
    m.observation,
    m.text,
    m.extracted,
    m.toolExtracted,
    ...Object.entries(m.extra || {})
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => k + " — " + v),
  ]
    .filter(Boolean)
    .join("\n\n");
  const vision = [m.visionTranscription, m.toolVisionTranscription]
    .filter((v) => typeof v === "string" && String(v).trim())
    .join("\n\n");
  if (!vision) return base;
  return base ? base + "\n\n" + vision : vision;
}

/** Longueur du texte « auteur » hors transcription IA (pour marquer les evidence). */
export function materialTextBaseLength(m: any): number {
  return [
    m.observation,
    m.text,
    m.extracted,
    m.toolExtracted,
    ...Object.entries(m.extra || {})
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => k + " — " + v),
  ]
    .filter(Boolean)
    .join("\n\n").length;
}
