# Pré-analyse AIPD — Génération de sujets de recherche

Pré-analyse selon les critères CNIL. **À valider par le DPO.**

## Critères examinés

1. **Évaluation / profilage** — Le module construit un profil de compétences et de contraintes pour suggérer des sujets. Il ne produit pas de score d’évaluation de la personne, ni de décision produisant des effets juridiques ou significatifs similaires (art. 22). Les suggestions restent à la main de l’utilisateur.
2. **Usage innovant d’IA** — Un LLM génère des propositions textuelles à partir d’un profil pseudonymisé. Transparence « contenu généré par IA » (AI Act art. 50). Pas d’entraînement sur les données de l’utilisateur (exigence contractuelle fournisseur).
3. **Personnes potentiellement mineures** — Case obligatoire « J’ai 15 ans ou plus » ; blocage sinon (art. 45 loi Informatique et Libertés). Pas de collecte volontaire de données de mineurs de moins de 15 ans.
4. **Données sensibles (art. 9)** — Questions conçues pour les exclure ; filtre regex + lexique ; avertissement UX non bloquant ; consignes prompt.
5. **Transferts / sous-traitance** — Fournisseur LLM configurable ; DPA art. 28 et rétention minimale documentés dans `sous-traitants.md`.

## Conclusion provisoire

Une **AIPD complète est recommandée** avant l’activation de la conservation serveur du profil (étape D) et de l’import de CV (étape E), en raison du cumul profilage léger + IA + éventuelle conservation. Pour l’étape A (session locale uniquement, génération stateless), le risque est plus faible mais la documentation et les mesures de minimisation restent obligatoires.

**Statut :** brouillon — validation DPO en attente.
