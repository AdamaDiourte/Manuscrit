# Changelog — Génération des sujets

**Date :** 2026-11-20  
**Réf. diagnostic :** `docs/DIAGNOSTIC_GENERATION_SUJETS.md`

## Changements appliqués

### Lot 1 — Simulation et affichage
- `simulate` désactivé par défaut côté front ; case démo uniquement si `DEV && VITE_ALLOW_SIMULATION=true`.
- Back : `simulate` accepté seulement hors production avec `ALLOW_SIMULATION=true`.
- Plus de bascule silencieuse vers les gabarits si le LLM est absent → HTTP 503.
- Badge / méta-données séparés ; « Lire la suite » sur les blocs clampés ; étapes de chargement indicatives.
- Suppression de `research_topics.system.md` (obsolète).
- Titres simulés préfixés `[DÉMO]`.

### Lot 2 — Profil enrichi
- Profil LLM en libellés (pas de codes bruts) + `missing_fields`.
- Questions `interest_objects` et `field_access`.
- `profileCompleteness`, `timeBudget`, `projectLevelGuides`.
- Notice `2026-11-v2`.

### Lot 3 — Moteur sujets
- `callClaudeStructured` (tool use + cache system).
- Nouveau prompt système + schéma (research_object, profile_links, profile_analysis…).
- Contrôle qualité + un essai correctif ; jamais de retour aux gabarits.
- Régénération mono-sujet avec `rejectedTitles` dans le ticket.

### Lot 4 — Lectures vérifiées
- Clients OpenAlex / HAL ; `findReadings` ; `topic.readings` rempli en code uniquement.

### Lot 5 — Projet de recherche
- Document via outil structuré ; citations bornées aux lectures ; bibliographie DOCX ; contrôle charge planning.

### Lot 6 — Observabilité
- Logs métadonnées uniquement : `event`, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `attempts`, `violations`, `readings_count`, `personalization_level`.
