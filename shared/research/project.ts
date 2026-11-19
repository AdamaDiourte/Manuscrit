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
export function materialText(m: any) {
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
    .join("\n\n");
}
