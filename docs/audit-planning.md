# Audit lecture seule — planning de travail personnalisé (Manuscrit)

Date : 2026-11-19. Aucun fichier applicatif modifié hors ce rapport.

---

## 1. STACK ET ARCHITECTURE

### Stack

| Couche | Techno | Versions / source |
|--------|--------|-------------------|
| Monorepo | npm workspaces (`frontend`, `backend`) | `package.json` racine `manuscrit-datasensia@1.0.0`, Node `>=24` |
| Front | React + Vite + TypeScript | `react`/`react-dom` **19.2.6**, `vite` **8.0.13**, `typescript` **5.9.3** (`frontend/package.json`) |
| Icônes | `lucide-react` **1.31.0** + Font Awesome (classes `fa-solid` dans le JSX) | |
| Validation | Zod **^4.6.7** (front + back) | |
| Back | Express **^5.1.0**, TypeScript, `tsx` / `esbuild` (cible `node24`) | `backend/package.json` |
| DOCX | `docx` **^9.15.4** | backend uniquement |
| Stockage | Object store (`ObjectStore` / `pg` **8.16.3**) — **pas** Prisma / Drizzle / Mongoose | `backend/src/storage/types.ts` |
| ORM | **absent** | |
| Routing HTTP | Express dans `backend/src/server.ts` (`/api/workspace`, `/api/research`, `/api/research/plan-docx`, `/api/topics/*`, `/api/billing`) | |
| Routing UI | **absent** (pas de react-router) : SPA unique `frontend/src/main.tsx` → `Workspace.tsx`, navigation par état `view` / pages copilote | |
| État | React `useState` / `useRef` locaux ; persistance workspace via `GET/POST /api/workspace` | **pas** Redux/Zustand/React Query |
| SSR | **absent** (CSR Vite `createRoot`) | |
| i18n | **absent** (français en dur) | |
| Tailwind / shadcn / MUI | **absent** | CSS maison |

### Arborescence utile (2–3 niveaux)

```
manuscrit/
├── frontend/src/
│   ├── main.tsx                 # point d’entrée SPA
│   ├── pages/Workspace.tsx      # coquille UI, projets, chapitres, dates
│   ├── components/
│   │   ├── copilot/             # Organiser mon manuscrit + plan/planning
│   │   └── topics/              # questionnaire sujet + docs Word
│   ├── data/projectTemplates.ts # modèle projet / démo
│   ├── services/import/         # extraction texte (pdf/docx…)
│   └── styles/                  # globals.css, copilot.css, topics.css
├── backend/src/
│   ├── server.ts
│   ├── routes/                  # workspace, research, topics, billing
│   ├── services/research/       # moteur plan IA + export planning
│   ├── services/topics/         # sujets + plan de travail + docx
│   ├── prompts/                 # system prompts LLM
│   └── storage/                 # abstraction bucket
└── shared/research/             # types, outlines, writingSchedule, cadrage
    ├── writingSchedule.ts       # calcul « Planning de rédaction »
    ├── corpusOrganization.ts    # WRITING_TIME_OPTIONS, structures par genre
    ├── simulateCorpusPlan.ts    # aperçu plan sans IA
    ├── documentStructures.ts    # outlines projet / plan de travail
    ├── topicQuestions.ts        # profil questionnaire (délai, rythme…)
    └── topicTypes.ts            # GeneratedTopic, TopicDocument…
```

---

## 2. GÉNÉRATION DES PLANNINGS (point central)

Deux artefacts distincts coexistent.

### A. « Planning de rédaction » (parcours corpus / plan de rédaction)

| Rôle | Fichier | Symbole |
|------|---------|---------|
| Calcul | `shared/research/writingSchedule.ts` | `buildWritingSchedule` |
| Jours / libellés | `shared/research/corpusOrganization.ts` | `WRITING_TIME_OPTIONS`, `writingTimeDays`, `writingTimeLabel` |
| Phases type par genre | idem | `WRITING_STRUCTURES`, `writingStructureFor` |
| Simulation plan + schedule | `shared/research/simulateCorpusPlan.ts` | `simulateCorpusPlan` → appelle `buildWritingSchedule` |
| Branchement API | `backend/src/routes/research.ts` | `withWritingSchedule` |
| Moteur IA (sections, **pas** le découpage jours) | `backend/src/services/research/engine.ts` | `analyze` — JSON `sections` / `gaps` ; schedule ajouté après coup |
| UI | `frontend/src/components/copilot/WritingPlanView.tsx` | bloc `.writing-schedule` |
| Liste projets / DL | `frontend/src/components/copilot/ResearchStudio.tsx` | `projectPlanPayload`, `downloadProjectDoc` |
| Export | `backend/src/services/research/buildCorpusPlanDocx.ts` | `kind: "schedule"` |
| Client DL | `frontend/src/components/copilot/downloadPlanDocx.ts` | `POST /api/research/plan-docx` |

**Pas de prompt LLM dédié au planning de rédaction** : le découpage est déterministe. L’IA ne produit que les `sections` du plan ; `withWritingSchedule` / le front recalculent le schedule.

### B. « Plan de travail » (après choix d’un sujet)

| Rôle | Fichier | Symbole |
|------|---------|---------|
| Outline fixe | `shared/research/documentStructures.ts` | `PLAN_BASE` / `PLAN_OUTLINES`, `getDocumentOutline(..., "work_plan")` |
| Prompt système | `backend/src/prompts/researchDocumentSystem.ts` | `RESEARCH_DOCUMENT_SYSTEM` |
| Prompt user | `backend/src/services/topics/documentPromptBuilder.ts` | `buildDocumentUserPrompt` |
| Génération | `backend/src/services/topics/generateDocument.ts` | `generateTopicDocument` |
| Fallback simulé | `backend/src/services/topics/simulateContent.ts` | `expandSection` / `simulateDocument` |
| Export | `backend/src/services/topics/buildDocx.ts` | `buildTopicDocx` |
| Déclenchement UI | `frontend/src/components/topics/TopicResults.tsx` | `fetchDocument(..., "work_plan")` |

Le planning du plan de travail est surtout un **tableau** section `schedule` (`Période | Objectif | Actions | Livrable | Charge`), pas `buildWritingSchedule`.

### Flux complet — Planning de rédaction

```
cadrage.writingTime (ex. "1_year")
  → writingTimeDays / writingTimeLabel
  → sections (IA analyze | simulateCorpusPlan + WRITING_STRUCTURES[documentType])
  → buildWritingSchedule({ writingTimeDays, writingTimeLabel, sections })
  → result.schedule { totalDays, label, items[] }
  → WritingPlanView (écran) + buildCorpusPlanDocx(kind:"schedule") (Word)
```

### Flux complet — Plan de travail

```
answers (deadline_range, weekly_time, project_type, …) + topic
  → getDocumentOutline(projectType, "work_plan")  // toujours PLAN_BASE
  → LLM (RESEARCH_DOCUMENT_SYSTEM + buildDocumentUserPrompt)
    ou simulateDocument si simulate / pas de AI_API_KEY
  → TopicDocument.sections (identity, map, schedule+table, priorities, checklist)
  → buildTopicDocx → téléchargement .docx (pas d’écran tableau dédié)
```

### Formule exacte de répartition (`jours 1–37 (10 %)`)

Source : `shared/research/writingSchedule.ts`.

1. `days = writingTimeDays` ; si `days < 7` ou aucune section titrée → `null`.
2. Part relecture :
   - `revisionShare = days >= 60 ? 0.18 : days >= 30 ? 0.15 : 0.12`
   - `revisionDays = clamp(round(days * revisionShare), 2, floor(days * 0.25))`
   - `draftingDays = max(sections.length, days - revisionDays)`
3. Poids par titre (`sectionWeight`) : analyses/résultats/terrain… **1.45** ; méthode/corpus/littérature… **1.15** ; intro/problématique… **0.85** ; conclusion… **0.75** ; sinon 1 (bords 0.85 / 0.8).
4. Pour chaque section (sauf dernière) :  
   `share_i = max(1, round((weight_i / Σweights) * draftingDays))` ; dernière = reste.
5. Bornes : `dayStart` / `dayEnd` cumulés sur `[1 .. draftingDays]` ; dernière phase « Relecture et ajustements » = `[draftingDays+1 .. days]`.
6. Pourcentage affiché :

```ts
const pct = Math.round((span / days) * 100);
// share: `${pct} %`
// span = dayEnd - dayStart + 1
```

Exemple cohérent avec « jours 1–37 (10 %) » : `days = 365` (`1_year`), `span = 37` → `round(37/365*100) = 10`.

Dictionnaire durée : `WRITING_TIME_OPTIONS` — `2_weeks`→14, `1_month`→30, `6_weeks`→42, `2_months`→60, `3_months`→90, `6_months`→180, `1_year`→365.

### Pourquoi le même paragraphe se répète / doubles points « déclaré.. »

**Répétition — Planning de rédaction**  
Dans `buildWritingSchedule`, l’`advice` de chaque section de rédaction réutilise la **même** seconde phrase :

```84:85:shared/research/writingSchedule.ts
      advice: `Rédiger « ${s.title} » (jours ${dayStart}–${dayEnd}). Avancez d’abord un brouillon ancré dans vos matériaux, puis densifiez les preuves.`,
```

L’UI réaffiche en plus `Jours {dayStart}–{dayEnd}` au-dessus → double mention des jours.

**Répétition — Document « projet de recherche » simulé**  
Pour `kind !== "work_plan"`, `expandSection` renvoie les **mêmes** `p2`–`p5` à chaque section (seul `p1` change via `heading`/`intent`) :

```348:369:backend/src/services/topics/simulateContent.ts
  const p1 = paragraph(
    `${heading}. ${intent} Le fil conducteur reste le sujet « ${topic.title} ». ...`,
  );
  const p2 = paragraph(
    `Ce travail s’inscrit dans un ${typeLabel}. Il doit rester réaliste au regard du profil : délai déclaré (${deadline || "non précisé"}), temps hebdomadaire (${weekly || "non précisé"}), méthode envisagée (${topic.method}). ${
```

**Doubles points « déclaré.. »**  
- `p2` injecte littéralement « délai déclaré (…) » dans **chaque** section ; `deadline` / `weekly` sont les **codes bruts** (`6to12m`, `5to10`), pas les libellés (contrairement au `work_plan` qui utilise `deadlineLabel` / `weeklyLabel`).
- Aucune normalisation des points finaux avant concaténation : si une valeur interpolée (ex. `topic.method`) se termine déjà par `.`, le gabarit ajoute un second `.` → `..`.
- Cause dédiée produisant exactement la chaîne `déclaré..` : **absente** en dur dans le dépôt ; le mécanisme observé est la répétition de « déclaré » + ponctuation de gabarit / sortie LLM sans strip des points finaux.

### Phases / sections possibles et variation par type de document

**Planning de rédaction (corpus)** — phases = titres de `WRITING_STRUCTURES[projectType]` + phase fixe « Relecture et ajustements ».  
Varie selon `documentType` (`licence`, `m1`, `m2`, `pro`, `internship`, `thesis`, `article`, `talk`, `research_dossier`, `reading_sheet`, `other`) — 4 à 6 sections selon le genre (`shared/research/corpusOrganization.ts`).

**Plan de travail (topics)** — sections **identiques** pour tous les `ProjectTypeId` (`PLAN_OUTLINES` = `PLAN_BASE` pour chaque type) :

1. `identity` — Carte du parcours  
2. `map` — Carte mentale  
3. `schedule` — Planning de travail proposé (+ table)  
4. `priorities` — Si le temps manque  
5. `checklist` — Checklist avant rendu  

Seul le **libellé** du genre / guidance change (`PROJECT_TYPE_LABELS`, `mainDocumentLabel`) ; la structure du plan de travail **ne varie pas** par type.

Simulation `work_plan` : périodes selon `deadline_range` (`lt3m` → semaines ; `3to6m` / `6to12m` → mois ; `gt3y` → années ; sinon trimestres) ; charges selon `weekly_time`.

---

## 3. MODÈLE DE DONNÉES DU PROFIL

### Profil questionnaire (sujets / plan de travail)

Types : `Question` / `GeneratedTopic` / `TopicDocument` dans `shared/research/topicTypes.ts` ; champs = `topicQuestions` dans `shared/research/topicQuestions.ts`.  
Pas de schéma Prisma. Zod utilisé côté routes/validation topics, pas comme schéma profil unique exporté.

`GeneratedTopic` :

```ts
{
  axis: "mastery" | "ambition" | "discovery";
  title: string;
  context: string;
  research_question: string;
  hypotheses: string[];
  field_or_corpus: string;
  method: string;
  feasibility: { level: "high"|"medium"|"low"; risks: string[]; first_steps: string[] };
  rationale: string;
  keywords_fr: string[]; keywords_en: string[];
  ethical_notes: string | null;
}
```

### Projet workspace + cadrage corpus

Création : `makeProject` / `demo` dans `frontend/src/data/projectTemplates.ts` — `id`, `title`, `person`, `type` (libellés UI « Mémoire »…), `chapters[]`, `materials[]`, `tasks[]`, `dates[]`, `comments[]`, `versions[]`, `demo?`.  
Cadrage copilote : `CorpusFrame` (`shared/research/corpusOrganization.ts`) stocké dans `project.copilot` / résumé `frame` côté `ResearchStudio`.

### Champs utiles au planning

| Nom technique | Type / valeurs | Libellés | Usage |
|---------------|----------------|----------|--------|
| `deadline_range` | `lt3m` \| `3to6m` \| `6to12m` \| `gt1y` \| `gt3y` | oui, dans `topicQuestions` | Plan de travail (périodes) |
| `weekly_time` | `lt5` \| `5to10` \| `10to20` \| `fulltime` | oui (`Moins de 5 h`…) | Plan de travail (colonne Charge) |
| `project_type` | `licence`\|`m1`\|`m2`\|`pro`\|`thesis`\|`article`\|`research_dossier`\|`reading_sheet`\|`internship`\|`other` (+ legacy `talk`) | `PROJECT_TYPE_LABELS` | Outlines + libellés |
| `expected_length` | `short`\|`medium`\|`long`\|`unknown` | oui (topics + `EXPECTED_LENGTH_OPTIONS`) | Prompt / cadrage |
| `writingTime` (cadrage) | `2_weeks`\|`1_month`\|`6_weeks`\|`2_months`\|`3_months`\|`6_months`\|`1_year` | `WRITING_TIME_OPTIONS` (+ `days`) | Planning de rédaction |
| `documentType` / `documentTypeOther` | `ProjectTypeId` + texte | `DOCUMENT_TYPE_GROUPS` | Structure plan + schedule |
| `discipline` / `disciplineOther` / `specialty` / `brief` | string | `DISCIPLINE_OPTIONS` | Brief corpus (pas le calcul jours) |
| `topic.method` / `field_or_corpus` | string (générés) | absent (texte libre) | Simulation plan de travail |
| `topic.feasibility.risks` / `first_steps` | `string[]` | absent | Priorités / prose simulée |
| Sections plan rédaction | `{ title, advice, evidence[] }` | titres issus de `WRITING_STRUCTURES` ou IA | Entrée de `buildWritingSchedule` |

Dictionnaires de libellés : **présents** pour les enums ci-dessus (options questions ou `*_OPTIONS` / `PROJECT_TYPE_LABELS`).  
Exception simulation `research_project` : codes bruts dans `p2` au lieu des libellés.

### Date de début / échéance calendaire ?

- `deadline_range` / `writingTime` : **intervalles relatifs**, pas de date ISO de rendu.
- `project.dates[]` : jalons manuels `{ id, title, date, chapter }` (ex. démo `2026-11-24`) — **non branchés** sur `buildWritingSchedule` ni sur le tableau du plan de travail.
- `result.date` sur le plan : horodatage de génération, pas une échéance auteur.

**Conclusion** : pas de date de début ni d’échéance réelle exploitable aujourd’hui pour des dates calendaires dans le générateur de planning → **absent** pour ce calcul.

---

## 4. EXPORT

### DOCX — bibliothèque

- Package : **`docx`** (`^9.15.4`), backend.
- Planning / plan de rédaction : `backend/src/services/research/buildCorpusPlanDocx.ts` via `POST /api/research/plan-docx`.
- Plan de travail / projet de recherche : `backend/src/services/topics/buildDocx.ts` via flux `/api/topics/document`.

Pas de docxtemplater, pandoc, ni template `.docx` externe.

### Autres exports

| Format | Statut |
|--------|--------|
| PDF export planning | **absent** (PDF = import matériaux via pdf.js uniquement) |
| HTML export | **absent** |
| Impression dédiée | **absent** (`@media print` applicatif : absent) |
| Écran | rendu React uniquement |

### Styles DOCX (planning / plan)

`buildCorpusPlanDocx.ts` / `buildTopicDocx.ts` :

- Police : **Times New Roman**
- Titre : bold, size **32** (half-points) ; plan de travail compact **28**
- Heading 1 : bold **26** (corpus) / **24–28** (topics)
- Corps : size **22**, line **320** ; italique méta **20**
- Table plan de travail : size **18**, bordures couleur `CFD5DB`
- Marges page : **1134** DXA (~2 cm) ; plan de travail compact **850**
- En-têtes / pieds de page Word (`header`/`footer` API docx) : **absents**
- « Pied » : paragraphe italique final (« Document généré avec Manuscrit… » / « Contenu généré avec Manuscrit… »)

---

## 5. SYSTÈME DE DESIGN DE L’APPLICATION

### Tokens (sources)

`frontend/src/styles/copilot.css` `:root` + `globals.css` :

| Token / usage | Valeur |
|---------------|--------|
| `--ink` | `#15202b` |
| `--slate` | `#5a6570` |
| `--brand` | `#1e4d63` |
| `--brand-deep` | `#163a4c` |
| `--brand-soft` | `#dde7ee` |
| `--progress` | `#b07a2e` |
| `--progress-soft` | `#f5ebd8` |
| `--progress-done` | `#1e4d63` |
| `--stone` | `#e7ebf0` |
| `--paper` / fond body | `#f3f5f7` |
| `--line` | `#cfd5db` |
| Texte body | `#1a2220` |
| Accent or / sidebar | `#c9953a`, `#b07a2e` |
| Erreur | `#9b3b32` |
| Titres | **Georgia**, serif (`h1`/`h2` / brand) |
| Corps | **Inter**, `"Segoe UI"`, Arial, sans-serif ; 14px |
| Rayons courants | 6–12px ; pills `999px` ; dialog 14px |
| Ombres | ex. `0 12px 32px rgba(18,32,40,.14)` ; header sticky légère |
| Espacements | padding wrap `30px 3.2%` ; gaps listes 8–18px |

`tailwind.config` : **absent**.

### Bibliothèque de composants

Maison (CSS + React). **Pas** shadcn / MUI / Chakra.

Réutilisable pour un planning :

| Besoin | Existant | Où |
|--------|----------|-----|
| Cartes | `.cp-card`, `.panel`, `.metric` | copilot.css / globals |
| Liste jalons type timeline | `.writing-schedule-list` | copilot.css + WritingPlanView |
| Tableau | `<table>` workspace ; tables DOCX topics | pas de DataTable React |
| Badges | `.pill`, `.badge-cp`, `.material-code-badge` | |
| Barres de progression | `.bar` / `.track`, `.topic-progress-bar` | globals / topics |
| Accordéon | `<details>` (notice, récap corpus) | pas de composant Accordion nommé |
| Timeline dédiée | **absent** | |

### Écran actuel du planning de rédaction

`frontend/src/components/copilot/WritingPlanView.tsx` :

- Barre contexte → toolbar (Plan rédaction / Planning / Regénérer)
- Articles par section du plan
- `<section className="writing-schedule">` → `<ol className="writing-schedule-list">` (jours, %, titre, advice)
- Gaps + références

Le **plan de travail** n’a pas d’écran équivalent : génération → fichier Word (`TopicResults`).

### Ton éditorial — 3 microcopies

1. « Suggestions méthodologiques uniquement : aucune décision automatisée à votre égard. » — `TopicNotice.tsx`
2. « Guide d’écriture ancré dans vos matériaux. … Ce n’est pas le texte final. » — `WritingPlanView.tsx`
3. « Jalons indicatifs selon le temps déclaré et les sections du plan. À adapter à votre rythme. » — `WritingPlanView.tsx`

Registre : vouvoiement, prudent, méthodologique, anti-substitution de l’auteur.

---

## 6. POINTS D’INTÉGRATION POUR UN NOUVEAU MODÈLE

### Branchement à moindre coût

1. **Calcul** : remplacer ou envelopper `buildWritingSchedule` dans `shared/research/writingSchedule.ts` (déjà partagé front/back).
2. **Injection API** : `withWritingSchedule` dans `backend/src/routes/research.ts` (+ éventuellement `simulateCorpusPlan`).
3. **UI** : section `.writing-schedule` dans `WritingPlanView.tsx` (et `projectPlanPayload` / boutons Planning dans `ResearchStudio.tsx`).
4. **Export** : branche `kind === "schedule"` de `buildCorpusPlanDocx.ts`.
5. **Plan de travail (topics)** : si le nouveau modèle doit aussi remplir le Word « Plan de travail », brancher dans `expandSection` (`schedule`) + consignes de `documentPromptBuilder.ts` / `PLAN_BASE` — chemin parallèle, ne pas confondre avec `writingSchedule`.

### Contraintes

| Contrainte | État |
|------------|------|
| SSR | CSR only — composants client OK |
| i18n | textes FR en dur ; tout nouveau libellé à écrire en français dans le code |
| a11y | patterns existants (`aria-label`, `role="status"`, focus-visible) à prolonger |
| Tests automatisés projet | **absent** (pas de suite app) |
| Quotas / auth | routes research/topics derrière `x-manuscrit-user` + quotas billing |
| Données planning | rester sur enums existants ou étendre `WRITING_TIME_OPTIONS` / questions + libellés |

### Défauts actuels du code de génération (liste)

1. `advice` des phases de rédaction : seconde phrase **identique** pour toutes les sections.
2. Duplication d’affichage jours (liste UI + texte `advice`).
3. Planning = jours relatifs 1…N ; **aucune** projection calendaire malgré `project.dates`.
4. Seuil `days < 7` → pas de planning (peu documenté côté UI cadrage : min option = 14 jours).
5. Poids basés sur **regex de titres** FR — fragile si l’IA renomme les sections.
6. Arrondis `round` + « reste » sur la dernière section : pourcentages peuvent ne pas sommer à 100 %.
7. L’IA corpus **ne connaît pas** le schedule ; incohérence possible titres IA ↔ poids.
8. Plan de travail : structure **non différenciée** par type de document (`PLAN_BASE` unique).
9. Simulation `research_project` : paragraphes `p2`–`p5` **clonés** dans chaque section.
10. Simulation `p2` : codes `deadline`/`weekly` bruts + risque de `..` si valeurs déjà ponctuées.
11. Deux systèmes de temps (`writingTime` vs `deadline_range`+`weekly_time`) **non unifiés**.
12. Plan de travail : pas de prévisualisation écran du tableau (Word only).
13. Export schedule : pas d’en-tête/pied Word, pas de tableau, pas de couleurs marque.
14. Fallback simulation topics si pas de clé IA : planning « générique » 5 lignes, peu personnalisé au-delà délai/rythme/topic.

---

## 7. ANNEXE — Exemple JSON passé au générateur de planning de rédaction

Objet réaliste aligné sur l’entrée de `buildWritingSchedule` / la sortie consommée par l’UI et `buildCorpusPlanDocx` (données fictives) :

```json
{
  "writingTime": "1_year",
  "writingTimeDays": 365,
  "writingTimeLabel": "1 an",
  "sections": [
    { "title": "Introduction et enjeux" },
    { "title": "Problématique, questions et hypothèses" },
    { "title": "Cadre théorique et état des lieux" },
    { "title": "Dispositif méthodologique" },
    { "title": "Analyses empiriques structurées" },
    { "title": "Discussion et conclusion" }
  ],
  "_exempleSortie": {
    "totalDays": 365,
    "label": "1 an",
    "items": [
      {
        "title": "Introduction et enjeux",
        "sectionIndex": 0,
        "dayStart": 1,
        "dayEnd": 37,
        "share": "10 %",
        "advice": "Rédiger « Introduction et enjeux » (jours 1–37). Avancez d’abord un brouillon ancré dans vos matériaux, puis densifiez les preuves."
      },
      {
        "title": "Relecture et ajustements",
        "dayStart": 300,
        "dayEnd": 365,
        "share": "18 %",
        "advice": "Relire le fil argumentatif, vérifier les citations, harmoniser le style et laisser une marge pour les retours d’encadrement."
      }
    ]
  },
  "_contexteProfilTopicsPourPlanDeTravail": {
    "answers": {
      "project_type": "m1",
      "discipline_main": "sociologie",
      "deadline_range": "6to12m",
      "weekly_time": "5to10",
      "expected_length": "medium",
      "topic_freedom": "free",
      "writing_language": "fr"
    },
    "topic": {
      "axis": "mastery",
      "title": "Pratiques numériques et sociabilité étudiante",
      "research_question": "Comment les étudiant·e·s articulent-ils usages numériques et liens sociaux sur le campus ?",
      "method": "Entretiens semi-directifs et observation",
      "field_or_corpus": "Campus universitaire, 12 entretiens",
      "feasibility": {
        "level": "medium",
        "risks": ["Accès limité en période d’examens"],
        "first_steps": ["Grille d’entretien", "Demande d’autorisation"]
      }
    }
  }
}
```

Les champs préfixés `_exempleSortie` / `_contexteProfilTopicsPourPlanDeTravail` illustrent la sortie et le profil parallèle topics ; ils ne sont pas des paramètres de `buildWritingSchedule`.
