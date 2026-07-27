// Derived adapter for the `speed` field exposed by
// https://www.dnd5eapi.co/api/2014/races/{index} and its SRD subraces.
const SRD_RACE_WALKING_SPEED_FT = {
  dwarf: 25,
  elf: 30,
  halfling: 25,
  human: 30,
  dragonborn: 30,
  gnome: 25,
  "half-elf": 30,
  "half-orc": 30,
  tiefling: 30,
  "hill-dwarf": 25,
  "mountain-dwarf": 25,
  "high-elf": 30,
  "wood-elf": 35,
  "lightfoot-halfling": 25,
  "stout-halfling": 25,
} as const;

function normalizeRaceIndex(race: string): string {
  return race.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Returns the SRD 2014 base walking speed for a canonical race or subrace.
 * Unknown values stay unresolved so callers cannot silently invent 30 feet.
 */
export function getSrdRaceWalkingSpeedFt(race: string): number | null {
  const normalized = normalizeRaceIndex(race);
  return normalized in SRD_RACE_WALKING_SPEED_FT
    ? SRD_RACE_WALKING_SPEED_FT[
        normalized as keyof typeof SRD_RACE_WALKING_SPEED_FT
      ]
    : null;
}
