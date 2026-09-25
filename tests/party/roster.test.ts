import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_PARTY_MEMBERS, buildMainPartyMemberData, partyCapacityRefusal } from "@/lib/party/roster";

describe("partyCapacityRefusal (DC-PARTY-001)", () => {
  it("allows adding a member below the cap", () => {
    expect(partyCapacityRefusal("camp_1", 0)).toBeNull();
    expect(partyCapacityRefusal("camp_1", 1)).toBeNull();
    expect(partyCapacityRefusal("camp_1", 2)).toBeNull();
  });

  it("refuses once the cap is reached", () => {
    expect(partyCapacityRefusal("camp_1", MAX_ACTIVE_PARTY_MEMBERS)).toMatchObject({
      code: "PARTY_AT_CAPACITY",
    });
    expect(partyCapacityRefusal("camp_1", MAX_ACTIVE_PARTY_MEMBERS + 1)).toMatchObject({
      code: "PARTY_AT_CAPACITY",
    });
  });

  it("names the campaign and the cap in the refusal message", () => {
    const refusal = partyCapacityRefusal("camp_42", 3);
    expect(refusal?.error).toContain("camp_42");
    expect(refusal?.error).toContain(String(MAX_ACTIVE_PARTY_MEMBERS));
  });
});

describe("MAX_ACTIVE_PARTY_MEMBERS", () => {
  it("is 3, per DC-PARTY-001 (1 main + up to 2 companions)", () => {
    expect(MAX_ACTIVE_PARTY_MEMBERS).toBe(3);
  });
});

describe("buildMainPartyMemberData", () => {
  it("returns the one shape every MAIN row must have", () => {
    expect(buildMainPartyMemberData("camp_1", "char_1")).toEqual({
      campaignId: "camp_1",
      characterId: "char_1",
      role: "MAIN",
      control: "USER",
    });
  });
});
