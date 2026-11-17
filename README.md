# Manuscrit · DataSensia

Application de cadrage et d’organisation d’un corpus scientifique. Ouvrir le dossier qui contient ce README dans Cursor. Les fichiers sont directement modifiables.

## Démarrage local sous Windows, macOS ou Linux

Installer Node.js 24 et Docker avec Compose. Sous Windows, démarrer Docker Desktop. Dans le terminal ouvert à la racine du projet, exécuter :

```sh
docker compose -f compose.dev.yaml up -d
npm ci
npm run dev
```

Ouvrir http://127.0.0.1:5173. Le serveur de développement de Vite transmet les requêtes /api à Express sur le port 3000. Le mode local utilise un utilisateur de développement et lie les deux serveurs à l’adresse de boucle locale. La base se trouve dans un volume Docker. Pour arrêter, utiliser Ctrl+C, puis `docker compose -f compose.dev.yaml stop`.

## Organisation des sources

| Dossier | Responsabilité |
| --- | --- |
| frontend/src/pages | Espace de travail, gestion des projets et navigation |
| frontend/src/components/copilot | Parcours projet et manuscrit, attestations, abonnements |
| frontend/src/data | Modèles de mémoire, thèse, rapport et article |
| frontend/src/services/import | Lecture locale du texte, des documents Office, PDF et tableaux |
| frontend/src/styles | Styles communs et interface du copilote |
| frontend/public/vendor/pdfjs | Lecteur PDF distribué avec l’application et sa licence |
| backend/src/routes | Contrôleurs HTTP des projets, de l’analyse et de la facturation |
| backend/src/services/research | Appels au modèle, repérage Crossref et vérification des citations |
| backend/src/services/billing | Quotas et gestion des abonnements Stripe |
| backend/src/storage | Stockage PostgreSQL, pièces jointes et écritures conditionnelles |
| backend/src/http | Adaptation des requêtes Express et lecture limitée des corps HTTP |
| backend/db | Schéma initial de la base |
| shared/research | Définitions du questionnaire et du contenu d’un matériau partagées entre client et serveur |
| deploy/ovh | Déploiement de production, HTTPS, authentification OIDC et configuration |

## Construire et déployer

`npm run build` vérifie les types TypeScript du frontend et du backend, crée les actifs de production dans frontend/dist et compile le serveur dans backend/dist. En production, Express sert aussi les fichiers statiques compilés du frontend. Le guide [déployer sur OVH](deploy/ovh/README.md) décrit la configuration Docker. Le port Express doit rester accessible exclusivement depuis le proxy authentifié.

Les clés IA et Stripe sont lues dans l’environnement serveur. En développement, définir ces variables dans le terminal avant de démarrer. En production, utiliser le fichier .env local au dossier deploy/ovh, préparé depuis configuration.example. AI_BASE_URL doit être l’URL de base HTTPS du fournisseur compatible Chat Completions ; AI_MODEL et AI_API_KEY sélectionnent le modèle et la clé. STRIPE_SECRET_KEY, STRIPE_PRICE_PLUS et STRIPE_PRICE_PRO correspondent au même environnement Stripe. L’absence de ces services permet encore d’organiser un projet et ses matériaux.

## Données et capacité

Le modèle reçoit le projet et les matériaux retenus. Chaque citation affichée est vérifiée dans le texte extrait. Les propositions et leurs interprétations restent à examiner par l’auteur. Les formulaires recueillent une attestation de dépôt et une confirmation avant analyse. Une recherche optionnelle de notices Crossref utilise les mots-clés renseignés pour cette recherche.

Les limites initiales sont 20 Mio par fichier, 180 000 caractères extraits par document, environ 120 000 caractères par requête d’analyse. Les quotas d’analyse sont 1, 20 ou 60 par mois selon la formule. Les performances à grande échelle dépendent notamment du modèle distant, du dimensionnement PostgreSQL et des quotas du fournisseur. Les nouvelles instances OVH utilisent leur propre base ; les dossiers déjà conservés sur le site privé doivent faire l’objet d’une migration explicite si nécessaire.
