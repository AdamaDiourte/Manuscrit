# Pipeline IA corpus — documentation

Documentation d’exploitation du pipeline multi-unités (lots 0–5). Pas de tests automatisés ici.

Référence de non-régression : [`docs/contrat-non-regression.md`](./contrat-non-regression.md).

---

## 1. Schéma du pipeline

```
POST /api/research
        │
        ├─ simulate / pas de clé ──► simulateCorpusPlan (+ coverage / units)
        │
        ├─ ≤ 120 000 car. ─────────► chemin synchrone historique
        │                              engine.analyze → cache fingerprint
        │                              reserveAnalysis / releaseAnalysis (inchangé)
        │
        └─ > 120 k + RESEARCH_PIPELINE ─► 202 { jobId }
                 │
                 ▼
           worker (in-process)
                 │
                 ▼
    ┌────────────────────────────────────────────────────────────┐
    │  units → extract → synthesize → plan → assign → verify     │
    │  (temps réel ou Message Batches si anthropic + mode lot)   │
    └────────────────────────────────────────────────────────────┘
                 │
                 ▼
         résultat + coverage + withWritingSchedule
         GET /api/research/jobs/:id (poll 3 s)
         POST …/cancel
```

**Flux extraction (détail)**

1. **Découpage** (`buildUnits`) — texte auteur seul, puis unités vision en fin si transcription hydratée.
2. **Extract** (modèle *fast*) — une fiche par unité (cache `unit-cache/`) ; images/scans via vision ou `skipped` si `vision=false`.
3. **Synthesize** (*smart*) — carte de thèmes.
4. **Plan** (*smart*) — sections ≤ 12, `writingStructureFor(type)`.
5. **Assign** (*smart*) — fiches → sections ou « non utilisées ».
6. **Verify** — quotes sous-chaînes exactes de `materialText` ; `source: "transcription-ia"` si offset ≥ base ; `coverage.complete` si aucune unité failed/pending.

---

## 2. Rôle des fichiers

### Shared (pur / front+back)

| Fichier | Rôle |
|---------|------|
| `shared/research/project.ts` | `materialText` (vision **à la fin**), `materialTextBaseLength` |
| `shared/research/units.ts` | `buildUnits`, hash d’ids stables sur la base |
| `shared/research/unitLimits.ts` | Plafonds free 150 / plus 1 500 / pro 6 000 |
| `shared/research/estimateCorpus.ts` | Estimation locale (unités, pages scannées, durées) |
| `shared/research/pseudonymizeCorpus.ts` | Remplacement e-mails / tél. / noms → `[PERS_n]` |
| `shared/research/simulateCorpusPlan.ts` | Aperçu sans IA + `coverage` + `units` |
| `shared/research/workPlan.ts` / `writingSchedule.ts` | Planning déterministe (inchangé) |
| `shared/research/tableStats.ts` | Stats tableaux hors IA |

### Backend — Claude & route

| Fichier | Rôle |
|---------|------|
| `backend/src/services/llm/claude.ts` | Clients Anthropic / Bedrock / Vertex, `callClaude`, batches, `providerCapabilities` |
| `backend/src/services/llm/client.ts` | Topics OpenAI-compatible (inchangé) |
| `backend/src/routes/research.ts` | Sync ≤ 120 k ; async > 120 k ; jobs GET/cancel ; export Word |
| `backend/src/services/billing/quotas.ts` | `reserveAnalysis` / `releaseAnalysis` (sync + async) ; `assertUnitQuota` (async seulement) |
| `backend/src/services/research/engine.ts` | Analyse synchrone historique + `ENGINE_VERSION` |
| `backend/src/services/research/jobs.ts` | Persistance tâches / couverture / unités matériau |
| `backend/src/services/research/worker.ts` | File + reprise au démarrage ; release crédit failed/cancelled |
| `backend/src/services/research/purgeProject.ts` | Purge jobs / map / vision / unités à la suppression de projet |
| `backend/src/services/research/buildCorpusPlanDocx.ts` | Export Word (+ mention transcription) |
| `backend/src/routes/workspace.ts` | Workspace 8 Mo ; déclenche `purgeRemovedProjects` |

### Backend — pipeline

| Fichier | Rôle |
|---------|------|
| `pipeline/index.ts` | Orchestration, simulation async, fin de tâche |
| `pipeline/extract.ts` | Extraction temps réel / batch + skip vision |
| `pipeline/synthesize.ts` | Carte des thèmes |
| `pipeline/plan.ts` | Sections |
| `pipeline/assign.ts` | Affectation / unused |
| `pipeline/verify.ts` | Offsets, `transcription-ia`, gaps, `coverage.complete` |
| `pipeline/media.ts` | Contenu multimodal, resize, PDF ≤ 600 pages |
| `pipeline/persistVision.ts` | ObjectStore `owners/{uid}/vision/{materialId}` |
| `pipeline/pseudonym.ts` | Map `…/jobs/{jobId}/pseudonym-map` (jamais exposée) |
| `pipeline/cache.ts` | Cache fiches d’extraction |
| `pipeline/concurrency.ts` | Pool parallèle |
| `pipeline/types.ts` | Schémas Zod fiches / plans |
| `prompts/pipeline/*.ts` | Prompts FR (vouvoiement, pas d’invention) |

### Frontend

| Fichier | Rôle |
|---------|------|
| `ResearchStudio.tsx` | Estimation, confirmation, poll 3 s, annulation, reprise job |
| `WritingPlanView.tsx` | Bandeau couverture, unused, note transcription |
| `SourcePassageDialog.tsx` | Surbrillance + note transcription |
| `CorpusOrganizer.tsx` | Notice RGPD (unités / images) |
| `services/import/extractText.ts` | PDF scannés, plafond 600 pages |
| `services/import/resizeImage.ts` | Redimensionnement avant upload |

### ObjectStore (clés)

| Clé | Contenu |
|-----|---------|
| `owners/{uid}/workspace` | Projets (JSON ≤ 8 Mo) — **pas** les transcriptions vision |
| `owners/{uid}/files/{hash}` | Binaires attestés |
| `owners/{uid}/jobs/{jobId}` | Métadonnées tâche |
| `owners/{uid}/jobs/{jobId}/cards` | Fiches d’extraction |
| `owners/{uid}/jobs/{jobId}/pseudonym-map` | Table `[PERS_n]` → original |
| `owners/{uid}/units/{materialId}` | Unités persistées |
| `owners/{uid}/vision/{materialId}` | Transcriptions IA |
| `owners/{uid}/unit-cache/{hash}` | Cache extract |
| `owners/{uid}/research/{fingerprint}` | Cache résultat sync |
| `owners/{uid}/billing/usage/{YYYY-MM}` | Jetons d’analyse |

---

## 3. Variables d’environnement

| Nom | Rôle | Défaut |
|-----|------|--------|
| `AI_PROVIDER` | `anthropic` \| `bedrock` \| `vertex` \| `openai-compatible` (ou absent) | absent → comportement topics + sync OpenAI-compatible |
| `RESEARCH_PIPELINE` | Active les jobs async si corpus > 120 000 car. (`1`/`true`/`yes`/`on`) | désactivé → **413** comme avant |
| `AI_BASE_URL` | Endpoint Chat Completions (sujets + sync corpus) | — (requis pour sync IA) |
| `AI_MODEL` | Modèle OpenAI-compatible | — |
| `AI_API_KEY` | Clé Bearer OpenAI-compatible | — |
| `ANTHROPIC_API_KEY` | Clé API Anthropic direct | — (si `AI_PROVIDER=anthropic`) |
| `AI_MODEL_FAST` | Modèle Claude extraction / vision | `claude-haiku-5-5` |
| `AI_MODEL_SMART` | Modèle synthèse / plan / assign | `claude-sonnet-5-5` |
| `AI_CONCURRENCY` | Parallélisme extract temps réel | `4` |
| `AI_BATCH_THRESHOLD` | Seuil indicatif mode lot | `800` |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Région Bedrock (viser UE) | — |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | Credentials AWS (ou profil ADC) | — |
| `CLOUD_ML_REGION` | Région Vertex (viser UE) | — |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Projet GCP Vertex | — |
| `DATABASE_URL` | Postgres ObjectStore | absent → filesystem |
| `MANUSCRIT_STORAGE` | Forcer `filesystem` | auto si pas de `DATABASE_URL` |
| `MANUSCRIT_DATA_DIR` | Racine objets filesystem | `backend/.data/objects` (via module) |
| `PG_POOL_SIZE` | Pool Postgres | `8` |
| `APP_BASE_URL` | Origine CORS / app | `http://127.0.0.1:5173` |
| `PROFILE_ENCRYPTION_KEY` | Chiffrement profil sujets (étape D) | vide |
| `TOPICS_TICKET_SECRET` / `COOKIE_SECRET` | Auth session sujets | — |

Ne jamais committer de secrets (voir `.env.example`).

---

## 4. Activation pas à pas

1. Copier `.env.example` → `.env` (racine / backend selon votre déploiement).
2. **Chemin sync inchangé (optionnel)** : renseigner `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` pour sujets + corpus ≤ 120 k.
3. **Claude pipeline** :
   - `AI_PROVIDER=anthropic` **ou** `bedrock` **ou** `vertex`.
   - Anthropic : `ANTHROPIC_API_KEY=sk-…`
   - Bedrock : `AWS_REGION=eu-…` + credentials AWS.
   - Vertex : `CLOUD_ML_REGION=europe-…` + `ANTHROPIC_VERTEX_PROJECT_ID=…` + ADC / compte de service.
4. Modèles (optionnel) : `AI_MODEL_FAST`, `AI_MODEL_SMART`.
5. **Activer l’async** : `RESEARCH_PIPELINE=1`.
6. Redémarrer le backend (`npm run dev` / compose). Sans `RESEARCH_PIPELINE`, un corpus > 120 k reste en **413**.
7. Côté UI : estimation → confirmer → si job, barre de progression (poll 3 s) ; mode économique = Message Batches (**Anthropic seulement**).

---

## 5. Différences anthropic / bedrock / vertex

| | **anthropic** | **bedrock** | **vertex** |
|--|---------------|-------------|------------|
| Auth | `ANTHROPIC_API_KEY` | Chaîne AWS | ADC / service account + projet |
| Région de traitement | Selon contrat Anthropic / DPA | `AWS_REGION` (choisir UE) | `CLOUD_ML_REGION` (choisir UE) |
| Vision + PDF natif | oui | oui | oui |
| Prompt caching (`cache_control`) | oui | oui | oui |
| **Message Batches** (mode économique) | **oui** | **non** (`batch: false`) | **non** |
| Si lot demandé sans batch | rétrogradé temps réel | idem | idem |
| `openai-compatible` | hors Claude : `vision: false` → images `skipped` | | |

---

## 6. Pseudonymisation (rappel sécurité)

- **Clé** : `owners/{uid}/jobs/{jobId}/pseudonym-map`.
- Envoyé à l’IA : uniquement le texte déjà remplacé (`[PERS_n]`).
- **Jamais** dans `publicJobView`, logs, ni export Word (citations restaurées avant verify / affichage).
- **Suppression** : fin de tâche (`done` après restauration, `failed`, `cancelled`) ; purge projet via `purgeRemovedProjects` à l’enregistrement workspace ; un wipe de préfixe `owners/{uid}/` couvre la suppression de compte.

---

## 7. Facturation

| Chemin | Crédit analyse (`reserveAnalysis`) | Plafond unités (`assertUnitQuota`) |
|--------|--------------------------------------|-------------------------------------|
| Sync ≤ 120 k | Oui — même logique qu’avant (réserve → succès consomme ; erreur → `releaseAnalysis`) | Non |
| Async pipeline | Oui à la création du job ; **jamais** `release` si `done` ; `release` si `failed` / `cancelled` | Oui (free 150 / plus 1 500 / pro 6 000) |

`quotas.ts` : seules additions = import `unitLimitForPlan` + `assertUnitQuota`. `reserveAnalysis` / `releaseAnalysis` **inchangés**.

---

## 8. Checklist — phase de tests globale

À vérifier manuellement (pas de suite automatisée livrée avec ces lots) :

1. **Couverture 100 %** — registre `coverage.complete === true` ; bandeau « N / N — couverture complète ».
2. **Citations exactes** — chaque `evidence.quote` est sous-chaîne de `materialText` ; offsets `start`/`end` cohérents.
3. **Surbrillance** — `SourcePassageDialog` sélectionne le bon passage.
4. **Transcriptions signalées** — `source: "transcription-ia"` à l’écran + Word (« Transcription automatique — à vérifier sur l’original »).
5. **Facturation** — 1 crédit consommé si `done` ; libéré si échec / annulation ; sync ≤ 120 k inchangé ; refus si unités > plafond forfait.
6. **Annulation** — `POST …/cancel` arrête la tâche, libère le crédit, efface la map.
7. **Reprise après redémarrage** — jobs `queued` / `running` / `waiting_batch` repris par le worker ; poll UI via `sessionStorage` job id.
8. **Anciens projets** — plan sans `coverage` affichable ; offsets encore valides ; sync ≤ 120 k + simulation sans clé.
9. **Mode filesystem** — `MANUSCRIT_STORAGE=filesystem` (ou sans `DATABASE_URL`) : jobs, vision, map, units OK.
10. **Export Word** — sections, notes transcription, **pas** de table de pseudonymisation.
11. **Planning** — nombre de phases / pages du planning (`workPlan` / `writingSchedule`) identique au comportement déterministe d’avant (injection `withWritingSchedule` inchangée).
12. **Vision off** — `AI_PROVIDER=openai-compatible` ou capacités sans vision : images `skipped` sans planter l’analyse.
13. **PDF scannés** — refus > 600 pages à l’import ; pages comptées dans l’estimation.
14. **Workspace 8 Mo** — transcriptions absentes du JSON ; flag `visionStored` seulement.

---

## 9. Fichiers de référence rapide

- Contrat : `docs/contrat-non-regression.md`
- RGPD sous-traitants : `docs/rgpd/sous-traitants.md`
- Template env : `.env.example`
