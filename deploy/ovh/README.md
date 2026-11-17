# Héberger Manuscrit sur un serveur OVHcloud

Ce profil exécute l’interface et les routes du dépôt sous Node.js. Caddy termine HTTPS, oauth2-proxy authentifie les comptes auprès de votre fournisseur OpenID Connect (OIDC) et PostgreSQL conserve matériaux, espaces et historiques. L’application et PostgreSQL restent accessibles uniquement sur le réseau interne de Compose. Le schéma emploie les préfixes de compte des routes et les mises à jour conditionnelles sont atomiques en base.

## Préparer le serveur

1. Sur un VPS ou une instance OVHcloud, installer Docker Engine et le plugin Compose. Pointer le domaine vers l’adresse de l’instance. Ouvrir les ports TCP 80 et 443 et restreindre l’accès d’administration.
2. Créer une application OIDC confidentielle autorisant le flux code avec PKCE et l’URI exacte `https://VOTRE-DOMAINE/oauth2/callback`. Configurer les inscriptions et les personnes autorisées chez le fournisseur d’identité. Conserver le même émetteur OIDC et les mêmes identifiants de sujet pour préserver l’association entre comptes et dossiers.
3. Depuis le dépôt, exécuter les commandes suivantes et renseigner les variables du fichier local. Le mot de passe PostgreSQL et la clé de cookie doivent être distincts. Pour la clé de cookie, générer 32 octets avec `openssl rand -base64 32`. Définir les domaines de courriel acceptés par le fournisseur. Un astérisque accepte tous les domaines des comptes autorisés par ce fournisseur.

```sh
cd deploy/ovh
umask 077
cp configuration.example .env
chmod 600 .env
```

4. Renseigner les identifiants serveur de l’IA et les identifiants de tarifs récurrents Stripe qui correspondent à vos offres. Utiliser une clé et deux tarifs du même environnement Stripe. Ces valeurs restent côté serveur. Le modèle doit correspondre exactement au modèle de l’endpoint choisi. Vérifier les conditions de traitement du fournisseur d’IA avant d’y soumettre un corpus.
5. Depuis ce même dossier, lancer la configuration, puis vérifier l’état des conteneurs.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Tester avec deux comptes distincts, deux projets et deux pièces jointes. Vérifier qu’un identifiant de fichier copié du premier compte reste inaccessible depuis le second. Tester un parcours d’analyse puis un abonnement et une résiliation avec Stripe en mode test avant de configurer les tarifs réels. La publication Sites et ce déploiement ont des stockages séparés. Une migration de dossiers existants nécessite une correspondance explicite entre leurs titulaires et les identifiants OIDC.

## Exploitation et capacité

- Sauvegarder PostgreSQL régulièrement vers un stockage OVHcloud distinct et chiffré. Par exemple, `docker compose exec -T database pg_dump -U manuscrit -Fc manuscrit > sauvegarde.dump`. Tester la restauration sur une base isolée avec `pg_restore`. Le volume Caddy contient les certificats. Conserver les secrets séparément des sauvegardes de données.
- Le profil fourni utilise une base unique, y compris pour les fichiers bornés en taille. Avant une ouverture large, mesurer la latence, la contention sur les révisions des dossiers, la taille des sauvegardes et les débits de l’IA. Les plafonds des fournisseurs restent applicables. Pour augmenter la capacité, brancher des réplicas applicatifs derrière un répartiteur et une base partagée, puis dimensionner leurs pools. Pour des fichiers volumineux, migrer les contenus binaires vers Object Storage avec des clés propres à chaque compte.
- Recréer l’image depuis un commit identifié lors d’une mise à jour. Avant toute évolution du schéma, effectuer une sauvegarde et appliquer une migration versionnée. Le script SQL initial est exécuté uniquement lors de la création du volume PostgreSQL.
- Suivre les erreurs HTTP, les délais des appels externes, la disponibilité du fournisseur OIDC et l’occupation du stockage. Les originaux et réponses IA contiennent des données de recherche. Éviter leur inclusion dans les journaux et définir les modalités de récupération et de suppression avec les utilisateurs.

Références de configuration : [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/), [Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
