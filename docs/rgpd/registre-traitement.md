# Fiche de registre — Génération de sujets de recherche

| Champ | Contenu |
| --- | --- |
| **Responsable de traitement** | DataSensia (à compléter : raison sociale, adresse, contact) |
| **Nom du traitement** | Génération de sujets de recherche (Manuscrit · DataSensia) |
| **Finalité** | Proposer trois sujets de recherche (maîtrise, ambition, découverte) à partir d’un questionnaire de profil, dans le respect des contraintes de faisabilité |
| **Base légale** | Art. 6.1.b RGPD (exécution du service) pour le questionnaire et la génération ; art. 6.1.a pour la conservation du profil au-delà de la session, l’amélioration du service et l’import de CV (consentements distincts) |
| **Personnes concernées** | Étudiants et chercheurs utilisateurs de Manuscrit, âgés de 15 ans ou plus |
| **Catégories de données** | Réponses au questionnaire (disciplines, méthodes, contraintes, textes libres courts) ; sujets générés ; preuves de consentement (valeur, date ISO, version de notice) ; métadonnées techniques de génération (horodatage, statut, tokens) |
| **Données non collectées** | Origine, nationalité, lieu de naissance, religion, opinions politiques, appartenance syndicale, santé, handicap, orientation sexuelle, situation familiale, âge précis, genre, noms de personnes, noms d’établissements obligatoires |
| **Destinataires** | Personnel habilité DataSensia ; fournisseur LLM configuré (`AI_BASE_URL`) en tant que sous-traitant |
| **Transferts hors UE** | Selon le fournisseur LLM — voir `sous-traitants.md` ; encadrement DPF / CCT si applicable |
| **Durées (profil / session)** | Mode session (défaut) : aucune persistance serveur des réponses (étape A) ; à partir de l’étape D : session = purge après génération + filet 24 h ; profil conservé = 12 mois d’inactivité (avertissement 30 j avant, e-mail stub) ; logs techniques = 6 mois max |
| **Mesures de sécurité** | TLS ; contrôle d’accès par utilisateur ; rate limiting ; clés API côté serveur ; pseudonymisation et filtre avant LLM ; chiffrement AES-GCM des textes libres prévu étape D (`PROFILE_ENCRYPTION_KEY`) ; pas de log des réponses ni des prompts ; échec de nettoyage ObjectStore = événement `workspace.orphan_cleanup` (sans contenu) |
| **DPO** | À compléter |
| **Droits** | Accès, portabilité, rectification, effacement, retrait du consentement, opposition à l’amélioration du service — espace « Mes données » (étape C) |

## Conservation ObjectStore (corpus & analyses)

Nettoyage après chaque sauvegarde du workspace (arrière-plan). Protections : analyses `running` / `waiting_batch` ; empreintes / fichiers écrits ou encore référencés dans la même sauvegarde. Variables : `RESEARCH_CACHE_MAX_DAYS` (défaut 90), `JOB_RETENTION_DAYS` (défaut 30).

| Famille de données | Contenu | Durée de conservation | Déclencheur de suppression |
| --- | --- | --- | --- |
| `workspace` | Projets, matériaux (indicateurs), versions, cadrage | Compte / projet actif | Suppression compte ou projet (purge associée) |
| `texts/{materialId}[/{hash}]` | Textes extraits (données / outil / tableaux) | Tant qu’une empreinte est référencée par un matériau ou un instantané `before`/`after` | Plus aucune référence d’empreinte ; ou matériau/dossier sans aucune ref |
| `vision/{materialId}[/{hash}]` | Transcriptions vision (images / PDF scannés) | Idem textes | Idem textes |
| `units/{materialId}` | Unités d’analyse découpées | Matériau courant + empreinte encore valide | Matériau plus courant / plus référencé, ou empreinte stockée obsolète |
| `unit-cache/{hash}` | Fiches d’extraction mises en cache (thèmes, citations) | Lié au matériau cité | `materialId` plus référencé |
| `jobs/{jobId}/cards` | Fiches / citations de la tâche async | Vie de la tâche + matériaux cités | Matériaux cités absents (filtre) ; ou tâche expirée (ci-dessous) |
| `jobs/{jobId}/pseudonym-map` | Table de correspondance pseudonymisation | Fin de tâche (done/failed/cancelled) en principe | Matériaux du job plus référencés ; ou tâche expirée |
| `jobs/{jobId}` | Métadonnées / progression / résultat async | `JOB_RETENTION_DAYS` (défaut **30**) après `done` / `failed` / `cancelled` | Âge > seuil ; facturation inchangée (`billing/usage/…`) |
| `research/{fingerprint}` (+ `.lock`) | Cache analyse synchrone (plan, citations) | `RESEARCH_CACHE_MAX_DAYS` (défaut **90**) ou matériaux cités encore présents | Citation d’un matériau disparu ; ou âge > seuil ; verrous `.lock` périmés |
| `files/{sha256}` | Binaires déposés (PDF, images…) | Tant qu’un matériau ou instantané référence `file` / `toolFile` | Plus aucune référence ; puis recalcul de `upload-capacity` |
| `upload-capacity` | Compteurs taille / nombre de dépôts | Aligné sur les `files/` restants | Recalcul après suppression de fichiers orphelins |
| `billing/usage/{période}` | Jetons de quota d’analyses | Exigences facturation / litige | Hors nettoyage orphelin (conservation comptable) |
| `billing/{live\|test}/account` | Références compte Stripe | Vie du compte payant | Hors nettoyage orphelin |
| Catalogue Crossref | Notices bibliographiques | **Non persisté** (appel API à la volée) | — |
