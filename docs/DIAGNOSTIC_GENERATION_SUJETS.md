# DIAGNOSTIC — Génération des sujets (« Construire mon projet »)

**Date :** 2026-11-20  
**Périmètre :** lecture seule (aucun correctif). Seul livrable : ce fichier.  
**Symptôme cible :** badge `Simulation · simulation`, texte orphelin `choix.`, 3 sujets génériques, hypothèses sur la démarche, faisabilité type « Recenser 15 à 20 sources », mots-clés = champs formulaire, contexte tronqué par `…`, compteur `3 / 3`.

**Verdict en une phrase :** le front envoie `simulate: true` par défaut ; le back appelle alors `simulateTopics()` (gabarits string) et **ne contacte aucun LLM** ; l’affichage concatène le badge « Simulation » avec `model: "simulation"` et coupe le contexte en CSS (`line-clamp`).

---

## 1. Architecture

### Stack exacte (package.json)

| Couche | Paquet | Versions |
|--------|--------|----------|
| Monorepo | `manuscrit-datasensia` (workspaces `frontend`, `backend`) | `1.0.0` — Node `>=24` (`package.json:L1-L16`) |
| Front | React + Vite | `react` / `react-dom` **19.2.6**, `vite` **8.0.13**, `@vitejs/plugin-react` **6.0.2**, `typescript` **5.9.3**, `zod` **^4.6.7**, `lucide-react` **1.31.0** (`frontend/package.json:L1-L21`) |
| Back | Express + Zod + LLM SDKs | `express` **^5.1.0**, `zod` **^4.6.7**, `pg` **8.16.3**, `@anthropic-ai/sdk` **1.11.0**, `@anthropic-ai/bedrock-sdk` **1.1.2**, `@anthropic-ai/vertex-sdk` **1.1.3**, `docx` **^9.15.4**, `tsx` **^4.20.0**, `esbuild` **^0.27.0**, `typescript` **5.9.3** (`backend/package.json:L1-L25`) |
| ORM / BDD | Pas d’ORM. Stockage : fichiers locaux `.data` si `DATABASE_URL` vide ; sinon `pg` (`backend/src/storage/index.ts:L1-L12`, terminal : « stockage fichier local (.data) ») |

### Arborescence liée à la fonctionnalité

```
frontend/src/
  pages/Workspace.tsx                          # entrée « Construire mon projet »
  components/copilot/ResearchStudio.tsx        # orchestration étape 1 + archive
  components/topics/
    TopicGenerator.tsx                         # phases notice → quiz → review → results
    TopicNotice.tsx, TopicQuestionnaire.tsx, TopicReview.tsx, TopicResults.tsx
    QuestionField.tsx, TopicSelect.tsx, TopicMultiSelect.tsx, …
    storage.ts                                 # localStorage brouillon
    topicArchive.ts                            # archive sujets / docs
  styles/topics.css                            # line-clamp, badge

backend/src/
  server.ts                                    # routes /api/topics/*
  routes/topics.ts                             # generate / regenerate / document / draft
  services/topics/
    generate.ts, simulateContent.ts, promptBuilder.ts, validateOutput.ts
    generateDocument.ts, documentPromptBuilder.ts, validateDocument.ts
    generationTicket.ts, validateAnswers.ts, rateLimit.ts, buildDocx.ts
  services/llm/client.ts, services/llm/claude.ts
  prompts/researchTopicsSystem.ts, researchDocumentSystem.ts
  prompts/research_topics.system.md            # miroir markdown (non importé en runtime)

shared/research/
  topicQuestions.ts, topicTypes.ts, documentStructures.ts, workPlan.ts, …
shared/privacy/buildPseudonymizedProfile.ts
```

### Schéma textuel du flux

```
Workspace / ResearchStudio (« Construire mon projet », intent start)
  → TopicGenerator
       phase notice (TopicNotice + consents)
       → quiz (TopicQuestionnaire, blocs 1–3, answers en state + localStorage)
       → review (TopicReview, case « Mode simulation » cochée par défaut)
       → POST /api/topics/generate  { answers, consents, simulate }
            → validateConsents + validateAnswersPayload
            → generateTopics(answers, env, undefined, { simulate })
                 SI simulate || !isLlmConfigured → simulateTopics(answers)  [PAS de LLM]
                 SINON → buildPseudonymizedProfile → chatCompletion → parseTopicsOutput
            → issueTicket(uid, topics, rem=3)
            → JSON { topics, model, ticket, regenerationsRemaining: 3, simulated, … }
       → TopicResults (cartes + badge + compteur)
            clic « Choisir ce sujet »
              → POST /api/topics/document ×2 (research_project + work_plan)
                   → generateTopicDocument (simulateDocument si simulate)
                   → DOCX base64
              → onChooseTopic → ResearchStudio.chooseTopic
                   → upload workspace + persistDraft (topicArchive, chosenTopic, préremplissage)
```

---

## 2. Le formulaire de profil

Source unique des champs : `shared/research/topicQuestions.ts` (`topicQuestions`, `TOPIC_BLOCKS`).  
Stockage pendant la saisie : state React `answers` (`TopicGenerator.tsx:L52-L56`) + `localStorage` clé `manuscrit.topicGenerator.draft.v1` (`storage.ts:L4-L33`). Après génération réussie : `clearDraft()` (`TopicGenerator.tsx:L154`). Pas de persistance serveur du profil (étape A : `POST_draft` → 501 si consentement retention, sinon 403 — `topics.ts:L32-L72`).

### Tableau des champs

| Nom technique | Libellé affiché | Type | Options possibles | Obligatoire ? | Validation | Où stocké |
|---|---|---|---|---|---|---|
| `project_type` | Quel type de projet préparez-vous ? | single | licence, m1, m2, pro, thesis, article, book | oui (bloc 1) | `required` + assert bloc 1 | answers / draft local |
| `project_type_other` | Précisez le type de projet | text_short | libre ≤120 | oui si `project_type=other` | showIf + maxLength | idem |
| `discipline_main` | Discipline principale | single | anthropologie… sociologie… autre (slug) | oui | required | idem |
| `discipline_main_other` | Précisez la discipline | text_short | ≤120 | oui si `autre` | showIf | idem |
| `specialty` | Spécialité ou sous-domaine (facultatif) | text_short | ≤300 ; skip | non | allowSkip | idem |
| `topic_freedom` | Quelle est votre liberté de choix du sujet ? | single | free, imposed | oui | required | idem |
| `imposed_by` | Par qui le sujet est-il imposé ? | text_short | ≤200 | oui si imposed | showIf | idem |
| `imposed_theme` | Thème imposé ou retenu | text_short | ≤300 | non (même si imposed) | showIf imposed | idem |
| `lab_themes` | Thématiques du laboratoire… | text_short | ≤300 ; skip | non | allowSkip | idem |
| `deadline_range` | Délai de rendu prévu | single | lt3m, 3to6m, 6to12m, gt1y, gt3y | oui | required | idem |
| `expected_length` | Longueur attendue du manuscrit | single | short, medium, long, book_volume, unknown | oui | required | idem |
| `weekly_time` | Temps à consacrer au sujet par semaine | single | lt5, 5to10, 10to20, fulltime | oui | required | idem |
| `writing_language` | Langue de rédaction | single | en, fr, other (défaut front `fr`) | oui | required | idem |
| `writing_language_other` | Précisez la langue… | text_short | ≤80 | oui si other | showIf | idem |
| `disciplines_studied` | Disciplines déjà étudiées et niveau | multi_scale | disciplines × 0–3 | non | allowSkip | idem |
| `favorite_courses` | Cours ou enseignement marquant | text_short | ≤900 ; `;` | non | allowSkip | idem |
| `liked_aspects` | …quels aspects vous plaisent ? | multi | applied, numbers, debate, writing, history, field, theory | non | allowSkip | idem |
| `disliked_courses` | Cours ou thèmes à éviter | text_short | ≤300 | non | allowSkip | idem |
| `inspiring_concept` | Auteur, concept ou théorie marquante | text_short | ≤600 | non | allowSkip | idem |
| `curious_discipline` | Discipline voisine… | multi | disciplines | non | allowSkip | idem |
| `past_works` | Travaux antérieurs… | repeatable_group | type/title/year/method | non | allowSkip | idem |
| `continue_or_avoid` | Prolonger / éviter un sujet | single | continue, avoid, neither | non | allowSkip | idem |
| `continue_or_avoid_detail` | Précisez le sujet… | text_short | ≤300 | non si continue/avoid | showIf | idem |
| `methods_skills` | Compétences méthodologiques | multi_scale | méthodes × 0–3 | non | allowSkip | idem |
| `software` | Logiciels déjà utilisés | multi | excel, nvivo, python, qgis, r, spss, stata, zotero, other | non | allowSkip | idem |
| `method_to_learn` | Méthodologie souhaitée | multi | méthodes | non | allowSkip | idem |
| `method_to_learn_other` | Précisez la méthodologie… | text_short | ≤120 | non si other | showIf | idem |

Consents (hors questionnaire, `TopicNotice` / `buildConsents`) : `ageOver15`, `noticeAccepted`, `retainProfile`, `serviceImprovement` — objets `{ value, at, noticeVersion }` (`storage.ts:L40-L46`, `NOTICE_VERSION = "2026-11-v1"`).

Validation serveur : clés connues uniquement, maxLength strings, bloc 1 requis (`validateAnswers.ts:L26-L64`) ; consents Zod + âge ≥15 + notice (`validateAnswers.ts:L67-L81`).

### Payload exact envoyé au back (construit d’après le code)

Front (`TopicGenerator.tsx:L133-L140`) :

```json
{
  "answers": {
    "project_type": "m2",
    "discipline_main": "sociologie",
    "topic_freedom": "free",
    "deadline_range": "3to6m",
    "expected_length": "medium",
    "weekly_time": "5to10",
    "writing_language": "fr"
  },
  "consents": {
    "ageOver15": { "value": true, "at": "<ISO>", "noticeVersion": "2026-11-v1" },
    "noticeAccepted": { "value": true, "at": "<ISO>", "noticeVersion": "2026-11-v1" },
    "retainProfile": { "value": false, "at": "<ISO>", "noticeVersion": "2026-11-v1" },
    "serviceImprovement": { "value": false, "at": "<ISO>", "noticeVersion": "2026-11-v1" }
  },
  "simulate": true
}
```

`simulate` vient de `useState(true)` (`TopicGenerator.tsx:L69`) et de la case cochée par défaut (`TopicReview.tsx:L162-L176`).

---

## 3. Le moteur de génération (point central)

### Un LLM est-il réellement appelé ?

**Dans le scénario symptomatique : NON.**

Condition (`generate.ts:L28-L38`) :

```28:38:backend/src/services/topics/generate.ts
  if (options?.simulate || !isLlmConfigured(env)) {
    let topics = simulateTopics(answers);
    if (regenerate?.previousTopics?.length === 3) {
      const replacement = topics.find((t) => t.axis === regenerate.axis);
      if (replacement) {
        topics = regenerate.previousTopics.map((t) =>
          t.axis === regenerate.axis ? replacement : t,
        );
      }
    }
    return { topics, model: "simulation", simulated: true };
  }
```

Route (`topics.ts:L106-L110`) : `simulate = Boolean(body.simulate)` puis `generateTopics(..., { simulate })`.

### Quand le LLM *serait* appelé (chemin non pris si case cochée)

| Paramètre | Valeur |
|-----------|--------|
| Fournisseur | `AI_PROVIDER` → `anthropic` (défaut dans `.env.example`) ; sinon openai-compatible (`client.ts:L67-L77`) |
| SDK | `@anthropic-ai/sdk` via `callClaudeChat` (`claude.ts:L422-L445`) ; tier `"smart"` (`client.ts:L49-L51`) |
| Modèle | `AI_MODEL_SMART` ou défaut `claude-sonnet-5-5` (`claude.ts:L95-L96`, `L161`) |
| Température | `0.4` génération ; `0.55` régénération (`generate.ts:L61-L63`) |
| max_tokens | `4500` (`generate.ts:L63`) |
| Timeout client OpenAI-compat | `90000` ms (`client.ts:L90`) ; Claude SDK client `TIMEOUT_MS = 120_000` (`claude.ts:L93`) |

### Variables d’environnement (noms uniquement) — présence dans `.env` / `.env.example`

| Variable | Rôle | Définie dans `.env` ? | Présente dans `.env.example` ? |
|----------|------|----------------------|--------------------------------|
| `AI_PROVIDER` | Choix fournisseur | oui | oui |
| `ANTHROPIC_API_KEY` | Clé Anthropic | oui | oui (vide dans example) |
| `AI_MODEL_SMART` | Modèle smart | oui | oui |
| `AI_MODEL_FAST` | Modèle fast | oui | oui |
| `AI_BASE_URL` | OpenAI-compat | oui (vide) | oui |
| `AI_MODEL` | OpenAI-compat / défaut | oui | oui |
| `AI_API_KEY` | OpenAI-compat | oui | oui |
| `TOPICS_TICKET_SECRET` | Signature tickets regen | oui | oui |
| `COOKIE_SECRET` | Fallback secret ticket | oui | oui |
| `PROFILE_ENCRYPTION_KEY` | Chiffrement profil (futur) | non (vide) | oui |
| `DATABASE_URL` | Postgres | non (vide) → filesystem | oui |
| `APP_BASE_URL` | Origin CORS | oui | oui |
| `AWS_*` / `CLOUD_ML_REGION` / `ANTHROPIC_VERTEX_PROJECT_ID` | Bedrock/Vertex | non (vides) | oui |

`isLlmConfigured` pour `anthropic` = présence de `ANTHROPIC_API_KEY` (`claude.ts:L449-L456`). **Donc le LLM est configuré**, mais le front force quand même la simulation via `simulate: true`.

### Déclencheurs mode simulation / mock

1. **Front : case cochée par défaut** — `const [simulate, setSimulate] = useState(true)` (`TopicGenerator.tsx:L69`) + label « Mode simulation (sans IA) » (`TopicReview.tsx:L162-L176`).
2. **Back : `body.simulate` truthy** → `options.simulate` (`topics.ts:L106-L110`).
3. **Back : LLM non configuré** → même branche simulation (`generate.ts:L28`).
4. Documents : `simulate: Boolean(simulated)` renvoyé au `/document` (`TopicResults.tsx:L103`) ; ou `!isLlmConfigured` (`generateDocument.ts:L117`).

### Gabarits INTÉGRAUX (`simulateTopics`)

Code mot pour mot (`simulateContent.ts:L42-L174`) :

```42:174:backend/src/services/topics/simulateContent.ts
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
```

**Injection des champs :**

- `discipline` ← `discipline_main` avec `_` → espaces, sinon `"votre discipline"` (`simulateContent.ts:L28-L32`).
- `typeLabel` ← `PROJECT_TYPE_LABELS[normalizeProjectType(project_type)]` (`L23-L26`) ; dans les titres : `typeLabel.toLowerCase()` → « mémoire recherche m2 ».
- `theme` ← `imposed_theme` si non vide, **sinon** littéral `` `pratiques et enjeux en ${discipline}` `` (`L51-L54`) — d’où le texte exact du symptôme quand `topic_freedom=free` (pas de thème imposé).
- `imposedBy` ← `imposed_by` pour le fragment « dans le cadre imposé (…) » vs « à partir de votre profil ».

### Erreur API LLM

- Pas de fallback silencieux vers simulation si `simulate=false` et LLM configuré : un `try/catch` **réessaie une fois** puis relance (`generate.ts:L72-L101`) ; l’échec remonte à la route → JSON `{ error: … }` status 502/429 (`topics.ts:L136-L155`).
- Si LLM **non** configuré : simulation systématique (pas d’erreur utilisateur).

---

## 4. Les prompts

### a) Génération des 3 sujets — system (runtime)

Source utilisée : `RESEARCH_TOPICS_SYSTEM` (`researchTopicsSystem.ts:L2-L36`), via `systemPrompt()` (`promptBuilder.ts:L5-L7`).

```
Tu es un directeur de recherche expérimenté et pluridisciplinaire. Tu analyses
SCRUPULEUSEMENT le profil pseudonymisé avant de proposer quoi que ce soit.

À partir de ce profil, tu proposes exactement TROIS sujets de recherche TRÈS
pertinents, chacun ancré dans les réponses fournies :

1. MAÎTRISE : s'appuie sur les disciplines, méthodes déjà solides, travaux antérieurs
   et accès déclarés. Le sujet doit sembler immédiatement tenable.
2. AMBITION : sert le projet (type, échéance, compétences à acquérir) ; intègre au
   moins une méthode que la personne souhaite apprendre si cela est indiqué.
3. DÉCOUVERTE : ouvre vers une discipline voisine ou un angle neuf, dosé selon les
   contraintes de faisabilité (temps, délai, mobilité implicite).

Règles d'analyse (obligatoires) :
- Lis tout le profil. Ne te contente pas d'un seul champ.
- Respecte strictement le type de projet, l'échéance, le temps disponible et les
  thèmes exclus. Un sujet irréalisable dans ces contraintes est interdit.
- Si le sujet est imposé (topic_freedom = imposed) ou qu'un thème / une instance
  imposante est indiqué, les trois sujets doivent s'y inscrire sous trois angles
  différents, sans sortir du cadre.
- Chaque sujet doit être explicitement relié aux réponses (champ "rationale" :
  citer concrètement 2 à 4 éléments du profil).
- Adapte le niveau d'exigence au type de projet (licence ≠ M2 ≠ thèse ≠ stage).
- N'invente JAMAIS de références bibliographiques, d'auteurs, de terrains nominatifs
  ou de statistiques. Fournis uniquement des mots-clés de recherche documentaire.
- N'infère et ne mentionne aucune caractéristique sensible de la personne (origine,
  religion, santé, opinions, orientation sexuelle, etc.).
- Si le sujet implique des mineurs, publics vulnérables ou données sensibles, signale
  les démarches nécessaires dans "ethical_notes".
- Titres précis, questions de recherche claires, hypothèses testables, méthode
  réaliste. Évite le vague et les formulations génériques interchangeables.
- Pour chaque sujet, le champ "context" situe brièvement l’objet (actualité,
  histoire, débat public, enjeu disciplinaire) en 2 à 3 phrases, avant la
  question de recherche. Pas de digression, pas de fausses références.
- Réponds uniquement en JSON valide, en français, selon le schéma fourni.
```

Note : `research_topics.system.md` est une **version différente / plus ancienne** ; **non utilisée** en runtime (commentaire `researchTopicsSystem.ts:L1`).

### a) User prompt — construction (`promptBuilder.ts:L9-L56`)

```
Profil pseudonymisé regroupé par axes (M=maîtrise, A=ambition, D=découverte, F=faisabilité) :

{JSON.stringify({ axes, fields })}

Schéma de sortie JSON strict :

{JSON.stringify(schemaHint)}
```

`axes` / `fields` = `buildPseudonymizedProfile(answers)` : **tous** les champs `sentToLLM: true` (la quasi-totalité du questionnaire), scrubbés, regroupés par poids M/A/D/F (`buildPseudonymizedProfile.ts:L55-L118`).

**En mode simulation, ces prompts ne sont jamais envoyés.**

### b) Régénération

Même system. User = même base + (`promptBuilder.ts:L45-L53`) :

```
Régénère en priorité le sujet d’axe "<axis>". Conserve la cohérence des trois axes mastery, ambition et discovery dans le JSON.

Motif de régénération : <REGEN_REASON_LABELS[reason]>.

Titre précédent à remplacer : <previousTitle>   // si présent
```

Motifs (`topicTypes.ts:L103-L108`) : « Trop éloigné de mon profil » | « Trop ambitieux » | « Trop banal » | « Sujet déjà traité ».

Les sujets précédents complets **ne sont pas** injectés dans le prompt ; seuls l’axe, le motif et le titre précédent le sont. Le merge des 3 cartes se fait côté code (`generate.ts:L74-L83`).

### c) Projet de recherche après choix — system

`RESEARCH_DOCUMENT_SYSTEM` (`researchDocumentSystem.ts:L2-L48`) — mot pour mot :

```
Tu es un encadrant universitaire expérimenté. Tu rédiges un document académique
en français pour un étudiant ou un chercheur, à partir d’un profil pseudonymisé et
d’un sujet retenu.

Mission :
- Suivre SCRUPULEUSEMENT la structure fournie (ordre des sections, finalité de chacune).
- Adapter le fond au TYPE DE PROJET (mémoire licence, M1, M2, mémoire pro, rapport
  de stage, thèse, article, communication). Un rapport de stage n’est PAS un projet
  de thèse. Une fiche ou un article n’a PAS la structure d’un mémoire de licence.
- Rester fidèle aux informations du profil et du sujet. N’invente pas de faits,
  d’organisations, de terrains, de statistiques ni de références bibliographiques.
  Si une information manque, formule une hypothèse de travail explicitement comme telle
  ou indique ce qu’il faudra vérifier.
- Relie chaque section aux contraintes déclarées (délai, temps hebdomadaire, méthodes,
  liberté de sujet, thème imposé, etc.).

Deux genres de documents :
1) DOCUMENT PRINCIPAL (mémoire / rapport de stage / article / communication / thèse…)
   - Texte long utile (environ 5 à 8 pages Word).
   - Contenu substantiel dans chaque section.
2) PLAN DE TRAVAIL
   - SYNTHÉTIQUE : 1 à 2 pages maximum. Clair, directif, opérationnel.
   - Aide la personne à s’organiser jusqu’au rendu.
   - Le délai de rendu et le temps à consacrer au sujet par semaine (formulaire)
     sont les balises obligatoires du planning : périodes calées sur le délai,
     charge hebdomadaire réaliste, jalons progressifs.
   - Inclut une carte mentale (bullets courts) et un TABLEAU de planning
     (champ "table" avec headers + rows : Période | Objectif | Actions | Livrable | Charge).
   - Ne duplique PAS le document principal.

Style d’écriture (obligatoire) :
- Naturel, clair, comme un humain qui explique clairement.
- Phrases plutôt courtes ou de longueur moyenne ; une idée par phrase autant que possible.
- Pas de jargon creux, pas de tournures compliquées, pas de ton froid ou impersonnel
  excessif (« il convient de », « dans le cadre de la présente démarche », etc.).
- Évite les tirets cadratin ou demi-cadratin comme ponctuation dans le fil du texte.
  Pour les listes, utilise uniquement le champ "bullets" du JSON (jamais de listes
  improvisées avec des tirets dans les paragraphes).
- Préfère virgules, points, points-virgules, deux-points, parenthèses sobres.
- Pas de formules typiques d’IA (« En conclusion, il est essentiel de… »,
  « Dans un monde en mutation… », empilement de superlatifs).
- Tutoiement interdit. Vouvoiement de lecture possible via « vous » si utile,
  sinon rédaction neutre et directe.

Sortie :
- JSON uniquement, selon le schéma demandé.
- Toutes les sections de l’outline doivent être présentes.
```

User document (`documentPromptBuilder.ts:L131-L145`) : type de document, type de projet, `outline.guidance`, sections outline, `JSON.stringify(topic)`, profil `{ axes, fields }`, extras planning ou « ~5 pages », schéma JSON.

En simulation document : `simulateDocument` (`simulateContent.ts:L517-L564`) — **pas de prompt LLM** ; subtitle `` `${PROJECT_TYPE_LABELS[projectType]} · simulation` ``.

---

## 5. Format de sortie et validation

### Structure `GeneratedTopic` (`topicTypes.ts:L75-L93`)

```ts
{
  axis: "mastery" | "ambition" | "discovery";
  title: string;
  context: string;
  research_question: string;
  hypotheses: string[];
  field_or_corpus: string;
  method: string;
  feasibility: {
    level: "high" | "medium" | "low";
    risks: string[];
    first_steps: string[];
  };
  rationale: string;
  keywords_fr: string[];
  keywords_en: string[];
  ethical_notes: string | null;
}
```

Zod sortie LLM (`validateOutput.ts:L4-L43`) : 3 topics, axes uniques mastery/ambition/discovery ; `context` max **320** ; titres max 220 ; etc.

### Parsing / retries

- `JSON.parse` ou extraction `{…}` puis `topicsOutputSchema.parse` (`validateOutput.ts:L45-L55`).
- 1 retry sur échec (`generate.ts:L86-L100`).
- Simulation : **aucune** validation Zod sur les gabarits (retour direct).

### Origine de la troncature « … »

**Front CSS**, pas tokens ni slice back :

```1173:1200:frontend/src/styles/topics.css
.topic-kv-context p {
  -webkit-line-clamp: 4;
  ...
}
.topic-kv p {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

Le contexte utilise les deux règles → clamp multi-lignes avec ellipsis navigateur (`…`). Le texte API complet n’est pas tronqué (cf. §10).

### Origine de « choix. » et badge « Simulation »

Intro (`TopicResults.tsx:L237-L250`) :

```237:250:frontend/src/components/topics/TopicResults.tsx
      <div className="topic-section-head">
        <h2>Trois sujets proposés</h2>
        <p>
          Comparez les grands axes, choisissez un sujet, ou régénérez-en un après
          avoir indiqué un motif. Le projet et le plan de travail sont générés
          uniquement après le choix.{" "}
          <span className="topic-ai-badge">
            {simulated ? "Simulation" : "Contenu généré par IA"}
          </span>
          {model ? <span className="topic-meta"> · {model}</span> : null}
          <br />
          <span className="topic-meta">
            Régénérations restantes : {regenerationsRemaining} / 3
          </span>
        </p>
      </div>
```

- **`choix.`** = dernier mot de la phrase « …uniquement après le choix. » ; le badge `display: inline-block` (`topics.css:L1259-L1267`) force un retour à la ligne → « choix. » paraît orphelin au-dessus des cartes.
- **`Simulation · simulation`** = badge `"Simulation"` + `" · "` + `model` qui vaut `"simulation"` (`generate.ts:L38`).

---

## 6. Régénérations (3/3)

| Aspect | Détail |
|--------|--------|
| Compteur initial | `regenerationsRemaining: 3` + ticket `rem: 3` (`topics.ts:L111, L129` ; `generationTicket.ts:L13`) |
| Stockage | HMAC ticket (payload base64 : uid, iat, rem, topics) — **pas de BDD** (`generationTicket.ts:L29-L43`) |
| TTL | 2 h (`generationTicket.ts:L12`) |
| Consommation | `consumeRegen` → `rem - 1` (`generationTicket.ts:L72-L87`) |
| Réinit | Nouvelle génération (`POST_generate`) réémet ticket à 3 ; « Nouveau questionnaire » remet UI à 0 jusqu’à régénérer (`TopicGenerator.tsx:L236-L250`) |
| Anti-doublons | Ticket embarque les 3 topics pour **merger** l’axe régénéré. Prompt LLM : titre précédent seulement. **En simulation**, `simulateTopics` régénère les **mêmes** gabarits → remplacement quasi identique. |

---

## 7. Étape suivante : projet de recherche

### Au clic sur un sujet (`TopicResults.tsx:L119-L151`)

1. `POST /api/topics/document` kind `research_project` et `work_plan` en parallèle, avec `simulate: Boolean(simulated)`.
2. Affichage « Sujet retenu » + boutons téléchargement Word + aperçu `WorkPlanView`.
3. Callback `onChooseTopic` → `ResearchStudio.chooseTopic` : upload fichiers, `chosenTopic`, `draftFieldsFromTopic`, `persistDraft` (`ResearchStudio.tsx:L642-L713`).

### Structure projet (outline M2 exemple)

Sections `research_project` pour `m2` (`documentStructures.ts:L179-L218`) : Enjeu de recherche ; Problématique et hypothèses ; Cadre théorique… ; Design de recherche ; Résultats attendus… ; Plan du manuscrit ; Planning et livrables ; Éthique et données.

Work plan : identity / map / schedule / priorities / checklist (via `getDocumentOutline`).

### Simulation document

`simulateDocument` remplit chaque section via `expandSection` (templates string + topic + deadline/weekly) ; `subtitle: "… · simulation"` (`simulateContent.ts:L553-L563`).

### Stockage / affichage

- DOCX base64 en réponse API ; archive workspace (`topicArchive.documents`).
- Cadrage prérempli localement (`projectContext.ts` `draftFieldsFromTopic`).
- Pas de table SQL sujets/projets en étape A (`persistence: "none"`).

---

## 8. Anti-hallucination et sources

| Question | Constat |
|----------|---------|
| Références / auteurs / chiffres générés ? | Interdits dans les prompts sujets et documents. Simulation : **aucun** auteur inventé ; phrases génériques. |
| Vérification ? | NON TROUVÉ (pas de vérif biblio sur le parcours sujets). |
| Recherche externe (OpenAlex, HAL, …) / RAG matériaux ? | **NON** dans `backend/src/services/topics/**`. (OpenAlex existe ailleurs dans `research/engine.ts` — hors parcours sujets.) |
| Garde-fous prompts | Oui : « N'invente JAMAIS… », ethical_notes, pas de caractéristiques sensibles (§4). |

---

## 9. Données et RGPD

### Modèles

- **Pas de tables** profil/sujets en étape A (commentaire `topics.ts:L32-L36`).
- Stockage app : ObjectStore fichiers `.data` (`storage/index.ts` ; `DATABASE_URL` vide).
- Client : `localStorage` brouillon questionnaire ; draft workspace `topicArchive[]` (`TopicArchiveEntry` : topics, chosenTopic, answers, documents, simulated…).

### Envoyé au LLM (chemin réel seulement)

Whitelist = tous les `sentToLLM: true` du questionnaire, après scrub (`buildPseudonymizedProfile.ts`). Pas d’email/nom/uid (clés interdites `FORBIDDEN_KEYS`).

En **simulation** : rien n’est envoyé à un fournisseur IA.

### Logs

Métadonnées techniques uniquement — commentaire explicite « never log answers or prompts » (`topics.ts:L113-L123`) :

```json
{"event":"topics.generate","uidPseudo":"local-de","status":"ok","at":"…","tokens":null,"model":"simulation","simulated":true}
```

---

## 10. Exécution réelle

**Exécuté** le 2026-11-20 contre `http://127.0.0.1:3000/api/topics/generate` (serveur `npm run dev` actif), profil exemple §2, `simulate: true`, header `Origin: http://127.0.0.1:5173`.

### Log serveur

```
{"event":"topics.generate","uidPseudo":"local-de","status":"ok","at":"2026-11-20T16:08:41.322Z","tokens":null,"model":"simulation","simulated":true}
```

### Réponse brute (JSON) — corps utile

Les titres / contextes / hypothèses / first_steps / keywords reproduisent **exactement** le symptôme utilisateur. Champs de contrôle :

- `"model":"simulation"`
- `"simulated":true`
- `"aiGenerated":false`
- `"regenerationsRemaining":3`
- `"persistence":"none"`

Extrait mastery (premier sujet) tel que reçu :

```json
{
  "axis": "mastery",
  "title": "pratiques et enjeux en sociologie : une lecture maîtrisée pour un mémoire recherche m2",
  "context": "Le débat contemporain sur pratiques et enjeux en sociologie croise des lectures déjà stabilisées en sociologie. Ce cadrage part d’un enjeu disciplinaire reconnu, sans forcer une ouverture trop large.",
  "research_question": "Comment analyser pratiques et enjeux en sociologie en mobilisant les acquis déjà solides en sociologie, à partir de votre profil ?",
  "hypotheses": [
    "Les outils déjà maîtrisés en sociologie suffisent pour cadrer une première analyse crédible.",
    "Un corpus ou un terrain accessible dans le délai déclaré permet de tester la question sans surcharger le calendrier.",
    "Les travaux antérieurs indiqués fournissent un point d’appui utile pour éviter de repartir de zéro."
  ],
  "feasibility": {
    "level": "high",
    "first_steps": [
      "Recenser 15 à 20 sources via des mots-clés précis.",
      "Rédiger une note de cadrage d’une page.",
      "Valider la portée du terrain ou du corpus avec l’encadrement."
    ]
  },
  "keywords_fr": [
    "sociologie",
    "pratiques et enjeux en sociologie",
    "méthode",
    "faisabilité",
    "cadrage"
  ]
}
```

Le champ `ticket` (JWT-like HMAC, long) est omis ici pour lisibilité ; il était présent dans la réponse HTTP 200 complète (status `STATUS=200`). Les trois axes ambition/discovery suivent les gabarits §3.

---

## 11. Problèmes identifiés

*(Pas de propositions de correction.)*

1. **Mode simulation activé par défaut** | `TopicGenerator.tsx:L69` + case `TopicReview.tsx:L162-L176` + branche `generate.ts:L28` | L’utilisateur obtient des gabarits même si `ANTHROPIC_API_KEY` est définie | **bloquant** (qualité perçue)

2. **Contenu 100 % template string** | `simulateContent.ts:L42-L174` | Titres/hypothèses/faisabilité génériques, non ancrés dans un objet de recherche réel | **bloquant**

3. **Thème par défaut « pratiques et enjeux en ${discipline} »** | `simulateContent.ts:L51-L54` | Recopie littérale visible (« pratiques et enjeux en sociologie ») quand aucun `imposed_theme` | **majeur**

4. **`typeLabel.toLowerCase()` dans les titres** | `simulateContent.ts:L63, L95` | Affiche « mémoire recherche m2 » en minuscules | **mineur**

5. **Hypothèses centrées démarche, pas objet** | gabarits `hypotheses` mastery/ambition/discovery | Aligné au symptôme (« les outils déjà maîtrisés… ») | **majeur**

6. **Faisabilité / first_steps figés** | dont « Recenser 15 à 20 sources… » `simulateContent.ts:L82-L85` | Non personnalisé | **majeur**

7. **Mots-clés = discipline + theme + mots fixes** | `keywords_fr: [discipline, theme, "méthode", …]` | Echo du formulaire | **majeur**

8. **Badge « Simulation · simulation » redondant** | `TopicResults.tsx:L243-L246` + `model:"simulation"` | Confusion UX | **mineur**

9. **Orphelin « choix. »** | phrase + badge inline-block `TopicResults.tsx:L239-L246`, `topics.css:L1259` | Artefact de mise en page | **mineur**

10. **Troncature visuelle contexte** | `topics.css:L1173-L1200` line-clamp | « … » alors que le JSON est complet | **mineur**

11. **Régénération simulation non différenciante** | `generate.ts:L28-L37` + mêmes gabarits | Compteur baisse mais contenu quasi identique | **majeur**

12. **Prompts LLM / anti-hallucination inutilisés en sim** | chemin court-circuité | Qualité documentée dans les prompts jamais appliquée au symptôme | **majeur** (impact conditionnel)

13. **Pas de recherche documentaire / RAG sur ce parcours** | absence dans `services/topics` | Pas de sources vérifiées | **majeur** (par rapport à une attente « sujets de recherche »)

14. **Pas de persistance serveur profil/sujets** | `persistence:"none"`, draft 501 | Données seulement locales / workspace fichiers | **mineur** (produit étape A)

---

## 12. Index des fichiers

| Fichier | Rôle |
|---------|------|
| `package.json` | Workspaces monorepo, Node ≥24 |
| `frontend/package.json` | Dépendances React/Vite |
| `backend/package.json` | Dépendances Express/LLM/docx |
| `.env` / `.env.example` | Config IA, secrets, storage |
| `frontend/src/pages/Workspace.tsx` | Navigation « Construire mon projet » |
| `frontend/src/components/copilot/ResearchStudio.tsx` | Étape 1, archive, choix sujet, persist |
| `frontend/src/components/topics/TopicGenerator.tsx` | Orchestration phases + `simulate` défaut true + fetch generate/regen |
| `frontend/src/components/topics/TopicNotice.tsx` | Consentements |
| `frontend/src/components/topics/TopicQuestionnaire.tsx` | Wizard questions |
| `frontend/src/components/topics/TopicReview.tsx` | Récap + case simulation |
| `frontend/src/components/topics/TopicResults.tsx` | Cartes, badge, regen, choix → documents |
| `frontend/src/components/topics/QuestionField.tsx` | Widgets de saisie |
| `frontend/src/components/topics/TopicSelect.tsx` / `TopicMultiSelect.tsx` | Listes |
| `frontend/src/components/topics/storage.ts` | localStorage brouillon |
| `frontend/src/components/topics/topicArchive.ts` | Types archive + upload doc |
| `frontend/src/components/topics/formatAnswer.ts` | Affichage récap |
| `frontend/src/components/topics/downloadDocx.ts` | Téléchargement Word |
| `frontend/src/components/topics/ConfirmDialog.tsx` | Confirmations |
| `frontend/src/styles/topics.css` | Layout, line-clamp, badge |
| `backend/src/server.ts` | Routes API topics + user local-dev |
| `backend/src/routes/topics.ts` | generate / regenerate / document / draft |
| `backend/src/services/topics/generate.ts` | Aiguillage simulate vs LLM |
| `backend/src/services/topics/simulateContent.ts` | **Gabarits sujets + documents** |
| `backend/src/services/topics/promptBuilder.ts` | System/user prompts sujets |
| `backend/src/services/topics/validateOutput.ts` | Zod sortie sujets |
| `backend/src/services/topics/generateDocument.ts` | Génération projet/plan |
| `backend/src/services/topics/documentPromptBuilder.ts` | Prompts documents |
| `backend/src/services/topics/validateDocument.ts` | Zod + densité documents |
| `backend/src/services/topics/validateAnswers.ts` | Validation answers/consents |
| `backend/src/services/topics/generationTicket.ts` | Tickets regen HMAC |
| `backend/src/services/topics/rateLimit.ts` | 8 req / 10 min |
| `backend/src/services/topics/buildDocx.ts` | Construction DOCX |
| `backend/src/services/llm/client.ts` | Client unifié chatCompletion |
| `backend/src/services/llm/claude.ts` | Anthropic/Bedrock/Vertex + isLlmConfigured |
| `backend/src/prompts/researchTopicsSystem.ts` | Prompt system sujets (runtime) |
| `backend/src/prompts/research_topics.system.md` | Variante markdown non branchée |
| `backend/src/prompts/researchDocumentSystem.ts` | Prompt system documents |
| `backend/src/services/privacy/buildPseudonymizedProfile.ts` | Re-export shared |
| `backend/src/storage/index.ts` | BUCKET filesystem vs postgres |
| `shared/research/topicQuestions.ts` | Définition questionnaire |
| `shared/research/topicTypes.ts` | Types GeneratedTopic, consents, regen |
| `shared/research/documentStructures.ts` | Outlines + labels types projet |
| `shared/research/workPlan.ts` | Planning dérivé du sujet |
| `shared/research/projectContext.ts` | Préremplissage cadrage depuis sujet |
| `shared/research/notice.ts` | NOTICE_VERSION |
| `shared/privacy/buildPseudonymizedProfile.ts` | Profil LLM whitelist |
| `shared/privacy/sensitiveFilter.ts` | Masquage textes (utilisé profil) |
| `docs/DIAGNOSTIC_GENERATION_SUJETS.md` | Ce rapport |

---

## Synthèse causale du symptôme

| Observation UI | Cause directe |
|----------------|---------------|
| Badge `Simulation · simulation` | `simulate: true` → `simulated: true` + `model: "simulation"` affichés ensemble |
| Texte `choix.` orphelin | Fin de phrase « après le choix. » + badge inline-block |
| Sujets génériques / « pratiques et enjeux en sociologie » / « mémoire recherche m2 » | Gabarits `simulateTopics` + défaut theme + `toLowerCase()` |
| Hypothèses sur la démarche | Chaînes fixes des gabarits |
| « Recenser 15 à 20 sources » | `first_steps[0]` mastery hardcodé |
| Mots-clés = formulaire | `keywords_fr: [discipline, theme, …]` |
| Contexte avec `…` | CSS `-webkit-line-clamp` |
| `3 / 3` | Ticket fraîchement émis, aucune regen consommée |

**Le LLM configuré n’intervient pas tant que la case « Mode simulation (sans IA) » reste cochée (comportement par défaut).**

---

## Changements appliqués (2026-11-20)

Voir aussi `docs/CHANGELOG_GENERATION_SUJETS.md`.

1. Simulation désactivée par défaut ; démo gated (`ALLOW_SIMULATION` / `VITE_ALLOW_SIMULATION`) ; 503 si LLM absent.
2. Profil LLM en libellés + `interest_objects` / `field_access` + budget de temps + guides de niveau.
3. Génération via tool use Claude, nouveau prompt, contrôle qualité + correction unique, régénération mono-sujet.
4. Lectures OpenAlex/HAL vérifiées en code (jamais inventées par le modèle).
5. Projet de recherche : citations bornées aux lectures, bibliographie DOCX, contrôle du planning.
6. Logs métadonnées uniquement (tokens, latence, violations, lectures, personnalisation).

### Correctifs post-vérification (2026-11-20, 2ᵉ passe)

1. **Latence / tokens** : cause = thinking adaptatif Sonnet 5.5 (défaut effort high). Correction : `thinking: { type: "between_tools" }` + `output_config.effort: "low"` ; `max_tokens` 6000/2500 ; schémas bornés. `tool_choice` forcé et `temperature` restent refusés par l’API sur ce modèle → `output_config` (écart documenté).
2. **Lectures différées** : `POST /api/topics/readings` + cache 2 h ; generate sans attendre HAL/OpenAlex.
3. **Pertinence** : requêtes courtes, filtre champs OpenAlex / domaine HAL shs, reclassement Haiku score ≥ 2.
4. **Citations** : ne transmettre que score ≥ 2 ; bibliographie citée / autres pistes ; personalization_level = `profileCompleteness` en code.
