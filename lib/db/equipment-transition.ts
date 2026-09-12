import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { resolveCombatEquipment, type EquipmentRefusalCode } from "@/lib/rules/combat-equipment";
import { slotFor } from "@/lib/rules/equipment-slot";
import { finalizeEncounterTurn } from "@/lib/rules/combat-pipeline";

export class EquipmentTransitionError extends Error {
  constructor(public readonly code: EquipmentRefusalCode | "EQUIPMENT_STATE_CONFLICT") {
    super(code);
    this.name = "EquipmentTransitionError";
  }
}

export async function persistEquipmentTransition(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    characterId: string;
    itemId: string;
    encounterId: string;
    expectedRound: number;
    expectedTurnIndex: number;
    playerAction: string;
  }
): Promise<{ events: GameEvent[] }> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Character" WHERE "id" = ${input.characterId} FOR UPDATE
  `;

  const item = await tx.inventoryItem.findFirst({
    where: { id: input.itemId, characterId: input.characterId },
    select: { id: true, name: true, type: true, properties: true, equippedSlot: true },
  });
  if (!item) throw new EquipmentTransitionError("EQUIPMENT_STATE_CONFLICT");

  const targetSlot = slotFor(item).slot;
  const occupant = await tx.inventoryItem.findFirst({
    where: { characterId: input.characterId, equippedSlot: targetSlot },
    select: { id: true },
  });
  const encounter = await tx.encounter.findFirst({
    where: {
      id: input.encounterId,
      status: "active",
      round: input.expectedRound,
      currentTurnIndex: input.expectedTurnIndex,
    },
    select: { currentTurnObjectInteractionUsed: true },
  });
  if (!encounter) throw new EquipmentTransitionError("EQUIPMENT_STATE_CONFLICT");

  const decision = resolveCombatEquipment({
    item,
    alreadyEquipped: item.equippedSlot === targetSlot,
    slotOccupied: occupant !== null && occupant.id !== item.id,
    interactionUsed: encounter.currentTurnObjectInteractionUsed,
  });
  if (!decision.ok) throw new EquipmentTransitionError(decision.code);

  let turnEvents: GameEvent[] = [];
  if (decision.mode === "interaction") {
    const claim = await tx.encounter.updateMany({
      where: {
        id: input.encounterId,
        status: "active",
        round: input.expectedRound,
        currentTurnIndex: input.expectedTurnIndex,
        currentTurnObjectInteractionUsed: false,
      },
      data: { currentTurnObjectInteractionUsed: true },
    });
    if (claim.count !== 1) throw new EquipmentTransitionError("EQUIPMENT_STATE_CONFLICT");
  } else {
    const finalized = await finalizeEncounterTurn({
      tx,
      encounterId: input.encounterId,
      currentTurnIndex: input.expectedTurnIndex,
      round: input.expectedRound,
      failOnStaleTurn: true,
    });
    if (finalized.turnAdvanceConflict) {
      throw new EquipmentTransitionError("EQUIPMENT_STATE_CONFLICT");
    }
    turnEvents = finalized.events;
  }

  await tx.inventoryItem.updateMany({
    where: { characterId: input.characterId, equippedSlot: targetSlot },
    data: { equippedSlot: null },
  });
  await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: targetSlot } });
  await tx.gameLog.create({
    data: { campaignId: input.campaignId, role: "user", content: input.playerAction },
  });

  return {
    events: [
      { type: "EQUIP_ITEM", payload: { itemId: item.id, itemName: item.name, targetSlot } },
      ...turnEvents,
    ],
  };
}
