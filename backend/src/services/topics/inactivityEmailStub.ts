/**
 * Stub for the 30-day inactivity warning e-mail (étape D).
 * Logs technical metadata only — never profile content.
 */
export async function sendInactivityWarning(uidPseudo: string) {
  console.info(
    JSON.stringify({
      event: "topics.inactivity_warning_stub",
      uidPseudo,
      at: new Date().toISOString(),
    }),
  );
}
