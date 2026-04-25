/**
 * lib/rules/generator.ts
 *
 * Just-In-Time (JIT) procedural generation for dungeon nodes.
 * 
 * Design contract:
 *   Generation is deterministic based on the nodeId.
 *   Populates "empty" nodes with features, monsters, or loot on first visit.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { seededFloat, pickSeeded } from "@/lib/rules/generators";
import { filterMonsters } from "@/lib/rules/srd";
import { generateLootPayload } from "@/lib/rules/loot";

/**
 * Procedurally populates a node with content if it is currently "empty".
 * This is called Just-In-Time when a player moves to an unexplored node.
 *
 * @param tx - Prisma transaction client.
 * @param nodeId - The ID of the node to generate content for.
 */
export async function generateNodeContent(
  tx: Prisma.TransactionClient,
  nodeId: string
): Promise<void> {
  const node = await tx.locationNode.findUnique({
    where: { id: nodeId },
    select: { feature: true, description: true, featureData: true }
  });

  // Only populate if the node is still marked as "empty" and hasn't been generated yet
  if (!node || node.feature !== "empty" || (node.featureData as any)?.generated) {
    return;
  }

  const seed = nodeId;
  const roll = seededFloat(seed);

  let feature = "empty";
  let description = node.description;
  let featureData: any = { generated: true };

  if (roll < 0.6) {
    // 60% chance: Atmospheric Empty Room
    feature = "empty";
    description = pickSeeded(seed + ":flavor", [
      "A damp, quiet chamber with water dripping from the ceiling.",
      "The air is stale here, smelling of dust and dry rot.",
      "Vines crawl across the stone walls, reaching for a light that isn't there.",
      "A simple room with cracked floor tiles and a feeling of ancient abandonment.",
      "Shadows dance in the corners of this largely featureless stone hall.",
      "The walls are lined with empty, dust-covered alcoves."
    ]);
  } else if (roll < 0.8) {
    // 20% chance: NPC / Monster Presence
    feature = "npc";
    const monsters = filterMonsters({ maxCR: 2 }); // Low-level dungeon denizens
    if (monsters.length > 0) {
      const monster = pickSeeded(seed + ":monster", monsters);
      featureData = { 
        ...featureData,
        monsterName: monster.name, 
        indexSlug: monster.index,
        aggressive: seededFloat(seed + ":aggro") > 0.3
      };
      description = `The chamber is occupied by a ${monster.name}. It seems ${featureData.aggressive ? "hostile" : "wary"} of your presence.`;
    }
  } else if (roll < 0.9) {
    // 10% chance: Treasure
    feature = "treasure";
    const loot = generateLootPayload({
      tensionScore: seededFloat(seed + ":tension"),
      enemyCount: 0,
      avgCR: 1,
      seed: seed + ":loot"
    });
    featureData = { ...featureData, loot };
    description = "You find a sturdy, locked chest partially buried under some debris in the corner.";
  } else {
    // 10% chance: Hazard / Trap
    feature = "hazard";
    featureData = { 
      ...featureData,
      type: "trap", 
      dc: 10 + Math.floor(seededFloat(seed + ":dc") * 5), 
      damage: "1d6" 
    };
    description = "The stone floor looks suspiciously clean here, and the ceiling has small, dark holes along its edges.";
  }

  await tx.locationNode.update({
    where: { id: nodeId },
    data: {
      feature,
      description,
      featureData: featureData as Prisma.InputJsonValue,
    }
  });
}
