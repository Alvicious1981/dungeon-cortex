import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { mirrorPlayerCombatantHp, setPlayerHp } from "@/lib/db/player-hp";

function tx() {
  return {
    character: { update: vi.fn().mockResolvedValue({}) },
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("setPlayerHp", () => {
  it("writes Character first, then mirrors the player's Combatant", async () => {
    const t = tx();
    await expect(
      setPlayerHp(t, { characterId: "char-1", encounterId: "enc-1", hp: 7 }),
    ).resolves.toBe(7);
    expect(t.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: 7 },
    });
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      // Every player HP write also resets the death state (death-saves spec §4).
      data: { hp: 7, deathSaveSuccesses: 0, deathSaveFailures: 0, stableWakeRound: null },
    });
    const characterOrder = (t.character.update as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const combatantOrder = (t.combatant.updateMany as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(characterOrder).toBeLessThan(combatantOrder);
  });

  it("clamps below zero and skips the mirror outside an encounter", async () => {
    const t = tx();
    await expect(
      setPlayerHp(t, { characterId: "char-1", encounterId: null, hp: -4 }),
    ).resolves.toBe(0);
    expect(t.character.update).toHaveBeenCalledWith({
      where: { id: "char-1" },
      data: { hp: 0 },
    });
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("mirrors nothing without an encounter", async () => {
    const t = tx();
    await mirrorPlayerCombatantHp(t, null, "char-1", 5);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });
});
