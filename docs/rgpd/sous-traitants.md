# Sous-traitants — module Générateur de sujets

| Sous-traitant | Rôle | Localisation | Garanties |
| --- | --- | --- | --- |
| Fournisseur LLM (`AI_BASE_URL` / `AI_MODEL`) | Génération des sujets à partir d’un profil pseudonymisé | Selon configuration (privilégier hébergement UE) | DPA art. 28 ; **pas d’entraînement** sur les données client ; rétention minimale / zero data retention si disponible ; transferts hors UE encadrés (DPF / CCT) |
| Hébergeur PostgreSQL / infrastructure (OVH ou autre) | Stockage applicatif | UE (cible) | Mesures art. 32 ; accès restreint |

Mettre à jour ce tableau dès qu’un fournisseur est choisi en production. Les clés API restent exclusivement côté serveur.

## E-mail d’inactivité (étape D)

L’avertissement 30 jours avant suppression après 12 mois d’inactivité est **stubbé** : le flag `warnDueAt` est prévu dans les métadonnées ; l’envoi e-mail sera branché lorsqu’une infrastructure de messagerie sera disponible.
