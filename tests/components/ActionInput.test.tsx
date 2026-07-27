/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import ActionInput from "@/app/campaign/[id]/ActionInput";
import {
  DUNGEON_ACTION_END,
  requestDungeonAction,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";
import type { GameEvent } from "@/lib/events/game-events";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

describe("ActionInput shared SSE transport", () => {
  it("consumes a requested action stream and broadcasts deterministic events", async () => {
    const consequence: GameEvent = {
      type: "COMBAT_CONSEQUENCE",
      payload: {
        attackerName: "Aldric",
        targets: [
          {
            targetId: "enemy-1",
            targetName: "Goblin",
            damage: 4,
            naturalRoll: 16,
            isCrit: false,
            isFumble: false,
            hitLocation: "chest",
            narrativeTags: ["hit"],
            hpAfter: 3,
            targetMaxHp: 7,
            isKill: false,
            conditionsApplied: [],
          },
        ],
      },
    };
    const streamBody = [
      `data: ${JSON.stringify({ t: "evt", e: consequence })}`,
      `data: ${JSON.stringify({ t: "txt", d: "The blow lands." })}`,
      `data: ${JSON.stringify({ t: "done" })}`,
      "",
    ].join("\n\n");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const gameEventListener = vi.fn();
    const actionEndListener = vi.fn();
    window.addEventListener("dungeon-game-event", gameEventListener);
    window.addEventListener(DUNGEON_ACTION_END, actionEndListener);
    render(<ActionInput campaignId="campaign-1" />);

    let requestId = "";
    act(() => {
      requestId = requestDungeonAction({
        action: "Attack",
        targetIds: ["enemy-1"],
      });
    });

    await waitFor(() => expect(actionEndListener).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaign/campaign-1/action",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      action: "Attack", targetIds: ["enemy-1"], requestId,
    });
    const broadcast = gameEventListener.mock.calls[0]?.[0] as CustomEvent<{
      event: GameEvent;
    }>;
    expect(broadcast.detail.event).toEqual(consequence);
    const ended = actionEndListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    expect(ended.detail.requestId).toBe(requestId);
    expect(refreshMock).toHaveBeenCalledOnce();

    window.removeEventListener("dungeon-game-event", gameEventListener);
    window.removeEventListener(DUNGEON_ACTION_END, actionEndListener);
  });

  it("adds exactly one selected target to an external Attack request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`data: ${JSON.stringify({ t: "done" })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const actionEndListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_END, actionEndListener);
    const { getByRole } = render(
      <ActionInput
        campaignId="campaign-1"
        selectableTargets={[
          {
            id: "enemy-1",
            name: "Goblin Alpha",
            hp: 10,
            maxHp: 10,
            isPlayer: false,
          },
          {
            id: "enemy-2",
            name: "Goblin Beta",
            hp: 10,
            maxHp: 10,
            isPlayer: false,
          },
        ]}
      />
    );

    fireEvent.click(getByRole("radio", { name: "Goblin Alpha10/10" }));
    fireEvent.click(getByRole("radio", { name: "Goblin Beta10/10" }));
    act(() => {
      requestDungeonAction({ action: "Attack" });
    });

    await waitFor(() => expect(actionEndListener).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaign/campaign-1/action",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      action: "Attack", targetIds: ["enemy-2"], requestId: expect.any(String),
    });

    window.removeEventListener(DUNGEON_ACTION_END, actionEndListener);
  });
});
