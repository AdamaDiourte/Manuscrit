# Stub — e-mail d’avertissement d’inactivité

**Statut :** non branché (étape A / préparation étape D).

## Comportement prévu

1. Profil conservé avec consentement `retainProfile`.
2. `lastActivityAt` mis à jour à chaque accès.
3. `warnDueAt = lastActivityAt + 11 mois`.
4. Job de purge (filet 24 h) :
   - si `now >= warnDueAt` et e-mail non envoyé → poser `warningSentAt` et appeler `sendInactivityWarning(uid)` (**stub** : log technique sans contenu de profil) ;
   - si `now >= lastActivityAt + 12 mois` → suppression réelle du profil et des sujets.

## Stub actuel

```ts
export async function sendInactivityWarning(uidPseudo: string) {
  console.info(JSON.stringify({
    event: "topics.inactivity_warning_stub",
    uidPseudo,
    at: new Date().toISOString(),
  }));
}
```

Aucun corps de questionnaire ni sujet généré n’est journalisé.
