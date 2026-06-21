export const srdKeys = {
  all: ["srd"] as const,
  dnd5e2014: () => [...srdKeys.all, "dnd5e-2014"] as const,
  monsters: () => [...srdKeys.dnd5e2014(), "monsters"] as const,
  monster: (index: string) => [...srdKeys.monsters(), "detail", index] as const,
};
