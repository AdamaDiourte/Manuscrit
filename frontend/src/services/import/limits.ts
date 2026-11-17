export const MAX_TEXT = 180_000;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function checkTextSize(characters: number) {
  if (characters > MAX_TEXT) {
    throw new Error(
      "Ce texte dépasse 180 000 caractères. Divisez le document en parties identifiées avant l’analyse.",
    );
  }
}
