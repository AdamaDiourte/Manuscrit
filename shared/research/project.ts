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
    Entretien: "ENT",
    Archive: "ARC",
    Observation: "OBS",
    Questionnaire: "QST",
    "Référence bibliographique": "BIB",
    "Analyse statistique": "STA",
    Graphique: "FIG",
    "Note de lecture": "LEC",
  };
  return (prefixes[m.type] || "MAT") + "-" + m.id.slice(0, 8).toUpperCase();
}
export function materialText(m: any) {
  return [
    m.text,
    m.extracted,
    ...Object.entries(m.extra || {})
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => k + " — " + v),
  ]
    .filter(Boolean)
    .join("\n\n");
}
