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
    // The body now also carries the correlation id (DC-AUD-002), which is
    // generated per submission and so cannot be written literally here.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaign/campaign-1/action",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "Attack", targetIds: ["enemy-1"], requestId }),
      })
    );
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

  it("adds selected targets to an external Attack request", async () => {
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

    fireEvent.click(getByRole("checkbox", { name: "Goblin Alpha10/10" }));
    fireEvent.click(getByRole("checkbox", { name: "Goblin Beta10/10" }));
    let requestId = "";
    act(() => {
      requestId = requestDungeonAction({ action: "Attack" });
    });

    await waitFor(() => expect(actionEndListener).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaign/campaign-1/action",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "Attack",
          targetIds: ["enemy-1", "enemy-2"],
          requestId,
        }),
      })
    );

    window.removeEventListener(DUNGEON_ACTION_END, actionEndListener);
  });

  it("attaches selected targets to an action the player typed", async () => {
    // The test above covers the external-event path, where another component
    // requests the action. This covers the other entry point: the player types
    // the action and presses the button. handleSubmit builds its own request,
    // so the selection reaching it is a separate guarantee — a spell aimed at
    // two creatures must not lose one of them on the way out.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`data: ${JSON.stringify({ t: "done" })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    const { getByRole, getByLabelText } = render(
      <ActionInput
        campaignId="campaign-1"
        selectableTargets={[
          { id: "enemy-1", name: "Goblin Alpha", hp: 10, maxHp: 10, isPlayer: false },
          { id: "enemy-2", name: "Goblin Beta", hp: 10, maxHp: 10, isPlayer: false },
        ]}
      />
    );

    fireEvent.click(getByRole("checkbox", { name: "Goblin Alpha10/10" }));
    fireEvent.click(getByRole("checkbox", { name: "Goblin Beta10/10" }));
    fireEvent.change(getByLabelText("Tu acción"), {
      target: { value: "Cast Magic Missile" },
    });
    fireEvent.click(getByRole("button", { name: "Actuar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      action: "Cast Magic Missile",
      targetIds: ["enemy-1", "enemy-2"],
    });
  });
});

/**
 * DC-AUD-002 — request id transport.
 *
 * `requestId` already exists on `DungeonActionRequestDetail` and correlates the
 * start/end/error events locally, but it never left the browser: `executeAction`
 * posted `detail.request` alone, so the server had no way to tell one submission
 * from a repeat of it. This suite pins the wire contract that DC-AUD-003 will
 * need — the identifier crossing the network, unchanged, exactly once.
 *
 * Transport only. Nothing here asserts deduplication, and none should be added
 * until idempotency is actually implemented.
 */
describe("ActionInput request id transport (DC-AUD-002)", () => {
  const okStream = () =>
    new Response(`data: ${JSON.stringify({ t: "done" })}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  /** The parsed JSON body of the one fetch the component issued. */
  const sentBody = (fetchMock: ReturnType<typeof vi.spyOn>): Record<string, unknown> =>
    JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);

  it("sends the exact client-generated requestId in the HTTP body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okStream());
    const actionEndListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_END, actionEndListener);
    render(<ActionInput campaignId="campaign-1" />);

    act(() => {
      requestDungeonAction(
        { action: "Attack", targetIds: ["enemy-1"] },
        "dungeon-action-test-123"
      );
    });

    await waitFor(() => expect(actionEndListener).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock)).toEqual({
      requestId: "dungeon-action-test-123",
      action: "Attack",
      targetIds: ["enemy-1"],
    });

    window.removeEventListener(DUNGEON_ACTION_END, actionEndListener);
  });

  it("transports targetX and targetY unchanged alongside the requestId", async () => {
    // The tactical-grid fields travel on the same body. A change to how that
    // body is built must not drop the coordinates that decide where a move or
    // an area spell lands.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okStream());
    const actionEndListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_END, actionEndListener);
    render(<ActionInput campaignId="campaign-1" />);

    act(() => {
      requestDungeonAction(
        { action: "Move", targetX: 4, targetY: 7 },
        "dungeon-action-test-456"
      );
    });

    await waitFor(() => expect(actionEndListener).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock)).toEqual({
      requestId: "dungeon-action-test-456",
      action: "Move",
      targetX: 4,
      targetY: 7,
    });

    window.removeEventListener(DUNGEON_ACTION_END, actionEndListener);
  });

  it("generates exactly one identifier for a typed submission, and sends that one", async () => {
    // The submit path mints its own id rather than receiving one. The id on the
    // wire must be the same one the local events carry: a second id generated
    // inside executeAction would look identical in the UI while making the
    // server unable to recognise the retry of a submission it already saw.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okStream());
    const endListener = vi.fn();
    window.addEventListener(DUNGEON_ACTION_END, endListener);
    const { getByRole, getByLabelText } = render(<ActionInput campaignId="campaign-1" />);

    fireEvent.change(getByLabelText("Tu acción"), { target: { value: "I open the door" } });
    fireEvent.click(getByRole("button", { name: "Actuar" }));

    await waitFor(() => expect(endListener).toHaveBeenCalledOnce());

    const ended = endListener.mock.calls[0]?.[0] as CustomEvent<DungeonActionRequestDetail>;
    const wireId = sentBody(fetchMock).requestId;

    expect(typeof wireId).toBe("string");
    expect(wireId).not.toBe("");
    expect(wireId).toBe(ended.detail.requestId);
    expect(fetchMock).toHaveBeenCalledOnce();

    window.removeEventListener(DUNGEON_ACTION_END, endListener);
  });
});
