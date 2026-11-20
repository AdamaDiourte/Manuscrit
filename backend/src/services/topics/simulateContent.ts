import {
  getDocumentOutline,
  mainDocumentLabel,
  normalizeProjectType,
  PROJECT_TYPE_LABELS,
  type DocumentKind,
  type ProjectTypeId,
} from "../../../../shared/research/documentStructures";
import { writingStructureFor } from "../../../../shared/research/corpusOrganization";
import type {
  GeneratedTopic,
  TopicDocument,
  TopicsOutput,
} from "../../../../shared/research/topicTypes";
import {
  buildWorkPlanFromTopic,
  joinSentences,
  workPlanToScheduleTable,
  type WorkPlan,
} from "../../../../shared/research/workPlan";
import { topicQuestions } from "../../../../shared/research/topicQuestions";

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
      title: `[DÉMO] ${theme} : une lecture maîtrisée pour un ${typeLabel.toLowerCase()}`,
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
      research_object: theme,
      expected_contribution:
        "Préciser, sur un corpus documentaire borné, comment les acquis disciplinaires structurent une première lecture crédible de l'objet.",
      fieldwork_plan: [
        { unit: "document", quantity: 30 },
        { unit: "interview", quantity: 4 },
      ],
      hypothesis_tests: [
        {
          hypothesis_index: 0,
          comparison_or_variable: "présence vs absence d'outils déjà maîtrisés",
          data_source: "grille d'analyse des 30 documents",
        },
        {
          hypothesis_index: 1,
          comparison_or_variable: "accès déclaré vs accès partiel",
          data_source: "4 entretiens de cadrage",
        },
        {
          hypothesis_index: 2,
          comparison_or_variable: "réemploi des travaux antérieurs",
          data_source: "note de synthèse documentaire",
        },
      ],
      profile_links: [
        {
          field: "Discipline principale",
          profile_value: discipline,
          use: "Ancrage disciplinaire du sujet de démonstration.",
        },
        {
          field: "Type de projet",
          profile_value: typeLabel,
          use: "Adaptation du niveau d'exigence.",
        },
      ],
      readings: [],
    },
    {
      axis: "ambition",
      title: `[DÉMO] Renforcer une compétence nouvelle autour de ${theme}`,
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
        "Information des participants, consentement, pseudonymisation et conservation sécurisée des données dès le pilote.",
      research_object: theme,
      expected_contribution:
        "Tester l'apport d'une méthode encore peu maîtrisée sur un sous-corpus pilote, sans viser une simple confirmation d'un résultat connu.",
      fieldwork_plan: [
        { unit: "interview", quantity: 6 },
        { unit: "document", quantity: 20 },
      ],
      hypothesis_tests: [
        {
          hypothesis_index: 0,
          comparison_or_variable: "avant/après apprentissage de la méthode",
          data_source: "6 entretiens pilotes",
        },
        {
          hypothesis_index: 1,
          comparison_or_variable: "présence d'un livrable protocolaire",
          data_source: "grille produite sur 20 documents",
        },
        {
          hypothesis_index: 2,
          comparison_or_variable: "semaines dédiées vs calendrier saturé",
          data_source: "journal de bord du pilote",
        },
      ],
      profile_links: [
        {
          field: "Discipline principale",
          profile_value: discipline,
          use: "Base du sujet ambition (démonstration).",
        },
        {
          field: "Type de projet",
          profile_value: typeLabel,
          use: "Calibrage de l'ambition.",
        },
      ],
      readings: [],
    },
    {
      axis: "discovery",
      title: `[DÉMO] Un angle voisin pour relire ${theme}`,
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
      research_object: theme,
      expected_contribution:
        "Montrer ce qu'un angle voisin apporte concrètement à la lecture de l'objet, sur un cas unique borné.",
      fieldwork_plan: [{ unit: "document", quantity: 40 }],
      hypothesis_tests: [
        {
          hypothesis_index: 0,
          comparison_or_variable: "grille disciplinaire vs grille voisine",
          data_source: "40 documents du cas unique",
        },
        {
          hypothesis_index: 1,
          comparison_or_variable: "mots-clés du champ voisin",
          data_source: "sous-corpus annoté",
        },
        {
          hypothesis_index: 2,
          comparison_or_variable: "un seul objet empirique borné",
          data_source: "dossier documentaire unique",
        },
      ],
      profile_links: [
        {
          field: "Discipline principale",
          profile_value: discipline,
          use: "Ouverture contrôlée depuis la discipline déclarée.",
        },
        {
          field: "Type de projet",
          profile_value: typeLabel,
          use: "Bornage de l'angle de découverte.",
        },
      ],
      readings: [],
    },
  ];

  return topics;
}

function paragraph(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function questionOptionLabel(questionId: string, value: string): string {
  const q = topicQuestions.find((item) => item.id === questionId);
  return q?.options?.find((o) => o.value === value)?.label || value;
}

function expandSection(
  heading: string,
  intent: string,
  topic: GeneratedTopic,
  projectType: ProjectTypeId,
  kind: DocumentKind,
  answers: Record<string, unknown>,
  sectionId?: string,
  workPlan?: WorkPlan | null,
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
  const deadlineLabel = deadline
    ? questionOptionLabel("deadline_range", deadline)
    : "à confirmer";
  const weeklyLabel = weekly
    ? questionOptionLabel("weekly_time", weekly)
    : "à confirmer";

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
      const table = workPlan
        ? workPlanToScheduleTable(workPlan)
        : {
            headers: ["Période", "Objectif", "Actions", "Livrable", "Charge"],
            rows: [
              [
                "Période 1",
                "Cadrer",
                "Préciser la question ; recenser 10–15 sources",
                "Note de cadrage (1 p.)",
                "à confirmer",
              ],
              [
                "Période 2",
                "Collecter",
                `Préparer ${topic.field_or_corpus}`,
                "Grille ou corpus annoté",
                "à confirmer",
              ],
              [
                "Période 3",
                "Analyser",
                "Coder / classer ; tester une hypothèse",
                "Tableau de résultats",
                "à confirmer",
              ],
            ],
          };
      return {
        paragraphs: [
          paragraph(
            joinSentences(
              `Planning proposé à partir du délai (${deadlineLabel}) et du rythme hebdomadaire (${weeklyLabel})`,
              "Ajustez les dates exactes avec votre encadrement",
              "Ce calendrier est indicatif",
            ),
          ),
        ],
        table,
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

  const openingIds = new Set([
    "context",
    "intro",
    "presentation",
    "opening",
  ]);
  const isOpening =
    !sectionId ||
    openingIds.has(sectionId) ||
    /contexte|introduction|pr[eé]sentation|int[eé]r[eê]t/i.test(heading);

  if (isOpening) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            heading,
            intent,
            `Le fil conducteur reste le sujet « ${topic.title} »`,
            `La question de recherche retenue est la suivante : ${topic.research_question}`,
          ),
        ),
        paragraph(
          joinSentences(
            `Ce travail s’inscrit dans un ${typeLabel}`,
            `Il doit rester réaliste au regard du profil : délai déclaré (${deadlineLabel}), temps hebdomadaire (${weeklyLabel}), méthode envisagée (${topic.method})`,
            imposedBy
              ? `Le cadre imposé par ${imposedBy} oriente les choix sans remplacer votre analyse`
              : "La liberté de choix déclarée laisse de la marge pour préciser l’angle",
          ),
        ),
        paragraph(
          joinSentences(
            `Concrètement, l’objet « ${theme} » sera traité à partir du terrain ou du corpus suivant : ${topic.field_or_corpus}`,
            `Les premiers pas utiles sont déjà identifiés : ${topic.feasibility.first_steps.join(" ; ")}`,
            "Cette section précise comment avancer sans empiler des ambitions inutiles",
          ),
        ),
        paragraph(
          joinSentences(
            "Pour garder un ton de travail clair, chaque étape doit produire un livrable court (note, grille, tableau, paragraphe)",
            "Cela évite les phrases trop longues et les plans décoratifs",
            `Le niveau d’exigence doit correspondre au ${typeLabel}, pas à un autre genre académique`,
          ),
        ),
        paragraph(
          joinSentences(
            `Enfin, les risques déjà repérés (${topic.feasibility.risks.join(" ; ") || "à surveiller au fil de l’eau"}) doivent être relus à chaque jalon`,
            "Si une information manque dans le profil, elle sera traitée comme point à vérifier auprès de l’encadrement, jamais comme un fait inventé",
          ),
        ),
      ],
      bullets: [
        `Hypothèse à tester : ${topic.hypotheses[0] || "à préciser"}`,
        `Méthode : ${topic.method}`,
        `Faisabilité estimée : ${topic.feasibility.level}`,
      ],
    };
  }

  if (sectionId === "problem" || /probl[eé]mat|hypoth/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            `Reformuler la question « ${topic.research_question} » de façon opérationalisable pour un ${typeLabel}`,
          ),
        ),
        paragraph(
          joinSentences(
            `Les hypothèses à tester sont les suivantes : ${topic.hypotheses.join(" ; ")}`,
            "Chaque hypothèse doit pouvoir être confrontée aux matériaux disponibles, sans surcharger le dispositif",
          ),
        ),
      ],
      bullets: topic.hypotheses.slice(0, 3).map((h) => `Piste : ${h}`),
    };
  }

  if (sectionId === "theory" || /th[eé]or|litt[eé]rature|[eé]tat/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            "Retenir seulement les notions qui éclairent l’analyse prévue, sans inventaire bibliographique décoratif",
          ),
        ),
        paragraph(
          joinSentences(
            `Relier ces repères à la méthode retenue (${topic.method})`,
            "Signaler clairement ce qui reste à lire auprès de l’encadrement",
          ),
        ),
      ],
      bullets: [
        "Notions clés à définir",
        "Lectures prioritaires à valider",
        "Angles à écarter faute de temps",
      ],
    };
  }

  if (sectionId === "method" || /m[eé]thode|dispositif|design/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            `Décrire concrètement « ${topic.method} » et ses critères de sélection`,
          ),
        ),
        paragraph(
          joinSentences(
            `Situer le dispositif par rapport à « ${topic.field_or_corpus} »`,
            "Assumer les limites d’accès et le calendrier déclaré",
          ),
        ),
      ],
      bullets: [
        "Étapes du protocole",
        "Critères d’inclusion",
        "Points éthiques à clarifier",
      ],
    };
  }

  if (sectionId === "plan" || /plan provisoire|architecture|chapitres/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            `Proposer une architecture de chapitres tenable pour un ${typeLabel} sur le sujet « ${topic.title} »`,
          ),
        ),
        paragraph(
          "Chaque partie doit produire un livrable court et s’appuyer sur des preuves déposées, du simple au complexe.",
        ),
      ],
      bullets: [
        "Ouverture et cadrage",
        "Développement analytique",
        "Discussion et conclusion",
      ],
    };
  }

  if (sectionId === "schedule" || /calendrier|planning|jalon/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            `Découper le travail selon le délai (${deadlineLabel}) et le rythme (${weeklyLabel})`,
          ),
        ),
        paragraph(
          "Prévoir une marge de relecture avant le rendu et des points d’encadrement aux bascules de phase.",
        ),
      ],
      bullets: topic.feasibility.first_steps.slice(0, 3),
    };
  }

  if (sectionId === "ethics" || /attention|limite|pr[eé]caution|[eé]thique/i.test(heading)) {
    return {
      paragraphs: [
        paragraph(
          joinSentences(
            intent,
            `Surveiller notamment : ${topic.feasibility.risks.join(" ; ") || "accès aux données et retard de rédaction"}`,
          ),
        ),
        paragraph(
          "Toute information manquante sera traitée comme point à vérifier auprès de l’encadrement, jamais comme un fait inventé.",
        ),
      ],
      bullets: [
        "Consentement et anonymisation si besoin",
        "Sources vérifiables uniquement",
        "Périmètre borné au temps disponible",
      ],
    };
  }

  return {
    paragraphs: [
      paragraph(joinSentences(heading, intent)),
      paragraph(
        joinSentences(
          `Relier cette partie au sujet « ${topic.title} » sans répéter le cadrage général`,
          "Produire un livrable court ancré dans les matériaux ou lectures déjà identifiés",
        ),
      ),
    ],
    bullets: [
      `Terrain / corpus : ${topic.field_or_corpus}`,
      `Premier pas : ${topic.feasibility.first_steps[0] || "à préciser avec l’encadrement"}`,
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
  const structure = writingStructureFor(projectType);
  const workPlan =
    input.kind === "work_plan"
      ? buildWorkPlanFromTopic({
          answers: input.answers,
          topic: input.topic,
          sections: structure,
        })
      : null;
  const sections = outline.sections.map((section) => {
    const body = expandSection(
      section.heading,
      section.intent,
      input.topic,
      projectType,
      input.kind,
      input.answers,
      section.id,
      workPlan,
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
    ...(workPlan ? { workPlan } : {}),
  };
}
