import { pickSeeded, seededFloat } from '../generators';

const SYLLABLES_START = ["Ar", "Bae", "Cael", "Da", "El", "Fa", "Ga", "Ha", "Ith", "Ja", "Ka", "La", "Ma", "Na", "O", "Pa", "Rha", "Sa", "Ta", "Va", "Za"];
const SYLLABLES_MID = ["ra", "ro", "li", "le", "ma", "mo", "na", "no", "di", "de", "fi", "fe", "vi", "vo", "ki", "ku"];
const SYLLABLES_END = ["dor", "th", "n", "l", "s", "k", "wyn", "mir", "las", "riel", "gorn", "tar", "var", "zor"];

/**
 * Procedurally assigns a name to an NPC using syllabic combination.
 * Completely deterministic based on the provided seed (e.g. entityId).
 */
export function generateNPCName(seed: string): string {
  const lenRoll = seededFloat(`${seed}:namelen`);
  // Decide length: 2 (30%), 3 (50%), or 4 (20%) syllables
  const syllables = lenRoll < 0.3 ? 2 : lenRoll < 0.8 ? 3 : 4;
  
  let name = pickSeeded(`${seed}:s0`, SYLLABLES_START);
  
  for (let i = 1; i < syllables - 1; i++) {
    name += pickSeeded(`${seed}:s${i}`, SYLLABLES_MID);
  }
  
  if (syllables > 1) {
    name += pickSeeded(`${seed}:send`, SYLLABLES_END);
  }
  
  return name;
}
