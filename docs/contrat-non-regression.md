# Contrat de non-régression — pipeline corpus (Manuscrit)

Date : 2026-11-20.  
Référence pour tous les lots d’implémentation (Claude, unités, pipeline, multimédia, UI/RGPD).  
Sources : `docs/audit-ia.md`, `docs/audit-planning.md`, code observé (`backend/src/routes/research.ts`, `backend/src/services/research/engine.ts`, `shared/research/*`).

Ce document **interdit** toute régression observable. Les lots suivants n’ajoutent que des capacités ; ils ne retirent, ne renomment et n’affaiblissent rien de ce qui est listé ici.

---

## 1. Surface publique (exports, routes, types, fonctions)

| Règle | Détail |
|-------|--------|
| Suppressions / renommages | **Interdits** pour tout export, route HTTP, type ou fonction **publique** déjà présents. |
| Ajouts | **Autorisés** uniquement : nouveaux modules, nouveaux champs **optionnels**, nouvelles routes **additionnelles**. |
| Enums / codes stockés | Valeurs déjà persistées (workspace, cadrage, billing, `WRITING_TIME_OPTIONS`, `PHASE_ROLES`, types matériaux, etc.) **inchangées**. Nouvelles valeurs possibles uniquement si rétrocompatibles (anciens projets lisibles). |
| `materialText` / `usableMaterials` / `canRequestWritingPlan` / `writingStructureFor` / `buildWorkPlan` / `buildWritingSchedule` / `withWritingSchedule` / `simulateCorpusPlan` | Signatures et sémantique actuelles **conservées** ; extensions additive uniquement. |
| Client topics | `backend/src/services/llm/client.ts` (`chatCompletion`, OpenAI-compatible via `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY`) **continue de fonctionner** sans obligation de migrer vers Claude. |

---

## 2. `POST /api/research`

### 2.1 Entrées (inchangées)

Corps JSON accepté aujourd’hui — **mêmes champs, même sémantique** :

| Champ | Rôle |
|-------|------|
| `projectId` | Projet workspace |
| `mode` | `"design"` \| `"corpus"` |
| `consent` | Attestation analyse (obligatoire, vérité) |
| `simulate` | Aperçu sans IA / sans clé |
| `publicQuery` | Mots-clés Crossref (tronqué côté route) |
| `revisionFeedback` | Consigne de révision (min 12 car. si présent) |
| `previousPlan` | Résumé du plan précédent (≤ 12 sections) |

Auth, origine, prérequis projet (`canRequestWritingPlan`, fiches avec texte, etc.) : **inchangés**.

### 2.2 Réponse synchrone (forme minimale conservée)

Toute analyse qui aboutit immédiatement (chemin ≤ 120 000 caractères, cache, simulation) conserve au minimum :

```ts
{
  sections: Array<{
    title: string;
    advice: string;
    evidence: Array<{ id: string; quote: string; start: number; end: number }>;
    role?: string; // PhaseRole, optionnel
  }>;
  gaps: string[];
  references: Array<{ title: string; url: string; comparison?: unknown }>;
  fingerprint: string;
  version?: string;       // ENGINE_VERSION
  date?: string;          // ISO
  model?: string;
  simulated?: boolean;
  schedule?: { totalDays: number; label: string; items: unknown[] };
  workPlan?: { phases: unknown[]; /* … */ };
}
```

`withWritingSchedule` reste le point d’injection du planning déterministe (`schedule` / `workPlan`). Le calcul de `workPlan` / `schedule` **n’est pas délégué à l’IA**.

### 2.3 Ajouts autorisés (optionnels)

| Champ | Quand |
|-------|--------|
| `coverage?` | Preuve de couverture (pipeline) — absent = comportement « ancien projet / chemin unique ». |
| `jobId?` | Identifiant de tâche asynchrone (réponse 202) ou reprise. |
| `usage?` | Compteurs tokens / coûts (pipeline) — jamais de contenu texte. |

Aucun champ existant ne devient obligatoire pour les clients actuels.

### 2.4 Seuils et routage (lots 2+)

| Situation | Comportement contractuel |
|-----------|---------------------------|
| `brief + Σ materialText` ≤ **120 000** | Chemin actuel (`analyze` / simulation / cache) **inchangé**. |
| Au-delà + `RESEARCH_PIPELINE` **désactivé** (défaut) | Comportement actuel : **413** avec message de fractionnement. |
| Au-delà + `RESEARCH_PIPELINE` **activé** | Création de tâche + **202** `{ jobId }` (au lieu de 413). |
| Simulation / absence de clé IA (mode corpus) | Toujours disponible ; ne consomme pas de crédit. |

---

## 3. Preuves (`evidence`) et surbrillance

| Règle | Détail |
|-------|--------|
| Exactitude | `evidence.quote` est une **sous-chaîne exacte** de `materialText(m)` pour le matériau `evidence.id`. |
| Offsets | `start` / `end` valides : `0 ≤ start < end ≤ materialText(m).length` et `materialText(m).slice(start, end) === quote`. |
| UI | `SourcePassageDialog` (surbrillance par offsets ou repli `indexOf`) **reste intacte** — pas de changement de contrat d’entrée `reading`. |
| Pipeline | Citations issues d’unités : offsets **recalculés** dans `materialText` avant exposition ; quotes non vérifiables **retirées**. |
| Vérification | Réutiliser / prolonger `verifyEvidence` (engine) : mode corpus → **≥ 1 evidence par section**. |

---

## 4. Rôle de l’IA, consentements, simulation

| Règle | Détail |
|-------|--------|
| Rédaction | L’IA **organise** (plan, conseils méthodologiques, affectation) ; elle **ne rédige jamais** le manuscrit. |
| Consentements | Notice corpus (3 cases), attestation dépôt, `consent` POST : **inchangés ou renforcés**, jamais affaiblis. |
| Simulation | `simulate === true` **ou** absence de config IA (mode corpus) → `simulateCorpusPlan` ; flag `simulated: true`. |
| Lots 5+ | La simulation doit pouvoir émettre aussi unités / registre / `coverage` (heuristiques), sans casser le flag ni les gaps d’avertissement. |

---

## 5. Auth, quotas, billing

| Règle | Détail |
|-------|--------|
| Identité | Header `x-manuscrit-user` (prod : oauth2-proxy ; dev : `local-development`) — **inchangé**. |
| Quotas | 1 crédit = 1 analyse réservée (`reserveAnalysis`) ; cache hit et simulation **sans** crédit ; `releaseAnalysis` en échec — **inchangé** sauf mention explicite d’un lot. |
| Lot 5 (prévu) | Réservation à la **création de tâche** pipeline ; libération si échec / annulation ; plafond d’unités par forfait (constantes configurables). Hors de ce lot : ne pas modifier `quotas.ts` / billing. |
| Export | `POST /api/research/plan-docx` (`kind: "plan" \| "schedule"`) — **inchangé** en entrées / sorties. |

---

## 6. Anciens projets et stockage

| Règle | Détail |
|-------|--------|
| Projets sans unités ni registre | Comportement **identique** à aujourd’hui (chemin unique, `materialText`, gaps matériaux non cités). |
| Workspace | Clé `owners/{uid}/workspace` — schéma matériaux actuel conservé ; champs nouveaux **optionnels**. |
| Unités (lots 2+) | Stockage **hors** JSON workspace : `owners/{uid}/units/{materialId}` via `ObjectStore`. |
| Dual storage | **Postgres** (`manuscript_objects`) **et** **filesystem** (`MANUSCRIT_STORAGE=filesystem` / absence de `DATABASE_URL`) restent supportés pour tous les nouveaux objets (unités, jobs). |
| Locks / etag | Écritures conditionnelles et locks existants réutilisés pour les jobs ; pas d’abandon du modèle `ObjectStore`. |

---

## 7. Parcours sujets (hors pipeline corpus)

| Règle | Détail |
|-------|--------|
| Client | `backend/src/services/llm/client.ts` — OpenAI-compatible (`fetch` + `/chat/completions`). |
| Routes | `/api/topics/*` inchangées en contrat d’entrée/sortie. |
| Config | Tant que `AI_PROVIDER` est absent ou `openai-compatible`, le comportement topics actuel est préservé. L’introduction de Claude pour le corpus **ne casse pas** la génération de sujets / documents. |

---

## 8. Ce que les lots peuvent ajouter (rappel)

Sans violer les sections 1–7 :

1. Couche Claude (`callClaude`, batches) + variables d’environnement documentées.
2. Unités, jobs asynchrones, registre de couverture, routes `GET/POST …/research/jobs/:id`.
3. Pipeline multi-étapes + `coverage` + bump `ENGINE_VERSION`.
4. Tableaux structurés, vision images, PDF scannés page à page, statuts d’extraction visibles.
5. Estimation / progression UI, quotas unités, pseudonymisation optionnelle, mise à jour RGPD, simulation enrichie.

---

## 9. Vérification à chaque lot

Avant validation humaine :

1. Aucun export / route / type public existant renommé ou retiré (revue de diff).
2. `npm run build` **passe**.
3. Chemin ≤ 120 k car. + simulation sans clé : encore utilisables.
4. Preuves : quotes exactes + offsets cohérents avec `materialText`.
5. Liste des fichiers créés et modifiés jointe au compte-rendu du lot.

---

## Annexe — Fichiers sentinelles (ne pas casser)

| Rôle | Chemin |
|------|--------|
| Route analyse | `backend/src/routes/research.ts` |
| Moteur actuel | `backend/src/services/research/engine.ts` |
| Planning injecté | `withWritingSchedule` (même fichier route) |
| Texte matériau | `shared/research/project.ts` — `materialText` |
| Simulation | `shared/research/simulateCorpusPlan.ts` |
| Surbrillance | `frontend/src/components/copilot/SourcePassageDialog.tsx` |
| Client topics | `backend/src/services/llm/client.ts` |
| Quotas | `backend/src/services/billing/quotas.ts` |
| Store | `backend/src/storage/*` |
