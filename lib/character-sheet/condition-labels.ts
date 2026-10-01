/** Presentation labels only; condition identifiers remain unchanged. */
const CONDITION_LABELS: Record<string, string> = {
  blinded: "Cegado", charmed: "Hechizado", deafened: "Ensordecido",
  frightened: "Asustado", grappled: "Agarrado", incapacitated: "Incapacitado",
  invisible: "Invisible", paralyzed: "Paralizado", petrified: "Petrificado",
  poisoned: "Envenenado", prone: "Derribado", restrained: "Restringido",
  stunned: "Aturdido", unconscious: "Inconsciente", exhaustion: "Agotamiento",
};

export function conditionLabel(condition: string): string {
  return CONDITION_LABELS[condition.toLowerCase()] ?? condition;
}
