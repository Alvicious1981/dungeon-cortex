import { prisma } from "@/lib/db/prisma";

/**
 * Looks up a spell in the deterministic SRD database.
 * Matches by exact ID first, falls back to loose name search.
 * @param query Spell name or ID to look up
 * @returns Serialized JSON payload of the spell, or null if not found.
 */
export async function getSpellInfo(query: string) {
  let spell = await prisma.srdSpell.findUnique({
    where: { id: query },
  });

  if (!spell) {
    const spells = await prisma.srdSpell.findMany({
      where: {
        name: {
          contains: query,
          mode: "insensitive",
        },
      },
      take: 1,
    });
    spell = spells[0] || null;
  }

  return spell ? spell.data : null;
}

/**
 * Looks up a monster in the deterministic SRD database.
 * Matches by exact ID first, falls back to loose name search.
 * @param query Monster name or ID to look up
 * @returns Serialized JSON payload of the monster, or null if not found.
 */
export async function getMonsterInfo(query: string) {
  let monster = await prisma.srdMonster.findUnique({
    where: { id: query },
  });

  if (!monster) {
    const monsters = await prisma.srdMonster.findMany({
      where: {
        name: {
          contains: query,
          mode: "insensitive",
        },
      },
      take: 1,
    });
    monster = monsters[0] || null;
  }

  return monster ? monster.data : null;
}

/**
 * Looks up an equipment item in the deterministic SRD database.
 * Matches by exact ID first, falls back to loose name search.
 * @param query Item name or ID to look up
 * @returns Serialized JSON payload of the item, or null if not found.
 */
export async function getItemInfo(query: string) {
  let item = await prisma.srdItem.findUnique({
    where: { id: query },
  });

  if (!item) {
    const items = await prisma.srdItem.findMany({
      where: {
        name: {
          contains: query,
          mode: "insensitive",
        },
      },
      take: 1,
    });
    item = items[0] || null;
  }

  return item ? item.data : null;
}
