import { describe, expect, it, vi } from "vitest";
import { campaignPlayableRefusal, characterAliveRefusal } from "@/lib/db/campaign-guard";

describe("characterAliveRefusal (death-saves spec §7.2, §9)", () => {
  it("refuses a dead character and passes a living one", async () => {
    const dead = { character: { findUnique: vi.fn().mockResolvedValue({ diedAt: new Date() }) } } as never;
    const alive = { character: { findUnique: vi.fn().mockResolvedValue({ diedAt: null }) } } as never;
    const missing = { character: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(await characterAliveRefusal(dead, "x")).toMatchObject({ code: "CHARACTER_DEAD" });
    expect(await characterAliveRefusal(alive, "x")).toBeNull();
    expect(await characterAliveRefusal(missing, "x")).toBeNull();
  });
});

function db(row: unknown) {
  return { campaign: { findUnique: vi.fn().mockResolvedValue(row) } } as never;
}
const alive = { diedAt: null };
const fight = (hp: number) => [{ combatants: [{ hp }] }];

describe("campaignPlayableRefusal (death-saves spec §7.2)", () => {
  it("lets a playable campaign through", async () => {
    expect(await campaignPlayableRefusal(db({ status: "active", character: alive, encounters: [] }), "c")).toBeNull();
    expect(await campaignPlayableRefusal(db({ status: "active", character: alive, encounters: fight(5) }), "c")).toBeNull();
  });

  it("refuses an inactive campaign", async () => {
    expect(await campaignPlayableRefusal(db({ status: "archived", character: alive, encounters: [] }), "c"))
      .toMatchObject({ code: "CAMPAIGN_NOT_ACTIVE", error: "Campaign is not active." });
  });

  it("refuses a dead character before anything else", async () => {
    expect(
      await campaignPlayableRefusal(
        db({ status: "archived", character: { diedAt: new Date() }, encounters: fight(0) }),
        "c"
      )
    ).toMatchObject({ code: "CHARACTER_DEAD" });
  });

  it("refuses an unconscious player unless the caller delegates 0 HP", async () => {
    const row = { status: "active", character: alive, encounters: fight(0) };
    expect(await campaignPlayableRefusal(db(row), "c")).toMatchObject({ code: "PLAYER_UNCONSCIOUS" });
    expect(await campaignPlayableRefusal(db(row), "c", { unconscious: "delegate" })).toBeNull();
  });

  it("tolerates legacy doubles without the character or encounters relations", async () => {
    expect(await campaignPlayableRefusal(db({ status: "active" }), "c")).toBeNull();
    expect(await campaignPlayableRefusal(db(null), "c")).toBeNull();
  });
});
