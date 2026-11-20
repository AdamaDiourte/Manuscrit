# Audit lecture seule — contexte projet vers l’IA (Manuscrit)

Date : 2026-11-20. Aucun fichier applicatif modifié hors ce rapport.  
Références : `docs/contrat-non-regression.md`, `docs/audit-ia.md`, `docs/audit-planning.md`, code observé.

Objectif : vérifier que **toutes** les informations fournies par l’utilisateur (pas seulement les matériaux) participent à la réflexion de l’IA, là où elles sont utiles.

---

## 1. INVENTAIRE DES INFORMATIONS RECUEILLIES

Stockage principal workspace : ObjectStore clé `owners/{uid}/workspace` (JSON projets).  
Cadrage corpus / brouillon copilote : `project.copilot` (alias « draft » côté route).  
Parcours sujets (questionnaire) : `localStorage` clé `manuscrit.topicGenerator.draft.v1` (+ archive dans `copilot.topicArchive`).

### 1.1 Cadrage corpus (`CorpusFrame` + champs associés)

Type : `shared/research/corpusOrganization.ts` — `CorpusFrame`.  
Saisie UI : `frontend/src/components/copilot/CorpusOrganizer.tsx` → `update(key)` → `project.copilot`.

| Information | Nom technique | Fichier / emplacement |
|-------------|---------------|------------------------|
| Type de document | `documentType`, `documentTypeOther` | `copilot` |
| Discipline | `discipline`, `disciplineOther` | `copilot` |
| Spécialité | `specialty` | `copilot` |
| Volume prévisionnel | `expectedLength` | `copilot` |
| Temps de rédaction | `writingTime` | `copilot` (`WRITING_TIME_OPTIONS`) |
| Date de démarrage | `startDate` | `copilot` (YYYY-MM-DD, facultatif) |
| Présentation du sujet | `brief` | `copilot` (80–2000 car. : `BRIEF_MIN_CHARS` / `BRIEF_MAX_CHARS`) |
| Modes de recueil (déclaration) | `collectionModes`, `collectionModesOther`, `collectionCombinedNote` | `copilot` — **UI actuelle** : modes surtout **déduits** des fiches via `modesFromMaterials` ; champs legacy encore vidés à l’abandon (`ResearchStudio`) |
| Modes déduits | `modesFromMaterials(materials)` | calcul à la volée (`toolType` + `type` des fiches) |
| Notices / consentements corpus | `corpusNoticeAccepted`, `corpusAiAccepted`, `corpusPrivacyAccepted` | `copilot` |
| Confirmation projet | `corpusProjectConfirmed` | `copilot` |
| Exclusion de fiches | `excluded: string[]` | `copilot` |
| Fichier brief (legacy) | `briefName`, `briefFile` | `copilot` (nettoyés à l’abandon ; plus d’UI cadrage) |
| Vue agrégée UI | `project.frame` | **pas stocké** : reconstruit dans `Workspace.tsx` depuis `copilot` (sous-ensemble : type, discipline, volume, temps, startDate, brief) |

### 1.2 Parcours « sujet » (topics)

| Information | Nom technique | Fichier / emplacement |
|-------------|---------------|------------------------|
| Réponses questionnaire | `answers: Record<string, unknown>` | `localStorage` (`frontend/src/components/topics/storage.ts`) ; envoyées à `/api/topics/*` ; **non** persistées dans le workspace sauf `projectType` dans l’archive |
| Consents topics | `TopicConsents` | `localStorage` |
| Questions (liste) | `topicQuestions[].id` | `shared/research/topicQuestions.ts` — toutes marquées `sentToLLM: true` (whitelist `LLM_FIELD_WHITELIST`) |
| Profil LLM | `axes` + `fields` | `shared/privacy/buildPseudonymizedProfile.ts` (filtre + scrub) |
| 3 sujets générés | `GeneratedTopic[]` | réponse API ; `copilot.topicArchive[].topics` |
| Sujet retenu | `chosenTopic: GeneratedTopic` | `copilot.chosenTopic` + `topicArchive[].chosenTopic` |
| Titre sujet | `chosenTopic.title` | idem |
| Contexte narratif | `chosenTopic.context` | idem |
| Question de recherche | `chosenTopic.research_question` | idem — **pas** de champ `CorpusFrame` homonyme |
| Hypothèses | `chosenTopic.hypotheses[]` | idem |
| Terrain / corpus | `chosenTopic.field_or_corpus` | idem |
| Méthode | `chosenTopic.method` | idem |
| Faisabilité / risques / premiers pas | `chosenTopic.feasibility.{level,risks,first_steps}` | idem |
| Justification | `chosenTopic.rationale` | idem |
| Mots-clés | `chosenTopic.keywords_fr`, `keywords_en` | idem |
| Notes éthiques | `chosenTopic.ethical_notes` | idem |
| Axe (mastery/ambition/discovery) | `chosenTopic.axis` | idem |
| Documents générés (projet, plan…) | `TopicDocument` / fichiers archivés | `topicArchive[].documents` (fileIds ObjectStore) ; génération via `documentPromptBuilder.ts` |
| Champs design dérivés du sujet | `interests`, `aims`, `methods`, `literature` | `draftFromTopic` dans `ResearchStudio.tsx` → `copilot` |
| Type projet dans archive | `topicArchive[].projectType` | depuis `answers.project_type` uniquement |

Champs questionnaire (IDs) : `project_type`, `project_type_other`, `discipline_main`, `discipline_main_other`, `specialty`, `topic_freedom`, `imposed_by`, `imposed_theme`, `lab_themes`, `deadline_range`, `expected_length`, `weekly_time`, `writing_language`, `writing_language_other`, `disciplines_studied`, `favorite_courses_1..3`, `liked_aspects`, `disliked_courses`, `inspiring_concept`, `curious_discipline`, `past_works`, `continue_or_avoid`, `continue_or_avoid_detail`, `methods_skills`, `software`, `method_to_learn`, `method_to_learn_other`.

### 1.3 Projet workspace

| Information | Nom technique | Emplacement |
|-------------|---------------|-------------|
| Titre | `project.title` | workspace |
| Type / précision | `project.type`, `typeOther` | workspace |
| Démo | `project.demo` | workspace |
| Chapitres | `project.chapters[]` (`title`, `progress`, `text`, `links`, `sections[]`) | workspace |
| Tâches | `project.tasks[]` (`title`, `status`, `chapter`, `text`) | workspace |
| Échéances | `project.dates[]` (`title`, `date`, `chapter?`) | workspace — `findSubmissionEndDate` pour fin de planning |
| Commentaires | `project.comments[]` (`title`, `type`, `status`, `text`, `chapter?`) | workspace |
| Versions | `project.versions[]` | workspace (snapshots) |
| Matériaux | `project.materials[]` | workspace |
| Copilote / résultats | `project.copilot` (`corpusResult`, `topicArchive`, cadrage…) | workspace |

### 1.4 Métadonnées matériau

| Information | Nom technique | Emplacement |
|-------------|---------------|-------------|
| Type de données | `type` | fiche |
| Outil de recueil | `toolType`, `toolUnavailable` | fiche |
| Titre | `title` | fiche |
| Code citation | `materialCode(m)` | dérivé (`shared/research/project.ts`) |
| Observation | `observation` | fiche |
| Texte libre / extrait | `text`, `extracted`, `toolExtracted` | fiche |
| Fichiers | `file`, `filename`, `toolFile`, `toolFilename` | fiche + binaires `owners/{uid}/files/{sha}` |
| Extra (clé → texte) | `extra` | fiche |
| Tableaux structurés | `tables[]` | fiche (pipeline unités) |
| Statut d’extraction | `extractionStatus`, `extractionMessage`, `toolExtractionStatus`, `toolExtractionMessage` | fiche |
| Attestation dépôt | `attestedAt` | fiche |
| Transcription vision | `visionTranscription`, `toolVisionTranscription` | hydratés / persistés hors ou dans fiche selon pipeline |
| Exclusion analyse | présence dans `copilot.excluded` | draft |
| Date de recueil dédiée | — | **absent** (pas de champ date sur la fiche matériau) |

Texte agrégé IA : `materialText(m)` = observation + text + extracted + toolExtracted + extra(+ labels) + vision.

### 1.5 Révision et plan précédent

| Information | Nom technique | Emplacement |
|-------------|---------------|-------------|
| Consigne de révision | `revisionFeedback` | corps `POST /api/research` (trim, ≤ 1200) ; aussi recopié dans `corpusResult` UI |
| Plan précédent | `previousPlan[]` `{title, advice}` | corps POST (≤ 12 sections ; advice tronqué à 600) |
| Plan courant | `copilot.corpusResult` | workspace |

### 1.6 Autres saisies UI vers l’IA

| Information | Nom technique | Usage |
|-------------|---------------|--------|
| Mots-clés Crossref | `publicQuery` | optionnel mode corpus (≤ 180) → catalogue externe uniquement |
| Consentement analyse | `consent` | gate POST |
| Simulation | `simulate` | `simulateCorpusPlan` |
| Pseudonymisation | `pseudonymize`, `pseudonymNames` | pipeline |
| Mode lot | `pipelineMode` / `batch` / `modeEconomique` | pipeline |
| Design (questions legacy) | `interests`, `discipline`, `skills`, `aims`, `methods`, `literature` | `shared/research/project.ts` `questions` — brief mode `design` |

---

## 2. CE QUI ARRIVE RÉELLEMENT À L’IA

### 2.1 Construction du brief corpus

```594:629:shared/research/corpusOrganization.ts
export function buildCorpusBrief(
  frame: CorpusFrame,
  materials: { type?: string }[] = [],
): string {
  // … libellés documentType, discipline, specialty, expectedLength, writingTime,
  // modes (matériaux ou collectionModes), collectionCombinedNote, brief …
  return parts.join("\n\n");
}
```

**Non inclus dans `buildCorpusBrief`** : `startDate`, titre projet, type projet workspace, `chosenTopic` / `research_question` / hypothèses / méthode structurées, questionnaire topics, chapitres/tâches/dates/commentaires, `revisionFeedback` (ajouté à part sur le chemin sync), consentements.

Appel route : `backend/src/routes/research.ts` — mode corpus → `buildCorpusBrief(draft, p.materials) || draft.brief`.

### 2.2 Tableau de transmission

Légende : **transmis** (forme) · **absent** · **non pertinent** (étape sans LLM ou hors rôle).

| Information | `engine.analyze` (sync) | Extraction | Synthèse | Planification | Affectation | Vérification | Simulation |
|-------------|-------------------------|------------|----------|---------------|-------------|--------------|------------|
| `documentType` (+ other) | transmis (libellé dans `brief` + `format` + `writingStructure`) | transmis (via brief système ≤ 8k) | transmis (brief ≤ 6k système) | transmis (`brief` user JSON ≤ 8k + `format` + `writingStructure`) | transmis (brief ≤ 4k système) | non pertinent (déterministe) | transmis (`format`, structure, `documentType`) |
| `discipline` (+ other) | transmis (rubrique brief) | idem brief | idem | idem | idem | non pertinent | via brief (aperçu tronqué 120 car. du brief) |
| `specialty` | transmis (rubrique brief) | idem | idem | idem | idem | non pertinent | via brief |
| `expectedLength` | transmis (rubrique brief) | idem | idem | idem | idem | non pertinent | via brief |
| `writingTime` | transmis (rubrique brief) ; planning **hors** LLM | idem | idem | idem | idem | non pertinent | planning déterministe + hint brief |
| `startDate` | **absent** du LLM ; planning déterministe (`scheduleOpts`) | absent | absent | absent | absent | non pertinent | planning déterministe |
| `brief` (présentation) | transmis (texte dans `brief`) | transmis (système) | transmis | transmis (user JSON) | transmis | non pertinent | tronqué à **120** car. dans les advice |
| Modes recueil | transmis (libellés agrégés dans brief) | idem | idem | idem | idem | non pertinent | via brief |
| `collectionCombinedNote` | transmis si présent | idem | idem | idem | idem | non pertinent | via brief |
| Consentements / `excluded` | non pertinent / filtre sources | filtre unités | — | — | — | — | filtre sources |
| Titre / type projet workspace | type → repli `format` si pas de documentType ; **titre absent** | absent (sauf format via brief) | absent | `format` string | absent | non pertinent | `format` |
| Chapitres / tâches / commentaires / versions | **absent** | absent | absent | absent | absent | non pertinent | absent |
| Dates échéance projet | **absent** LLM ; fin planning déterministe | absent | absent | absent | absent | non pertinent | `endDate` planning |
| `chosenTopic` / RQ / hypothèses / méthode | **absent** mode corpus | absent | absent | absent | absent | non pertinent | absent |
| Questionnaire topics (`answers`) | **absent** corpus ; **transmis** génération sujets/docs (profil JSON) | — | — | — | — | — | topics simulés |
| `interests`/`aims`/… design | **transmis** mode `design` seulement (texte Q+R) | non pertinent corpus | — | — | — | — | design N/A |
| Matériau `type` | transmis (`sources[].type` + titre préfixé code) | via label unité / type matériau | via fiches | indirect | via fiches | non pertinent | sources |
| `toolType` | **absent** comme champ source (seulement s’il apparaît dans modes brief) | absent champ dédié | absent | absent | absent | non pertinent | absent |
| Titre / code matériau | transmis (`title` = `CODE · titre`, `code`) | label unité | materialId | indirect | materialId | materialId evidence | sources |
| `observation` + textes | transmis (`sources[].text` = `materialText`) | texte / vision / table unité | résumé fiches | thèmes | claims/quotes | offsets | sources |
| `extra` | transmis (dans `materialText`) | idem | idem | idem | idem | idem | idem |
| `tables` structurés | sync : aplatis dans texte ; pipeline : structure+stats JSON | transmis (unité table) | via claims | via thèmes | via fiches | non pertinent | texte |
| `extractionStatus` | **absent** (filtre usable / skip vision) | skip si empty/scanned sans vision | — | — | — | — | — |
| Exclusion | filtre avant envoi | filtre | — | — | — | — | filtre |
| `revisionFeedback` | transmis (champ JSON + concat brief si sync) | **absent** | **absent** | transmis (user JSON) | **absent** | non pertinent | transmis (aperçu) |
| `previousPlan` | transmis (JSON user) | absent | absent | transmis | absent | non pertinent | titres repris |
| `publicQuery` / catalogue | transmis (`catalogue` abstracts) | absent | absent | absent | absent | non pertinent | absent |
| `writingStructure` | transmis (JSON user) | absent | absent | transmis | résumé sections | non pertinent | ossature simulée |

### 2.3 Citations code — prompts pipeline

| Étape | Prompt | Injection du cadrage |
|-------|--------|----------------------|
| Commun | `backend/src/prompts/pipeline/common.ts` — `PIPELINE_COMMON` | Pas de brief |
| Extraction | `prompts/pipeline/extract.ts` — `EXTRACT_SYSTEM` | `systemWithBrief` : système + « Cadrage du projet… » + `brief.slice(0, 8000)` (`pipeline/extract.ts`) |
| Synthèse | `prompts/pipeline/synthesize.ts` — `SYNTHESIZE_SYSTEM` | `SYNTHESIZE_SYSTEM + "\n\nCadrage :\n" + brief.slice(0, 6000)` ; merge : `brief.slice(0, 4000)` dans le user JSON |
| Plan | `prompts/pipeline/plan.ts` — `PLAN_SYSTEM` | Brief dans le **user** JSON (`brief.slice(0, 8000)`), pas dans le système |
| Affectation | `prompts/pipeline/assign.ts` — `ASSIGN_SYSTEM` | `ASSIGN_SYSTEM + "\n\nCadrage :\n" + brief.slice(0, 4000)` |
| Vérif. | `pipeline/verify.ts` — `buildVerifiedPlan` | **Aucun LLM** |
| Sync | `engine.ts` — `common` + `instructions.corpus` | Brief + matériaux en **user** JSON (pas dans le system) |

---

## 3. LIENS ENTRE PARCOURS

### 3.1 Sujet choisi → projet / cadrage corpus

**Chaîne actuelle au choix d’un sujet** (`chooseTopic` → `draftFromTopic`) :

1. Persiste `chosenTopic` + archive.
2. Remplit les champs **design** `interests`, `aims`, `methods`, `literature` (texte concaténé : titre, RQ, hypothèses, terrain, méthode, mots-clés…).
3. **Ne remplit pas** `copilot.brief`, `documentType`, `discipline`, `specialty`, `expectedLength`, `writingTime`, ni le titre/`type` du projet workspace.

**Rupture** : en mode corpus, `buildCorpusBrief` lit uniquement le cadrage `CorpusFrame`. `chosenTopic` reste dans le JSON workspace mais **n’est jamais lu** par `POST /api/research` ni par le pipeline. La question de recherche, les hypothèses et la méthode du sujet retenu **ne sont donc pas rattachées au plan de rédaction**, sauf si l’utilisateur les resaisit manuellement dans « Présentation du sujet ».

Le questionnaire topics (`answers`) n’est **pas** recopié dans `copilot` (seul `projectType` de session d’archive). Discipline / volume / délais du questionnaire ne préremplissent pas le cadrage corpus.

### 3.2 Question de recherche : champ distinct ?

| Contexte | Statut |
|----------|--------|
| `GeneratedTopic.research_question` | Champ **distinct** dans le modèle sujet |
| UI archive / résultats sujets | Affichage dédié |
| `CorpusFrame` / formulaire Organiser | **Absent** — seule « Présentation du sujet » (`brief`), dont le placeholder *invite* à inclure la question, sans structure |
| Brief IA corpus | RQ **noyée** seulement si l’auteur l’écrit dans `brief` |
| Mode design | RQ **noyée** dans `interests` / `aims` (texte libre) |

---

## 4. QUALITÉ DE L’USAGE

### 4.1 Structuration dans les prompts

| Couche | Forme |
|--------|--------|
| `buildCorpusBrief` | **Rubriques nommées** (« Type de manuscrit visé », « Discipline », « Présentation du sujet… ») — bon |
| `engine.analyze` user | **JSON** `{ brief, format, writingStructure, materials, catalogue, revisionFeedback, previousPlan }` — structuré au niveau champs ; le `brief` lui-même est déjà un texte multi-rubriques |
| Pipeline extract / synth / assign | Brief collé en **bloc texte** sous le système (« Cadrage : ») — pas de sous-champs JSON séparés (RQ, hypothèses…) |
| Pipeline plan | Brief champ JSON user — OK |
| Topics | Profil `axes`/`fields` JSON — structuré |

### 4.2 Consignes d’usage du contexte

| Étape | Demande explicite ? |
|-------|---------------------|
| `instructions.corpus` (engine) | Oui : lire cadrage (type, discipline, présentation, volume, temps) ; adapter au genre et au volume ; mobiliser types de matériaux ; révision si `revisionFeedback` |
| `EXTRACT_SYSTEM` | Oui : `relevance` « pour la **question de recherche** » — mais **aucune RQ structurée** n’est fournie ; le modèle doit l’inférer du brief libre |
| `SYNTHESIZE_SYSTEM` | Faible : pas de rappel genre / discipline / RQ |
| `PLAN_SYSTEM` | Oui : brief + `writingStructure` ; pas de mention explicite « question de recherche » / conventions disciplinaires |
| `ASSIGN_SYSTEM` | Faible : cadrage présent, pas de consigne « juger vs RQ » |
| Modes de recueil | Présents dans le brief agrégé ; pas de consigne pipeline du type « interpréter selon le mode de recueil » au-delà du type matériau |

### 4.3 Cache prompt (système)

- Claude (`callClaude`) : `cache_control: ephemeral` sur le **bloc système** si `promptCaching` (`claude.ts`).
- **Extraction / synthèse / affectation** : brief **dans** le système → le cadrage est dans le bloc mis en cache (identique pour toutes les unités d’un même appel, tant que le brief ne change pas).
- **Planification** : brief dans le **user** → **hors** du breakpoint de cache système.
- **Engine sync (OpenAI-compatible)** : system = consignes seules ; brief dans user — **pas** de prompt-cache Anthropic sur ce chemin.

### 4.4 Empreinte de cache (invalidation si cadrage change)

| Cache | Inclut le brief / cadrage ? | Effet si l’utilisateur modifie le cadrage |
|-------|------------------------------|-------------------------------------------|
| Sync `SHA-256(ENGINE_VERSION, model, baseUrl, input)` | **Oui** (`input.brief`, `format`, `writingStructure`, sources…) | Nouvelle empreinte → **réanalyse** |
| Pipeline `extractCacheKey(unitId, unitText, promptVersion, ENGINE_VERSION, model)` | **Non** — brief **exclu** | Cartes d’extraction **réutilisées** avec un ancien jugement de pertinence → **risque de sous-révision** |
| Simulation | Pas de cache LLM | Brief partiellement reflété (120 car.) |

---

## 5. SYNTHÈSE

### 5.1 Informations perdues ou sous-utilisées (par importance pour la qualité du plan)

1. **`chosenTopic` entier** (question de recherche, hypothèses, méthode, terrain, risques, mots-clés) — stocké mais **jamais** injecté dans le brief corpus / pipeline.  
2. **Question de recherche comme rubrique dédiée** — absente du cadrage ; les prompts extraction parlent de « question de recherche » sans la recevoir clairement.  
3. **Réponses du questionnaire topics** (discipline, volume, délais, langue, contraintes labo, compétences méthodo…) — utiles au cadrage, **non bridgées** vers `CorpusFrame`.  
4. **`startDate` + échéances projet** — utiles au fil du plan / réalisme des conseils ; **hors** LLM (planning déterministe seulement).  
5. **Titre du projet** et richesses workspace (chapitres, avancement, tâches, commentaires) — **jamais** envoyés ; perte de contexte de rédaction déjà engagée.  
6. **`toolType` / mode de recueil par fiche** — modes agrégés dans le brief ; pas de métadonnée structurée par source côté sync (`sources` n’exposent que `type` données).  
7. **`revisionFeedback` / `previousPlan`** — bien transmis en sync et à l’étape **plan** ; **absents** extraction / synthèse / affectation (pertinence et affectation non recalibrées par la consigne de révision).  
8. **Cache extraction sans brief** — sous-utilisation / mauvaise pertinence après changement de cadrage.  
9. **`specialty` / discipline** — transmis via brief, mais consignes pipeline peu insistantes sur les conventions disciplinaires.  
10. **Champs design `skills`** — non peuplés par `draftFromTopic` ; mode design incomplet si l’utilisateur ne repasse pas par un formulaire legacy.

### 5.2 Proposition — objet unique `ProjectContext`

Construit **une fois** côté serveur (route research / démarrage job), transmis à **toutes** les étapes LLM, sans casser `docs/contrat-non-regression.md` (champs HTTP existants inchangés ; ajout **optionnel** côté interne / brief enrichi).

```ts
type ProjectContext = {
  /** Rubriques stables pour prompts (toujours les mêmes clés). */
  document: {
    typeLabel: string;       // documentTypeLabel
    projectTitle: string;    // project.title (tronc. 200)
    projectTypeLabel: string;
  };
  discipline: { label: string; specialty: string };
  scope: {
    expectedLengthLabel: string;
    writingTimeLabel: string;
    startDate?: string;      // ISO date
    endDate?: string;        // findSubmissionEndDate
  };
  research: {
    /** Présentation libre cadrage. */
    presentation: string;    // frame.brief
    /** Champ distinct — prioritaire si choisiTopic ou saisie future. */
    researchQuestion: string;
    hypotheses: string[];
    method: string;
    fieldOrCorpus: string;
    keywords: string[];
    risks: string[];
    topicTitle?: string;
    axis?: string;
  };
  collection: {
    modeLabels: string[];    // modesFromMaterials || collectionModeLabels
    combinedNote: string;
  };
  revision?: {
    feedback: string;        // ≤ 1200 (contrat POST)
    previousPlan: { title: string; advice: string }[]; // ≤ 12
  };
  writingStructure: { title: string; intent: string; role?: string }[];
};
```

**Sources (priorité)**  
1. `CorpusFrame` / `copilot` pour document, discipline, scope, presentation, collection.  
2. `copilot.chosenTopic` pour `research.*` si présent (ne pas écraser un `brief` auteur plus long : **fusion** — RQ/hypothèses/méthode en rubriques séparées ; `presentation` = `brief` ou repli concaténé).  
3. Optionnel additif : sous-ensemble **non sensible** du dernier `answers` d’archive (ex. `deadline_range`, `weekly_time`, `writing_language`) — uniquement champs déjà `sentToLLM`, jamais d’identifiants.  
4. `revisionFeedback` / `previousPlan` depuis le POST (déjà contractuels).

**Règles de troncature (proposées, additives)**  

| Bloc | Max | Notes |
|------|-----|--------|
| `presentation` | 2000 | Aligné `BRIEF_MAX_CHARS` |
| `researchQuestion` | 500 | |
| `hypotheses` | 5 × 300 | |
| `method` + `fieldOrCorpus` | 800 chacun | |
| `keywords` | 20 × 40 | |
| `risks` | 8 × 200 | |
| `combinedNote` | 800 | |
| Sérialisation totale `formatProjectContext(ctx)` | ≤ 8000 | même plafond que brief pipeline extract |
| Empreinte / cache unité | **inclure hash du contexte** (ou du brief formaté) | corrige le trou actuel |

**Format prompt** : fonction `formatProjectContext(ctx) → string` à rubriques nommées (extension de `buildCorpusBrief`, **sans** retirer l’export actuel — contrat : conserver `buildCorpusBrief` ; nouveau helper ou enrichissement interne du string brief).  
Injection : même string dans extract/synth/assign (système) et plan/engine (user) ; consignes : « Jugez la pertinence **par rapport à researchQuestion** ; respectez le type de document et la discipline ; tenez compte des modes de recueil. »

**Non-régression**  
- Ne pas renommer/supprimer `buildCorpusBrief`, `analyze`, champs POST.  
- Enrichir le **contenu** de `brief` (ou champ interne job) de façon additive.  
- Projects sans `chosenTopic` : comportement actuel + rubriques vides omises.  
- Bump `ENGINE_VERSION` + `EXTRACT_PROMPT_VERSION` si le brief formaté change (invalide caches).

---

## Annexe — Carte des fichiers sentinelles

| Rôle | Chemin |
|------|--------|
| Brief corpus | `shared/research/corpusOrganization.ts` — `buildCorpusBrief` |
| Route analyse | `backend/src/routes/research.ts` |
| Moteur sync | `backend/src/services/research/engine.ts` |
| Prompts pipeline | `backend/src/prompts/pipeline/*.ts` |
| Injection brief pipeline | `pipeline/extract.ts`, `synthesize.ts`, `plan.ts`, `assign.ts` |
| Cache unités | `pipeline/cache.ts` — `extractCacheKey` |
| Pont sujet → draft | `frontend/.../ResearchStudio.tsx` — `draftFromTopic` |
| Types sujet | `shared/research/topicTypes.ts` — `GeneratedTopic` |
| Profil topics | `shared/privacy/buildPseudonymizedProfile.ts` |
| Contrat | `docs/contrat-non-regression.md` |
