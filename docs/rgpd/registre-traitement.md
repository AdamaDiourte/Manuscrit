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
| **Durées** | Mode session (défaut) : aucune persistance serveur des réponses (étape A) ; à partir de l’étape D : session = purge après génération + filet 24 h ; profil conservé = 12 mois d’inactivité (avertissement 30 j avant, e-mail stub) ; logs techniques = 6 mois max |
| **Mesures de sécurité** | TLS ; contrôle d’accès par utilisateur ; rate limiting ; clés API côté serveur ; pseudonymisation et filtre avant LLM ; chiffrement AES-GCM des textes libres prévu étape D (`PROFILE_ENCRYPTION_KEY`) ; pas de log des réponses ni des prompts |
| **DPO** | À compléter |
| **Droits** | Accès, portabilité, rectification, effacement, retrait du consentement, opposition à l’amélioration du service — espace « Mes données » (étape C) |
