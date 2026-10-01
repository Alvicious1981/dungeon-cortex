import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import type { GameEvent } from "@/lib/events/game-events";
import { applyPlayerDowned } from "@/lib/db/player-downed";

function tx() {
  return {
    combatant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as unknown as Prisma.TransactionClient;
}

describe("applyPlayerDowned (death-saves spec §6.1)", () => {
  it("leaves the player dying and says so", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", characterId: "char-1", hpBefore: 5, damage: 8, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dying");
    expect(events).toEqual([{ type: "PLAYER_DOWNED", payload: {} }]);
    expect(t.combatant.updateMany).not.toHaveBeenCalled();
  });

  it("kills outright on massive damage by writing the canonical death marker", async () => {
    const t = tx();
    const events: GameEvent[] = [];
    const fall = await applyPlayerDowned(t, {
      encounterId: "enc-1", characterId: "char-1", hpBefore: 5, damage: 25, maxHp: 20, collectEvents: true, events,
    });
    expect(fall).toBe("dead");
    expect(t.combatant.updateMany).toHaveBeenCalledWith({
      where: { encounterId: "enc-1", characterId: "char-1" },
      data: { deathSaveFailures: 3 },
    });
    expect(events).toEqual([{ type: "PLAYER_DIED", payload: { cause: "massive_damage" } }]);
  });
});
