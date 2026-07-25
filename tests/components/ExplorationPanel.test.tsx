/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import ExplorationPanel from "@/components/exploration/ExplorationPanel";
import {
  DUNGEON_ACTION_REQUEST,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

afterEach(() => cleanup());

describe("ExplorationPanel action transport", () => {
  it("requests exploration movement through the shared stream", () => {
    const requestListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_REQUEST, requestListener);
    render(
      <ExplorationPanel
        location={{ id: "loc-1", name: "Crypt", type: "dungeon", description: "Old stones" }}
        nodes={[
          { index: 0, name: "Entry", description: "Door", feature: "empty", npcSeed: null, x: 0, y: 0 },
          { index: 1, name: "Vault", description: "Cold room", feature: "treasure", npcSeed: null, x: 1, y: 0 },
        ]}
        edges={[{ fromIndex: 0, toIndex: 1, passageType: "open" }]}
        initialCurrentNodeIndex={0}
        initialVisitedNodeIndices={[0]}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Move to Vault via Open passage" })
    );

    expect(requestListener).toHaveBeenCalledOnce();
    const event = requestListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(event.detail.request).toEqual({ action: "move to Vault" });
    window.removeEventListener(DUNGEON_ACTION_REQUEST, requestListener);
  });
});
