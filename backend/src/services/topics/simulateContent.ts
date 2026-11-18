import {
  getDocumentOutline,
  mainDocumentLabel,
  normalizeProjectType,
  PROJECT_TYPE_LABELS,
  type DocumentKind,
  type ProjectTypeId,
} from "../../../../shared/research/documentStructures";
import type {
  GeneratedTopic,
  TopicDocument,
  TopicsOutput,
} from "../../../../shared/research/topicTypes";

function projectLabel(answers: Record<string, unknown>) {
  const id = normalizeProjectType(answers.project_type);
  return PROJECT_TYPE_LABELS[id];
}

function disciplineHint(answers: Record<string, unknown>) {
  const raw = answers.discipline_main;
  if (typeof raw === "string" && raw.trim()) return raw.replace(/_/g, " ");
  return "votre discipline";
}

function themeHint(answers: Record<string, unknown>, topic: GeneratedTopic) {
  const imposed =
    typeof answers.imposed_theme === "string" && answers.imposed_theme.trim()
      ? answers.imposed_theme.trim()
      : "";
  return imposed || topic.title;
}

export function simulateTopics(
  answers: Record<string, unknown>,
): TopicsOutput["topics"] {
  const discipline = disciplineHint(answers);
  const typeLabel = projectLabel(answers);
  const imposedBy =
    typeof answers.imposed_by === "string" && answers.imposed_by.trim()
      ? answers.imposed_by.trim()
      : "";
  const theme =
    typeof answers.imposed_theme === "string" && answers.imposed_theme.trim()
      ? answers.imposed_theme.trim()
      : `pratiques et enjeux en ${discipline}`;

  const base = imposedBy
    ? `dans le cadre imposé (${imposedBy})`
    : "à partir de votre profil";

  const topics: GeneratedTopic[] = [
    {
      axis: "mastery",
      title: `${theme} : une lecture maîtrisée pour un ${typeLabel.toLowerCase()}`,
      context: `Le débat contemporain sur ${theme} croise des lectures déjà stabilisées en ${discipline}. Ce cadrage part d’un enjeu disciplinaire reconnu, sans forcer une ouverture trop large.`,
      research_question: `Comment analyser ${theme} en mobilisant les acquis déjà solides en ${discipline}, ${base} ?`,
      hypotheses: [
        `Les outils déjà maîtrisés en ${discipline} suffisent pour cadrer une première analyse crédible.`,
        "Un corpus ou un terrain accessible dans le délai déclaré permet de tester la question sans surcharger le calendrier.",
        "Les travaux antérieurs indiqués fournissent un point d’appui utile pour éviter de repartir de zéro.",
      ],
      field_or_corpus:
        "Corpus documentaire ciblé et, si pertinent, quelques entretiens ou observations limités selon l’accès déclaré.",
      method:
        "Démarche qualitative ou mixte sobre, alignée sur les compétences déjà présentes et sur le temps hebdomadaire indiqué.",
      feasibility: {
        level: "high",
        risks: [
          "Dispersion documentaire si la question reste trop large.",
          "Accès partiel aux sources selon le calendrier.",
        ],
        first_steps: [
          "Recenser 15 à 20 sources via des mots-clés précis.",
          "Rédiger une note de cadrage d’une page.",
          "Valider la portée du terrain ou du corpus avec l’encadrement.",
        ],
      },
      rationale: `Ce sujet de maîtrise s’appuie sur ${discipline}, le type « ${typeLabel} » et les contraintes de délai/temps du profil. Il reste volontairement tenable.`,
      keywords_fr: [discipline, theme, "méthode", "faisabilité", "cadrage"],
      keywords_en: ["research design", "feasibility", discipline, "methods"],
      ethical_notes: null,
    },
    {
      axis: "ambition",
      title: `Renforcer une compétence nouvelle autour de ${theme}`,
      context: `Face aux exigences actuelles du ${typeLabel.toLowerCase()}, ${theme} gagne à être traité avec une montée en compétence méthodologique. Le contexte est celui d’un apprentissage borné, utile et datable.`,
      research_question: `De quelle façon une montée en compétence méthodologique peut-elle éclairer ${theme} dans un ${typeLabel.toLowerCase()} ?`,
      hypotheses: [
        "L’apprentissage d’une méthode encore peu maîtrisée améliore la qualité de l’analyse si elle reste bornée.",
        "Le projet gagne à relier cette méthode à un livrable concret (grille, tableau, protocole).",
        "L’ambition reste réaliste si le calendrier réserve des semaines dédiées à l’apprentissage.",
      ],
      field_or_corpus:
        "Petit terrain pilote ou sous-corpus permettant d’appliquer la méthode à apprendre.",
      method:
        "Combiner une méthode déjà connue et une méthode à renforcer, avec un protocole simple et documenté.",
      feasibility: {
        level: "medium",
        risks: [
          "Sous-estimer le temps d’apprentissage de la nouvelle méthode.",
          "Vouloir couvrir trop de dimensions à la fois.",
        ],
        first_steps: [
          "Choisir une seule méthode à renforcer.",
          "Faire un mini-essai sur 3 à 5 unités d’analyse.",
          "Ajuster le protocole avant la collecte principale.",
        ],
      },
      rationale: `Axe ambition : le sujet pousse une progression utile pour le ${typeLabel}, sans ignorer le temps disponible déclaré.`,
      keywords_fr: [
        "compétence",
        "protocole",
        theme,
        "apprentissage",
        discipline,
      ],
      keywords_en: ["skills", "protocol", "methods training", "pilot study"],
      ethical_notes:
        "Si des personnes sont enquêtées, prévoir information claire et anonymisation dès le pilote.",
    },
    {
      axis: "discovery",
      title: `Un angle voisin pour relire ${theme}`,
      context: `Les discussions récentes autour de ${theme} laissent place à un détour disciplinaire contrôlé. L’angle voisin éclaire l’objet sans quitter le cadre du projet.`,
      research_question: `Quel éclairage apporte une perspective voisine de ${discipline} sur ${theme}, sans sortir des contraintes du projet ?`,
      hypotheses: [
        "Un détour disciplinaire contrôlé enrichit la problématique sans la rendre floue.",
        "Des mots-clés issus d’un champ voisin ouvrent des sources utiles et encore peu mobilisées.",
        "L’angle de découverte reste tenable s’il s’appuie sur un objet empirique unique.",
      ],
      field_or_corpus:
        "Objet empirique unique (cas, corpus court, dossier) servant de fil conducteur.",
      method:
        "Comparaison raisonnée de grilles de lecture, avec une collecte limitée et bien bornée.",
      feasibility: {
        level: "medium",
        risks: [
          "Risque de dispersion si l’ouverture disciplinaire n’est pas bornée.",
        ],
        first_steps: [
          "Nommer explicitement la discipline voisine mobilisée.",
          "Limiter l’objet à un cas ou un corpus court.",
          "Écrire une page de justification de l’angle.",
        ],
      },
      rationale: `Axe découverte : ouverture contrôlée à partir de ${discipline}, compatible avec le type « ${typeLabel} » et le cadre ${base}.`,
      keywords_fr: [
        "interdisciplinarité",
        theme,
        "angle",
        "cas",
        discipline,
      ],
      keywords_en: [
        "interdisciplinary",
        "case study",
        "research angle",
        "exploration",
      ],
      ethical_notes: null,
    },
  ];

  return topics;
}

function paragraph(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function expandSection(
  heading: string,
  intent: string,
  topic: GeneratedTopic,
  projectType: ProjectTypeId,
  kind: DocumentKind,
  answers: Record<string, unknown>,
  sectionId?: string,
): {
  paragraphs: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
} {
  const typeLabel = PROJECT_TYPE_LABELS[projectType];
  const theme = themeHint(answers, topic);
  const deadline =
    typeof answers.deadline_range === "string" ? answers.deadline_range : "";
  const weekly =
    typeof answers.weekly_time === "string" ? answers.weekly_time : "";
  const imposedBy =
    typeof answers.imposed_by === "string" ? answers.imposed_by : "";
  const deadlineLabel =
    deadline === "lt3m"
      ? "moins de 3 mois"
      : deadline === "3to6m"
        ? "3 à 6 mois"
        : deadline === "6to12m"
          ? "6 à 12 mois"
          : deadline === "gt1y"
            ? "plus d’un an"
            : deadline === "gt3y"
              ? "plus de 3 ans"
              : "à confirmer";
  const weeklyLabel =
    weekly === "lt5"
      ? "moins de 5 h / semaine"
      : weekly === "5to10"
        ? "5 à 10 h / semaine"
        : weekly === "10to20"
          ? "10 à 20 h / semaine"
          : weekly === "fulltime"
            ? "temps plein"
            : "à confirmer";
  const charge =
    weekly === "lt5"
      ? ["3–4 h", "4–5 h", "4–5 h", "5–6 h", "3–4 h"]
      : weekly === "5to10"
        ? ["6–8 h", "8–10 h", "8–10 h", "10–12 h", "6–8 h"]
        : weekly === "10to20"
          ? ["12–15 h", "14–18 h", "14–18 h", "16–20 h", "10–14 h"]
          : weekly === "fulltime"
            ? ["25–30 h", "28–35 h", "28–35 h", "30–35 h", "20–28 h"]
            : ["6–8 h", "8–10 h", "8–10 h", "10–12 h", "6–8 h"];
  const periods =
    deadline === "lt3m"
      ? [
          "Semaines 1–2",
          "Semaines 3–4",
          "Semaines 5–6",
          "Semaines 7–8",
          "Dernière semaine",
        ]
      : deadline === "3to6m"
        ? ["Mois 1", "Mois 2", "Mois 3–4", "Mois 5", "Mois 6"]
        : deadline === "6to12m"
          ? ["Mois 1–2", "Mois 3–4", "Mois 5–7", "Mois 8–10", "Mois 11–12"]
          : deadline === "gt3y"
            ? ["Année 1", "Année 2", "Année 3 (début)", "Année 3 (milieu)", "Fin de parcours"]
            : ["Trimestre 1", "Trimestre 2", "Trimestre 3", "Trimestre 4", "Finalisation"];

  if (kind === "work_plan") {
    if (sectionId === "identity") {
      return {
        paragraphs: [
          paragraph(
            `Livrable : ${typeLabel}. Sujet « ${topic.title} ». Délai de rendu : ${deadlineLabel}. Temps à consacrer au sujet : ${weeklyLabel}. Objectif : organiser un parcours tenable jusqu’au rendu, sans dispersion.`,
          ),
        ],
      };
    }
    if (sectionId === "map") {
      return {
        paragraphs: [
          paragraph(
            "Carte mentale du travail : chaque branche produit un petit livrable.",
          ),
        ],
        bullets: [
          `Cadrer la question : ${topic.research_question}`,
          `Stabiliser le terrain ou corpus : ${topic.field_or_corpus}`,
          `Appliquer la méthode : ${topic.method}`,
          "Rédiger par blocs courts et relire à chaque jalon",
          "Vérifier éthique, sources et conformité avant rendu",
        ],
      };
    }
    if (sectionId === "schedule") {
      return {
        paragraphs: [
          paragraph(
            `Planning proposé à partir du délai (${deadlineLabel}) et du rythme hebdomadaire (${weeklyLabel}). Ajustez les dates exactes avec votre encadrement.`,
          ),
        ],
        table: {
          headers: ["Période", "Objectif", "Actions", "Livrable", "Charge"],
          rows: [
            [
              periods[0],
              "Cadrer",
              "Préciser la question ; recenser 10–15 sources",
              "Note de cadrage (1 p.)",
              charge[0],
            ],
            [
              periods[1],
              "Collecter",
              `Préparer ${topic.field_or_corpus}`,
              "Grille ou corpus annoté",
              charge[1],
            ],
            [
              periods[2],
              "Analyser",
              "Coder / classer ; tester une hypothèse",
              "Tableau de résultats",
              charge[2],
            ],
            [
              periods[3],
              "Rédiger",
              "Écrire les parties centrales ; relire",
              "Brouillon structuré",
              charge[3],
            ],
            [
              periods[4],
              "Finaliser",
              "Intro, conclusion, normes, checklist",
              "Version remisable",
              charge[4],
            ],
          ],
        },
      };
    }
    if (sectionId === "priorities") {
      return {
        paragraphs: [
          paragraph("Si le calendrier se resserre, gardez l’essentiel."),
        ],
        bullets: [
          "Garder : question claire, un terrain borné, une méthode unique",
          "Simplifier : moins de cas, moins de chapitres, moins de lectures",
          "Reporter : ouverture interdisciplinaire non indispensable",
          "Éviter : recommencer le cadrage une fois la collecte lancée",
          `Surveiller : ${topic.feasibility.risks[0] || "dispersion et retard de rédaction"}`,
        ],
      };
    }
    return {
      paragraphs: [
        paragraph(
          `Checklist adaptée au ${typeLabel}. Cochez avant envoi ou dépôt.`,
        ),
      ],
      bullets: [
        "Question et plan cohérents avec le sujet retenu",
        "Sources vérifiables, sans références inventées",
        "Méthode et terrain décrits de façon réaliste",
        "Normes de forme et anonymisation si besoin",
        "Relecture avec l’encadrement",
        "Fichier final nommé et déposé dans les délais",
      ],
    };
  }

  const p1 = paragraph(
    `${heading}. ${intent} Le fil conducteur reste le sujet « ${topic.title} ». La question de recherche retenue est la suivante : ${topic.research_question}`,
  );
  const p2 = paragraph(
    `Ce travail s’inscrit dans un ${typeLabel}. Il doit rester réaliste au regard du profil : délai déclaré (${deadline || "non précisé"}), temps hebdomadaire (${weekly || "non précisé"}), méthode envisagée (${topic.method}). ${
      imposedBy
        ? `Le cadre imposé par ${imposedBy} oriente les choix sans remplacer votre analyse.`
        : "La liberté de choix déclarée laisse de la marge pour préciser l’angle."
    }`,
  );
  const p3 = paragraph(
    `Concrètement, l’objet « ${theme} » sera traité à partir du terrain ou du corpus suivant : ${topic.field_or_corpus}. Les premiers pas utiles sont déjà identifiés : ${topic.feasibility.first_steps.join(" ; ")}. Cette section précise comment avancer sans empiler des ambitions inutiles.`,
  );
  const p4 = paragraph(
    `Pour garder un ton de travail clair, chaque étape doit produire un livrable court (note, grille, tableau, paragraphe). Cela évite les phrases trop longues et les plans décoratifs. Le niveau d’exigence doit correspondre au ${typeLabel}, pas à un autre genre académique.`,
  );
  const p5 = paragraph(
    `Enfin, les risques déjà repérés (${topic.feasibility.risks.join(" ; ") || "à surveiller au fil de l’eau"}) doivent être relus à chaque jalon. Si une information manque dans le profil, elle sera traitée comme point à vérifier auprès de l’encadrement, jamais comme un fait inventé.`,
  );

  return {
    paragraphs: [p1, p2, p3, p4, p5],
    bullets: [
      `Hypothèse à tester : ${topic.hypotheses[0] || "à préciser"}`,
      `Méthode : ${topic.method}`,
      `Faisabilité estimée : ${topic.feasibility.level}`,
    ],
  };
}

export function simulateDocument(input: {
  answers: Record<string, unknown>;
  topic: GeneratedTopic;
  kind: DocumentKind;
}): TopicDocument {
  const projectType = normalizeProjectType(input.answers.project_type);
  const outline = getDocumentOutline(projectType, input.kind);
  const sections = outline.sections.map((section) => {
    const body = expandSection(
      section.heading,
      section.intent,
      input.topic,
      projectType,
      input.kind,
      input.answers,
      section.id,
    );
    return {
      id: section.id,
      heading: section.heading,
      paragraphs: body.paragraphs,
      bullets: body.bullets,
      table: body.table,
    };
  });

  return {
    kind: input.kind,
    projectType,
    title:
      input.kind === "research_project"
        ? `${mainDocumentLabel(projectType)} : ${input.topic.title}`
        : `Plan de travail : ${input.topic.title}`,
    subtitle: `${PROJECT_TYPE_LABELS[projectType]} · simulation`,
    sections,
  };
}
