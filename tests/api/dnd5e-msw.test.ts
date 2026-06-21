import { describe, expect, it } from "vitest";

describe("D&D 5e API MSW fixtures", () => {
  it("serves goblin monster fixtures from MSW", async () => {
    const response = await fetch(
      "https://www.dnd5eapi.co/api/2014/monsters/goblin",
    );

    expect(response.ok).toBe(true);

    const json = await response.json();

    expect(json.index).toBe("goblin");
    expect(json.name).toBe("Goblin");
    expect(json.hit_points).toBe(7);
  });

  it("serves monsters index fixtures from MSW", async () => {
    const response = await fetch("https://www.dnd5eapi.co/api/2014/monsters");

    expect(response.ok).toBe(true);

    const json = await response.json();

    expect(json.results).toContainEqual(
      expect.objectContaining({ index: "goblin" }),
    );
  });
});