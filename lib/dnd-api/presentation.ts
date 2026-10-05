const CLASS_LABELS: Readonly<Record<string, string>> = {
  barbarian: "Bárbaro",
  bard: "Bardo",
  cleric: "Clérigo",
  druid: "Druida",
  fighter: "Guerrero",
  monk: "Monje",
  paladin: "Paladín",
  ranger: "Explorador",
  rogue: "Pícaro",
  sorcerer: "Hechicero",
  warlock: "Brujo",
  wizard: "Mago",
};

const RACE_LABELS: Readonly<Record<string, string>> = {
  dragonborn: "Dracónido",
  dwarf: "Enano",
  elf: "Elfo",
  gnome: "Gnomo",
  "half-elf": "Semielfo",
  "half-orc": "Semiorco",
  halfling: "Mediano",
  human: "Humano",
  tiefling: "Tiefling",
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

export function classDisplayName(value: string, fallback = value): string {
  return CLASS_LABELS[normalized(value)] ?? fallback;
}

export function raceDisplayName(value: string, fallback = value): string {
  return RACE_LABELS[normalized(value)] ?? fallback;
}
