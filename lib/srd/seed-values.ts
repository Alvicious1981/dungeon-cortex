/**
 * The SRD spell cache mixes plain booleans with yes/no text in both English
 * and Spanish ("Sí", "verdadero", "Falso"...). Anything this function does
 * not recognize returns null instead of guessing true or false, so a value
 * the source data got wrong (or a spelling nobody has added yet) stays
 * visibly unresolved instead of silently becoming false.
 */
export function parseSrdBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "si", "sí", "s", "verdadero"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "falso"].includes(normalized)) {
    return false;
  }
  return null;
}
