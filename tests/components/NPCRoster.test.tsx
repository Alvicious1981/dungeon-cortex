/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NPCRoster from "@/components/NPCRoster";

afterEach(cleanup);

const npc = {
  id: "npc_1", name: "Greta the Ironmonger", role: "commoner",
  race: "human", profession: "smith", alignment: "neutral",
  hp: 9, maxHp: 9, ac: 11, notes: "", abilityScores: null, traits: null,
  disposition: 5, hasMetPlayer: true,
};

describe("NPCRoster", () => {
  it("announces the NPC when its row is activated", () => {
    const listener = vi.fn();
    window.addEventListener("dungeon-npc-selected", listener);

    render(<NPCRoster npcs={[npc]} />);
    fireEvent.click(screen.getByRole("button", { name: /Greta the Ironmonger/ }));

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({
      npcId: "npc_1",
      name: "Greta the Ironmonger",
      disposition: 5,
      hasMetPlayer: true,
    });

    window.removeEventListener("dungeon-npc-selected", listener);
  });
});
