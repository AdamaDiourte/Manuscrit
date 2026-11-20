# Sous-traitants — modules Sujets & Corpus

| Sous-traitant | Rôle | Localisation | Garanties |
| --- | --- | --- | --- |
| Fournisseur LLM OpenAI-compatible (`AI_BASE_URL` / `AI_MODEL`) | Génération des sujets à partir d’un profil pseudonymisé | Selon configuration (privilégier hébergement UE) | DPA art. 28 ; **pas d’entraînement** sur les données client ; rétention minimale / zero data retention si disponible ; transferts hors UE encadrés (DPF / CCT) |
| Anthropic (`AI_PROVIDER=anthropic`) | Analyse corpus par unités (texte, tableaux, images / PDF scannés) ; Message Batches si mode économique | Selon contrat Anthropic (région de traitement documentée dans le DPA) | DPA art. 28 ; pas d’entraînement sur les données client ; conservation limitée à la durée du traitement ; clé API côté serveur uniquement |
| Amazon Bedrock — Claude (`AI_PROVIDER=bedrock`) | Même analyse corpus via modèles Claude hébergés AWS | Région AWS configurée (`AWS_REGION`) — viser UE | DPA AWS + art. 28 ; contrôles région ; pas d’entraînement sur le contenu client |
| Google Vertex AI — Claude (`AI_PROVIDER=vertex`) | Même analyse corpus via Claude sur Vertex | Région `CLOUD_ML_REGION` — viser UE | DPA Google Cloud + art. 28 ; contrôles région ; pas d’entraînement sur le contenu client |
| Hébergeur PostgreSQL / infrastructure (OVH ou autre) | Stockage applicatif (workspace, jobs, transcriptions vision hors JSON) | UE (cible) | Mesures art. 32 ; accès restreint |

Mettre à jour ce tableau dès qu’un fournisseur est choisi en production. Les clés API restent exclusivement côté serveur.

**Conservation corpus** : détail tableau dans `registre-traitement.md`. ObjectStore hors JSON workspace : textes / vision adressés par empreinte ; unités ; `unit-cache` ; fiches et map de pseudonymisation des jobs ; cache synchrone `research/{fingerprint}` (TTL `RESEARCH_CACHE_MAX_DAYS`, défaut 90 j) ; fichiers `files/{sha}` orphelins + recalcul `upload-capacity` ; jobs terminés après `JOB_RETENTION_DAYS` (défaut 30 j, hors données de facturation). Crossref non stocké. Nettoyage après chaque sauvegarde (arrière-plan ; protections analyses actives ; échec = `workspace.orphan_cleanup` sans contenu).

## E-mail d’inactivité (étape D)

L’avertissement 30 jours avant suppression après 12 mois d’inactivité est **stubbé** : le flag `warnDueAt` est prévu dans les métadonnées ; l’envoi e-mail sera branché lorsqu’une infrastructure de messagerie sera disponible.
