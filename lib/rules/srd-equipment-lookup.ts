/**
 * lib/rules/srd-equipment-lookup.ts
 *
 * Looks one SRD equipment row up and returns it in a typed shape.
 *
 * This module used to query `SrdEquipment`, a table nothing has ever written to,
 * so it answered null for every weapon and every piece of armour in the game.
 * The seeded data lives in `SrdItem`.
 *
 * Matching is by id or by exact name. The previous implementation fell back to a
 * substring search and accepted the first of five candidates, which made
 * "Sword" resolve to a Longsword — a rules authority deciding by resemblance.
 *
 * Server-only — never import from a client component.
 */

import { prisma } from "@/lib/db/prisma";
import {
  projectSrdItem,
  type EquipmentInfo,
} from "@/lib/rules/srd-equipment-projection";

export type { EquipmentInfo };

export async function getEquipmentInfo(query: string): Promise<EquipmentInfo | null> {
  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return null;

  const byId = await prisma.srdItem.findUnique({ where: { id: query } });
  if (byId) return projectSrdItem(byId.name, byId.data);

  // findMany rather than findFirst: several existing test suites mock the Prisma
  // client with findUnique and findMany only, and this module has no reason to
  // break them. take: 2 caps a query that should return at most one row; it is
  // not read as a count and does not reject a second match.
  const candidates = await prisma.srdItem.findMany({
    where: { name: { equals: wanted, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: 2,
  });

  // The equality filter should already guarantee this. Re-checking in code means
  // a later loosening of the query cannot silently reintroduce a fuzzy match.
  const exact = candidates.find(
    (candidate) => candidate.name.trim().toLowerCase() === wanted,
  );

  return exact ? projectSrdItem(exact.name, exact.data) : null;
}
