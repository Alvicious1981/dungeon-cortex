import { tool } from "ai";
import { prisma } from "@/lib/db/prisma";
import { SrdLookupInputSchema } from "@/lib/rules/srd";

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

export function buildSrdTools() {
  return {
    getSpellInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a spell by name or ID. MUST be used before narrating spell effects.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getSpellInfo(query);
          return data ? JSON.stringify(data) : JSON.stringify({ error: "Spell not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getItemInfo: tool({
      description:
        "Fetch exact mechanical JSON data for an item or piece of equipment by name or ID. MUST be used before narrating the properties of magical or mundane items.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getItemInfo(query);
          return data ? JSON.stringify(data) : JSON.stringify({ error: "Item not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
    getMonsterInfo: tool({
      description:
        "Fetch exact mechanical JSON data for a monster by name or ID. MUST be used before narrating combat encounters, describing enemy abilities, or resolving monster actions. Never invent AC, HP, or attack stats.",
      inputSchema: SrdLookupInputSchema,
      execute: async ({ query }) => {
        try {
          const data = await getMonsterInfo(query);
          return data
            ? JSON.stringify(data)
            : JSON.stringify({ error: "Monster not found mechanically." });
        } catch {
          return JSON.stringify({ error: "Action failed mechanically." });
        }
      },
    }),
  };
}

// ─── Monster querying via typed columns ───────────────────────────────────────

export interface MonsterQueryOptions {
  /** Substring match against monster name (case-insensitive). */
  nameQuery?: string;
  /** Exact creature type, e.g. "dragon", "undead" (case-insensitive). */
  type?: string;
  /** Exact size category, e.g. "Large", "Tiny" (case-insensitive). */
  size?: string;
  /** Minimum CR (inclusive). */
  minCR?: number;
  /** Maximum CR (inclusive). Useful for encounter budget filtering. */
  maxCR?: number;
  /** Maximum number of results to return (default 10, max 50). */
  limit?: number;
}

/**
 * Queries the SrdMonster table using the explicit typed columns for efficient
 * server-side filtering. Returns an array of raw JSON data blobs.
 *
 * This function is designed for the AI encounter-builder tool — it lets the
 * narrator request "all CR 1–3 undead" without loading all 334 monsters.
 */
export async function queryMonsters(opts: MonsterQueryOptions): Promise<unknown[]> {
  const { nameQuery, type, size, minCR, maxCR, limit = 10 } = opts;
  const safeLimit = Math.min(limit, 50);

  const monsters = await prisma.srdMonster.findMany({
    where: {
      ...(nameQuery && {
        name: { contains: nameQuery, mode: "insensitive" },
      }),
      ...(type && {
        type: { equals: type, mode: "insensitive" },
      }),
      ...(size && {
        size: { equals: size, mode: "insensitive" },
      }),
      ...((minCR !== undefined || maxCR !== undefined) && {
        cr: {
          ...(minCR !== undefined && { gte: minCR }),
          ...(maxCR !== undefined && { lte: maxCR }),
        },
      }),
    },
    orderBy: [{ cr: "asc" }, { name: "asc" }],
    take: safeLimit,
    select: { id: true, name: true, cr: true, type: true, size: true, alignment: true, data: true },
  });

  return monsters.map((m) => ({
    ...(m.data as object),
    // Surface the typed columns at the top level so the AI can read them directly
    // without navigating the raw blob. The data blob remains for full stat access.
    _cr: m.cr,
    _type: m.type,
    _size: m.size,
    _alignment: m.alignment,
  }));
}
