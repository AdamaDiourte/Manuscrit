# Audit lecture seule — moteur IA / corpus hétérogène (Manuscrit)

Date : 2026-11-20. Aucun fichier applicatif modifié hors ce rapport.

Objectif : documenter l’existant pour préparer une refonte capable d’analyser **intégralement** des volumes importants de matériaux hétérogènes, sans surcharge ni troncature silencieuse.

---

## 1. IMPORT DES MATÉRIAUX

### 1.1 Types acceptés

| Couche | Formats | Source |
|--------|---------|--------|
| UI (input `accept`) | `.pdf,.doc,.docx,.txt,.md,.csv,.tsv,.xlsx,.png,.jpg,.jpeg,.webp,.gif` | `frontend/src/pages/Workspace.tsx` (l. ~1265, ~1325) |
| Extraction automatique | `.txt,.md,.csv,.tsv,.pdf,.docx,.xlsx` uniquement | `frontend/src/services/import/extractText.ts` — `fileAccept` |
| Back (upload binaire) | Tout corps ≤ 20 Mo (pas de filtre MIME serveur) | `backend/src/routes/workspace.ts` — `limitedBody(req, 20 * 1024 * 1024)` |

**Écart UI ↔ extracteur** : `.doc` et images sont proposés dans l’UI ; `extractText` les refuse (`Format sans extraction…`). L’upload binaire réussit quand même ; `extracted` reste `""` (catch silencieux dans `uploadAttachedFile`).

### 1.2 Bibliothèques d’extraction

| Type | Lib / mécanisme | Emplacement |
|------|-----------------|-------------|
| PDF | **PDF.js 5.6.205** (vendor local, commentaire l. 105) — `getDocument` + `streamTextContent` | `frontend/src/services/import/extractText.ts` ; assets `frontend/public/vendor/pdfjs/` |
| DOCX | Parse ZIP maison (`OfficeArchive`) + DOM XML (`word/document.xml`) — **pas** mammoth | `officeArchive.ts` + `extractWord` |
| XLSX | Même archive ZIP + `xl/workbook.xml` / feuilles / `sharedStrings` — **pas** SheetJS | `extractWorkbook` |
| TXT/MD/CSV/TSV | `TextDecoder` UTF-8 / UTF-16 | `extractText` |
| Images | **absent** (OCR / vision) | — |
| Audio | **absent** | — |
| Back extraction | **absent** (tout le parsing est côté navigateur) | — |

**mammoth** : absent des `package.json` (front et back).

### 1.3 Traitement par type

| Type | Comportement actuel |
|------|---------------------|
| Texte (txt/md/csv/tsv) | Décodage intégral → string ; CSV/TSV = texte brut (pas de schéma colonnes) |
| PDF texte | Pages 1…N ; préfixe littéral `[Page N]\n` + texte ; pages vides → `[Aucun texte extractible sur cette page]` ; max **600** pages ; timeout destroy **60_000** ms |
| PDF scanné | Erreur explicite si aucun texte extractible (« Fournissez une transcription ou un PDF avec reconnaissance de caractères ») — **pas d’OCR** |
| Word (.docx) | Concaténation des paragraphes (`\n`) ; onglets/sauts gérés |
| Word (.doc) | Accepté UI ; extraction = échec → `extracted=""` |
| Excel (.xlsx) | **Aplatissement texte** : `Feuille « … »` puis lignes `A1 = valeur` (tab-séparées) ; formules `=… [valeur enregistrée : …]` ; **pas** de structure colonnes/types pour l’IA |
| Images | Upload OK ; si pas de texte extrait → observation manuelle **obligatoire** (`Workspace.tsx` l. ~377–400) |
| Graphiques | Type métier legacy `Graphique` encore préfixé `FIG` dans `materialCode` ; entrée catalogue actuelle = plutôt `Autres` / fichiers image — **pas** de parsing de graphiques |
| Cartes / SIG | Type fiche `Cartes / SIG` (`MATERIAL_ENTRIES`) ; contenu = fichier + texte/observation comme les autres |
| Audio | **absent** |

### 1.4 Limites

| Limite | Valeur exacte | Fichier |
|--------|---------------|---------|
| Taille max fichier (front) | `20 * 1024 * 1024` (20 Mo) | `limits.ts` `MAX_FILE_BYTES` ; `Workspace.tsx` |
| Taille max upload (back) | `20 * 1024 * 1024` | `workspace.ts` |
| Texte extrait max / document | `180_000` caractères | `limits.ts` `MAX_TEXT` |
| Archive Office décompressée | `MAX_XML_BYTES = 6 * 1024 * 1024` ; `MAX_TOTAL_BYTES = 16 * 1024 * 1024` | `officeArchive.ts` |
| PDF pages max | `600` | `extractText.ts` |
| Nombre max de fichiers (UI) | **absent** (pas de plafond « N matériaux ») | — |
| Capacité dépôt compte | ≤ **500** fichiers **ou** somme tailles > **512 * 1024 * 1024** (512 Mo) | `workspace.ts` `upload-capacity` |
| Corps `/api/research` Express | `express.raw({ limit: "256kb" })` | `server.ts` l. 23 — le POST n’embarque **pas** les matériaux (seulement `projectId`, `mode`, `consent`…) |
| Corps workspace JSON | `limitedBody(req, 8 * 1024 * 1024)` | `workspace.ts` |
| Reverse proxy Caddy | `request_body { max_size 22MiB }` | `deploy/ovh/Caddyfile` |
| Corpus par analyse IA | `brief.length + Σ text.length > 120000` → HTTP **413** | `research.ts` l. 216–226 |
| Payload `analyze` | `JSON.stringify(input).length > 120000` → erreur | `engine.ts` l. 233–236 |

**multer** : absent.

### 1.5 Stockage du contenu extrait

| Élément | Détail |
|---------|--------|
| Object store | Interface `ObjectStore` (`backend/src/storage/types.ts`) |
| Postgres | Table `manuscript_objects(key, etag, content bytea, metadata jsonb, updated_at)` — `backend/db/001_initial.sql` |
| Fichier local | `backend/.data/objects/` (ou `MANUSCRIT_DATA_DIR`) si `MANUSCRIT_STORAGE=filesystem` ou pas de `DATABASE_URL` — `filesystem.mjs` |
| Workspace | Clé `owners/{uid}/workspace` — JSON projets + matériaux |
| Binaires | Clé `owners/{uid}/files/{sha256}` — métadonnée `name`, `attestedAt` |
| Texte pour l’IA | **Dans le JSON workspace** : champs `extracted`, `toolExtracted`, `observation`, `text`, `extra` — **pas** de table d’unités / chunks |

**Schéma effectif d’un matériau** (champs observés à l’écriture / lecture) :

```ts
{
  id, title, toolType, type,
  observation?, text?,
  extracted?, toolExtracted?,
  file?, filename?, toolFile?, toolFilename?,
  toolUnavailable?, extra?, attestedAt?,
  // + champs éventuels legacy
}
```

Concaténation pour l’IA (`shared/research/project.ts` — `materialText`) :

```64:76:shared/research/project.ts
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
```

| Capacité | Présent ? |
|----------|-----------|
| Découpage (chunks / unités) | **absent** |
| Pagination structurée (hors marqueurs `[Page N]` dans la string PDF) | **absent** |
| Provenance cellule Excel | Partielle dans le **texte** (`A1 = …`), pas d’objet `{sheet,cell}` |
| Provenance page PDF | Préfixe textuel `[Page N]`, pas d’offsets structurés stockés |
| OCR / description d’image | **absent** (observation humaine) |
| Tableaux structurés (colonnes, types) | **absent** (aplatis en texte) |

---

## 2. MOTEUR IA ACTUEL

Fichiers centraux : `backend/src/services/research/engine.ts`, `backend/src/routes/research.ts`, client topics `backend/src/services/llm/client.ts` (parcours sujets — distinct).

### 2.1 Fournisseur, SDK, modèle, paramètres

| Paramètre | Valeur |
|-----------|--------|
| Fournisseur | Configurable via `AI_BASE_URL` + `AI_MODEL` + `AI_API_KEY` (Chat Completions compatible OpenAI) |
| SDK | **absent** — `fetch` natif |
| Endpoint | `{AI_BASE_URL}/chat/completions` (HTTPS obligatoire hors dev pour `llm/client` ; HTTPS strict dans `engine.analyze`) |
| Modèle | `env.AI_MODEL` (aucune valeur par défaut dans le code) |
| Température (plan corpus) | `0` | `engine.ts` l. 268 |
| `max_tokens` | `4500` | l. 269 |
| `response_format: json_object` | **absent** dans `engine.ts` (présent seulement dans `llm/client.ts` pour topics) |
| Gestion clé | Lecture `env.AI_API_KEY` ; header `Authorization: Bearer …` ; jamais loggée (`llm/client.ts` commentaire « Never log… ») |
| Version moteur | `ENGINE_VERSION = "research-2026-03-corpus-plan-v4"` | `engine.ts` l. 7 |

### 2.2 Transmission des matériaux à l’IA

Flux `POST /api/research` (`research.ts`) :

1. Charge le workspace → projet → matériaux non exclus (`draft.excluded`).
2. Mappe chaque fiche en `{ id, type, title, code, text: materialText(m) }`.
3. Construit `brief` via `buildCorpusBrief` (cadrage **sans** texte des matériaux).
4. Envoie **tout** le tableau `sources` au modèle dans un seul message user `JSON.stringify({ brief, format, writingStructure, materials, catalogue, … })`.

**Pas de** : sélection par similarité, résumé préalable, découpage multi-pass, registre de couverture.

#### Troncatures / plafonds (liste exhaustive relevée)

| Lieu | Coupe / limite | Ce qui est perdu au-delà |
|------|----------------|---------------------------|
| `extractText` / `MAX_TEXT` | 180 000 car. / fichier | Document rejeté (erreur) — pas de coupe silencieuse |
| `research.ts` | Σ textes + brief > **120 000** | Analyse refusée (413) — matériaux non envoyés |
| `engine.ts` | `JSON.stringify(input) > 120000` | Idem (erreur) |
| `research.ts` | `revisionFeedback` → `.slice(0, 1200)` | Suite de la consigne |
| `research.ts` | `previousPlan` → max **12** sections ; `advice` → **600** car. | Sections / conseils restants |
| `research.ts` | `publicQuery` → `.slice(0, 180)` | Mots-clés Crossref |
| `engine.ts` | `publicQuery` max **200** | Erreur si dépassé |
| Crossref abstract | `.slice(0, 4200)` | Fin du résumé catalogue |
| Titre Crossref | `.slice(0, 800)` | Fin du titre |
| `simulateCorpusPlan` | citation max **220** + suffixe `"…"` | Reste du matériau (simulation seulement) |
| `simulateCorpusPlan` | brief hint **120** ; revision affichée **180** | Affichage simulé |
| Sortie modèle | `max_tokens: 4500` ; si `finish_reason !== "stop"` → `invalid()` | Plan entier rejeté (pas de partial accepté) |
| Validation sortie | `quote` ≤ 1800 ; `title` ≤ 220 ; `advice` ≤ 4000 ; ≤ 12 sections ; ≤ 24 evidence / section | JSON hors bornes → échec |
| Export Word | citations affichées coupées à ~120 car. + `…` | Affichage export seulement (`buildCorpusPlanDocx.ts`) |
| UI `planDisplay.shortPhaseTitle` | max 40 + `…` | Affichage seulement |

**Pas de troncature silencieuse du corpus vers le modèle** : si trop gros, refus explicite. En revanche, tout ce qui dépasse 120 k car. n’est **jamais analysé** (goulot principal).

### 2.3 Appels, parallélisme, durées, erreurs

| Aspect | Comportement |
|--------|--------------|
| Appels / plan corpus | 0–1 Crossref (`findReferences`) puis **1** `chat/completions` |
| Parallélisme | **absent** (séquentiel) |
| Timeout Crossref | `AbortSignal.timeout(8000)` |
| Timeout IA | `AbortSignal.timeout(90000)` (90 s) |
| Retry IA (engine) | **absent** |
| Retry topics | 1 retry si JSON/schéma invalide (`generate.ts` l. 86–88) |
| Erreurs HTTP fournisseur | 429 → message saturé ; sinon « n’a pas pu réaliser l’analyse » |
| Lock anti-doublon | objet `{fingerprint}.lock` ; fenêtre **15 min** ; HTTP 409 |
| Timeout Express / proxy | **absent** (Caddyfile sans `transport` timeout) — durée typique bornée par les 90 s client `fetch` |
| Durée typique | **absent** (pas de métrique dans le code) |

### 2.4 Tokens, cache, incrémental, streaming

| Capacité | État |
|----------|------|
| Comptage tokens (plan corpus) | **absent** (`engine` n’utilise pas `usage`) |
| Comptage tokens (topics) | `result.usage?.total_tokens` via `llm/client.ts` |
| Cache résultat | Oui : SHA-256(`ENGINE_VERSION`, `AI_MODEL`, `AI_BASE_URL`, `input`) → `owners/…/research/{fingerprint}` |
| Traitement incrémental | **absent** |
| Streaming progression front | **absent** (réponse JSON unique) |

### 2.5 Validation de sortie

| Parcours | Mécanisme |
|----------|-----------|
| Plan corpus (`engine.ts`) | Parse JSON manuel + validateurs maison (`record` / `string` / `list`) — **pas Zod** |
| Citations | `source.text.indexOf(quote)` ; quote ≥ 3 car. ; échec → `invalid()` |
| Mode corpus | Chaque section doit avoir ≥ 1 evidence ; matériaux non cités → entrées `gaps` |
| JSON invalide / finish non-stop | Exception → route catch → HTTP 502 + message ; **release** du quota si réservé |
| Topics / documents | Zod (`validateOutput.ts`, `validateDocument.ts`) |

---

## 3. INFRASTRUCTURE DISPONIBLE

### 3.1 Postgres

| Item | Valeur |
|------|--------|
| Image | `postgres:16-bookworm` (`compose.dev.yaml`, `deploy/ovh/compose.yaml`) |
| Extensions installées | **absent** du SQL initial (aucune `CREATE EXTENSION`) |
| pgvector | **absent** |
| Usage actuel | Store clé-valeur `manuscript_objects` (workspace, fichiers, cache research, billing, locks) |
| Pool | `PG_POOL_SIZE` défaut **8** ; timeouts connexion 8 s / idle 30 s |

### 3.2 Mode fichier local (`.data`)

- Déclenché si `MANUSCRIT_STORAGE=filesystem` **ou** absence de `DATABASE_URL`.
- Fichiers `sha256(key).bin` + `.json` meta sous `backend/.data/objects/`.
- Contraintes : mono-instance, pas d’arbitrage multi-réplicas comme Postgres ; adapté au dev.

### 3.3 Tâches / file d’attente

| Item | État |
|------|------|
| Queue (Bull, pg-boss, etc.) | **absent** |
| Worker séparé | **absent** (tout dans le process Express) |
| Piste sans nouvelle infra | Table jobs dans `manuscript_objects` (ou SQL dédié) + worker dans le même process / second container `application` partageant Postgres — commenté comme possible dans `billing/storage.ts` (« independent workers ») via écritures conditionnelles `etag` |

### 3.4 Déploiement

| Item | Valeur / source |
|------|-----------------|
| Hébergeur cible | OVHcloud VPS/instance (`deploy/ovh/README.md`) |
| Stack | Caddy 2.10 → oauth2-proxy → Node app → Postgres 16 |
| Dockerfile | `node:24-bookworm-slim` ; `USER node` ; CMD `backend/dist/server.js` |
| Mémoire / CPU réservés | **absent** (pas de `deploy.resources` ni chiffres dans le README) |
| Worker séparé | Possible en ajoutant un service Compose pointant la même image/base — **non prévu** aujourd’hui |
| Timeout HTTP reverse proxy | **absent** dans `Caddyfile` (défauts Caddy) |
| Body max edge | **22 MiB** |

### 3.5 Embeddings / recherche sémantique

**absent** (pas d’API embeddings, pas de pgvector, pas d’index sémantique).

---

## 4. QUOTAS, COÛTS, BILLING

### 4.1 Quotas actuels

| Plan | Analyses / mois | Source |
|------|-----------------|--------|
| free | **1** | `quotas.ts` `limits` |
| plus | **20** | idem |
| pro | **60** | idem |

- Identité : header `x-manuscrit-user` (prod : oauth2-proxy → Caddy ; dev : forcé `local-development`).
- Comptage : **1 crédit = 1 analyse réussie réservée** (`reserveAnalysis` avant `analyze`) — **par génération**, indépendant du volume de caractères / tokens.
- Cache hit / simulation : **ne consomment pas** de crédit (simulation avant réserve ; cache avant `reserveAnalysis`).
- Échec après réserve : `releaseAnalysis` dans le `catch`.
- Affichage : `Subscriptions.tsx` — « N / limit analyses utilisées ce mois-ci ».

### 4.2 Estimation de coût avant appel IA

**absent**.

---

## 5. DONNÉES PERSONNELLES (RGPD)

### 5.1 Ce qui part chez le fournisseur IA (plan corpus)

Payload user = JSON contenant notamment :

- `brief` (cadrage auteur),
- `format`,
- `writingStructure`,
- **`materials` = textes complets des fiches** (`observation`, `text`, `extracted`, `toolExtracted`, `extra`) — donc **contenu brut des entretiens / notes** s’ils ont été déposés ainsi,
- `catalogue` Crossref (si mots-clés),
- `revisionFeedback` / `previousPlan`.

**Pseudonymisation automatique du corpus avant envoi** : **absent** (contrairement au module sujets : `buildPseudonymizedProfile`).

### 5.2 Région / non-rétention

| Item | État |
|------|------|
| Région d’hébergement IA configurée dans le code | **absent** (dépend de `AI_BASE_URL` choisi à l’exploit) |
| Option zero-retention codée | **absent** |
| Doc sous-traitants (topics) | `docs/rgpd/sous-traitants.md` — recommandation UE / DPA / non-entraînement ; à mettre à jour selon fournisseur |

### 5.3 Journalisation contenus serveur

- `engine` / `llm/client` : consignes de **ne pas** logger prompts/completions.
- Route research : **pas** de `console.info` métier.
- Route topics : logs techniques uniquement (`event`, `uidPseudo` 8 car., `tokens`, `model`) — « never log answers or prompts ».
- Commentaire `server.ts` : bodies raw « never logged ».

### 5.4 Avertissements / consentement utilisateur

| Contrôle | Présent |
|----------|---------|
| Étape notice corpus (3 cases) | Oui — `CorpusOrganizer.tsx` (`corpusNoticeAccepted`, `corpusAiAccepted`, `corpusPrivacyAccepted`) |
| Attestation dépôt | Oui — `Attestation.tsx` |
| Attestation analyse (`consent` POST) | Oui — `ResearchStudio` + `Attestation analysis` |
| Pseudonymisation **technique** du corpus | **absent** — charge à l’utilisateur (« anonymes ou pseudonymisés ») |
| Notice topics (`NOTICE_VERSION`) | Distincte — `shared/research/notice.ts` |

---

## 6. MODE SIMULATION

Fichier : `shared/research/simulateCorpusPlan.ts` — fonction `simulateCorpusPlan`.

### 6.1 Sélection des extraits aujourd’hui

1. Filtre les sources avec `text` non vide.
2. Pour chaque étape de `writingStructure` (ou structure par défaut 4 phases) : prend `sources[i % sources.length]`.
3. `pickQuoteSpan(text, max=220, preferOffset)` : fenêtre ≤ 220 car., coupée sur `. ` / `\n` / espace, suffixe `"…"` si tronqué ; `preferOffset = used * 260 + i * 48` pour décaler les fenêtres.
4. Produit `advice` gabarit (aperçu / révision) + `evidence` avec `start`/`end`.
5. Calcule `workPlan` / `schedule` déterministes (`buildWorkPlan` / `buildWritingSchedule`).
6. `gaps` : message « aperçu simulé » ; `model: "simulation"` ; `simulated: true`.

Déclenchement (`research.ts`) : `simulate === true` **ou** absence de `AI_MODEL` / `AI_BASE_URL` / `AI_API_KEY` en mode corpus.

### 6.2 Pour imiter un futur pipeline exhaustif

La simulation devrait, à terme, reproduire les **mêmes étapes et artefacts** que le pipeline cible (même si les « analyses » restent heuristiques) :

| Étape future | Ce que `simulateCorpusPlan` devrait produire |
|--------------|-----------------------------------------------|
| Ingestion / extraction unité | Liste d’unités (page, feuille, passage) avec ids stables |
| Registre de couverture | % / compteurs par matériau (aujourd’hui : 1 extrait court / phase, rotation round-robin) |
| Synthèse | Résumés factices bornés par unité, sans inventer hors texte |
| Planification | Réutiliser `writingStructure` + `buildWorkPlan` (déjà le cas) |
| Affectation | Lier chaque section à des **ids d’unités** (pas seulement un matériau) |
| Vérification | Offsets `start`/`end` toujours dérivés du texte réel (déjà le cas pour les quotes) |

Sans cela, la simulation reste un **échantillon** (≤ 220 car. × N phases) et ne détecte ni les trous de couverture ni les volumes rejetés à 120 k.

---

## 7. SYNTHÈSE

### 7.1 Goulots d’étranglement (analyse exhaustive)

| # | Goulot | Fichier (indicatif) | Effet |
|---|--------|---------------------|-------|
| 1 | Plafond **120 000** car. brief+corpus / analyse | `research.ts` ~216 ; `engine.ts` ~233 | Refus explicite — pas d’analyse intégrale multi-centaines de pages |
| 2 | Un seul appel LLM, contexte unique | `engine.ts` `analyze` | Pas de map-reduce / multi-pass |
| 3 | Pas de chunks / registre de couverture | stockage matériaux + `materialText` | Impossible de prouver « tout a été lu » |
| 4 | OCR / vision / audio absents | `extractText.ts` ; UI images | Scans, photos, graphiques, cartes non textuelles = observation manuelle ou rejet |
| 5 | Tableurs aplatis | `extractWorkbook` | Perte de structure colonnes/types |
| 6 | Timeout 90 s + `max_tokens` 4500 | `engine.ts` | Gros plans ou contextes longs → risque `finish_reason` ≠ stop → rejet total |
| 7 | Corps Express research 256 kb (métadonnées) OK, mais workspace JSON **8 Mo** | `server.ts` ; `workspace.ts` | Corpus très riche en texte dans le workspace peut devenir lourd à sauver / recharger |
| 8 | Quota **par génération** non lié au volume | `quotas.ts` | Incite à fractionner manuellement sans pipeline |
| 9 | Pas de queue / job long | infra | Analyse synchrone HTTP — inadaptée à un pipeline multi-étapes long |
| 10 | Pas d’embeddings | — | Pas de retrieval ciblé pour réduire le contexte sans perte de couverture |

### 7.2 Volume maximal traitable aujourd’hui sans perte (estimation argumentée)

**Sans perte côté analyse IA** = tout le texte utile tient sous le plafond unique d’analyse **et** chaque fichier sous les plafonds d’extraction.

| Borne | Estimation |
|-------|------------|
| Par fichier extractible | min(20 Mo binaire, **180 000** car. texte) |
| Par requête d’analyse | **≤ 120 000** caractères pour `brief + Σ materialText` (et pour `JSON.stringify(input)`) |
| Ordre de grandeur | ~120 k car. FR ≈ **30–40 k tokens** d’entrée (ordre de grandeur ; **pas** de compteur dans le code) |
| Sortie | ≤ **4500** tokens de complétion |
| Si N fichiers | La somme des textes retenus doit rester ≤ 120 k — ex. 4×30 k car. OK ; 10×20 k car. **refusé** |
| Binaires stockés | Jusqu’à 500 fichiers / 512 Mo par compte, **mais** l’IA n’en voit que le texte agrégé ≤ 120 k |

Conclusion : le plafond opérationnel pour une analyse « sans rejet » est **~120 000 caractères de corpus+cadrage par génération**, pas la capacité de stockage.

### 7.3 Points d’intégration pour un pipeline en étapes

Pipeline cible : **ingestion → extraction unité → registre de couverture → synthèse → planification → affectation → vérification**, en respectant le **contrat de non-régression** observable aujourd’hui (document nommé « étape 0 » : **absent** dans `docs/` ; contrat déduit du code / de `audit-planning.md`) :

**Contrat de non-régression (déduit)**

1. `POST /api/research` conserve `mode`, `consent`, simulation, cache `ENGINE_VERSION`, quotas, shape `{ sections, gaps, references, schedule?, workPlan?, fingerprint, … }`.
2. `withWritingSchedule` reste le point d’injection du planning déterministe (`research.ts`).
3. Chaque `evidence.quote` reste une sous-chaîne exacte du texte source (offsets `start`/`end`).
4. L’IA ne rédige pas le manuscrit (prompts `common` / `instructions.corpus`).
5. Consentements / attestations inchangés ou renforcés, jamais affaiblis.
6. Simulation reste disponible sans clé IA.

**Points d’accroche concrets**

| Étape pipeline | Point d’intégration | Ne pas casser |
|----------------|---------------------|---------------|
| Ingestion | `Workspace.uploadAttachedFile` + `workspace?upload=1` | Limites 20 Mo / attestation / `files/{hash}` |
| Extraction unité | Étendre `extractText.ts` (et éventuellement worker back) ; stocker unités à côté de `extracted` | `materialText` / `usableMaterials` pour les anciens projets |
| Registre couverture | Nouvelle structure dans workspace ou objets `owners/…/coverage/…` | Réponse plan actuelle si registre absent |
| Synthèse | Remplacer le corps de `analyze` par multi-appels via `llm/client.ts` (ou nouveau service) | Validation evidence + `ENGINE_VERSION` (bump cache) |
| Planification | Garder `writingStructureFor` + sortie `sections` ; `withWritingSchedule` / `buildWorkPlan` | UI `WritingPlanView` / export docx |
| Affectation | Enrichir `evidence` (ids d’unités) de façon additive | Surbrillance `SourcePassageDialog` basée sur offsets texte |
| Vérification | Réutiliser `verifyEvidence` ; étendre aux unités | Rejet si citation non trouvée |
| Simulation | Élargir `simulateCorpusPlan` pour émettre registre + unités factices | Flag `simulated: true` / gaps d’avertissement |
| Jobs longs | Lock actuel `{key}.lock` + éventuelle table jobs Postgres | Timeout HTTP : préférer job async + polling plutôt que > 90 s sync |

---

## Annexe — Fichiers clés

| Rôle | Chemin |
|------|--------|
| Extraction | `frontend/src/services/import/{extractText,limits,officeArchive}.ts` |
| Dépôt UI | `frontend/src/pages/Workspace.tsx` |
| Parcours corpus | `frontend/src/components/copilot/{CorpusOrganizer,ResearchStudio,Attestation}.tsx` |
| Route analyse | `backend/src/routes/research.ts` |
| Moteur | `backend/src/services/research/engine.ts` |
| Client LLM topics | `backend/src/services/llm/client.ts` |
| Quotas | `backend/src/services/billing/quotas.ts` |
| Stockage | `backend/src/storage/{index.ts,postgres.mjs,filesystem.mjs}` |
| Schéma SQL | `backend/db/001_initial.sql` |
| Deploy | `deploy/ovh/{compose.yaml,Caddyfile,Dockerfile,README.md}` |
| Simulation | `shared/research/simulateCorpusPlan.ts` |
| Texte matériau | `shared/research/project.ts` |
| RGPD topics | `docs/rgpd/*` |
