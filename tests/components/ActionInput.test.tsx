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

/**
 * DC-AUD-003 — client retry identity.
 *
 * A persistent idempotency key on the server is inert if the client mints a new
 * one whenever the player retries. These tests pin the half that makes the
 * protocol usable: the exact submission survives transport uncertainty, and an
 * explicit retry resends the SAME requestId — including across repeated
 * ACTION_IN_FLIGHT answers, which is precisely when discarding it would be
 * worst, because the player's only remaining move would mint a fresh id and
 * bypass the protection the original one carries.
 */
describe("ActionInput retry identity (DC-AUD-003)", () => {
  const sse = (...streamFrames: unknown[]) =>
    new Response(
      streamFrames.map((f) => `data: ${JSON.stringify(f)}`).join("\n\n") + "\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );

  const jsonError = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const sentBodies = (fetchMock: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] =>
    (fetchMock.mock.calls as unknown as [unknown, RequestInit][]).map(([, init]) =>
      JSON.parse(init.body as string)
    );

  const sentIds = (fetchMock: ReturnType<typeof vi.spyOn>): unknown[] =>
    sentBodies(fetchMock).map((body) => body.requestId);

  /** Drives one externally requested action and waits for it to settle. */
  const submitExternal = async (
    request: Record<string, unknown>,
    requestId: string
  ): Promise<void> => {
    const ended = vi.fn();
    window.addEventListener(DUNGEON_ACTION_END, ended);
    act(() => {
      requestDungeonAction(request as never, requestId);
    });
    await waitFor(() => expect(ended).toHaveBeenCalled());
    window.removeEventListener(DUNGEON_ACTION_END, ended);
  };

  it("1. a transport failure retains the exact submission", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { getByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");

    // The affordance existing at all IS the retention: it renders only while a
    // retryable detail is held.
    expect(getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(sentIds(fetchMock)).toEqual(["R1"]);
  });

  it("2 & 5. the retry resends the same id and identical targeting data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { getByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal(
      { action: "Move", targetIds: ["enemy-1"], targetX: 4, targetY: 7 },
      "R1"
    );
    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [first, second] = sentBodies(fetchMock);
    expect(second).toEqual(first);
    expect(second).toMatchObject({
      requestId: "R1",
      action: "Move",
      targetIds: ["enemy-1"],
      targetX: 4,
      targetY: 7,
    });
  });

  it("3 & 4. repeated ACTION_IN_FLIGHT keeps the same id available to check again", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      // A fresh Response per call: a body is single-use, so reusing one
      // instance would make the second read fail and silently look like a
      // response that carried no `code` at all.
      .mockImplementation(async () =>
        jsonError(409, { error: "Aun sin confirmar.", code: "ACTION_IN_FLIGHT" })
      );
    const { getByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");

    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Still retained, now offering the in-flight wording.
    const recheck = await waitFor(() => getByRole("button", { name: "Comprobar de nuevo" }));
    fireEvent.click(recheck);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(sentIds(fetchMock)).toEqual(["R1", "R1", "R1"]);
    expect(getByRole("button", { name: "Comprobar de nuevo" })).toBeInTheDocument();
  });

  it("6. a duplicate that resolves clears the retry state", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => sse({ t: "duplicate", requestId: "R1" }, { t: "done" }));
    const { getByRole, queryByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");
    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await waitFor(() => {
      expect(queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
      expect(queryByRole("button", { name: "Comprobar de nuevo" })).not.toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("7. REQUEST_ID_REUSED is terminal and offers no retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () =>
        jsonError(409, {
          error: "Ese identificador ya corresponde a otra accion.",
          code: "REQUEST_ID_REUSED",
        })
      );
    const { getByRole, queryByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");
    fireEvent.click(getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await waitFor(() => {
      expect(queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
      expect(queryByRole("button", { name: "Comprobar de nuevo" })).not.toBeInTheDocument();
    });
  });

  it("8. an ordinary mechanical 4xx never offers a transport retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonError(400, { error: "No active encounter." })
    );
    const { queryByRole, findByRole } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack" }, "R1");

    expect(await findByRole("alert")).toHaveTextContent("No active encounter.");
    expect(queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Comprobar de nuevo" })).not.toBeInTheDocument();
  });

  it("10. a newer submission never causes a stale one to be resent", async () => {
    // State isolation, asserted at the level where it is actually observable.
    //
    // The clear on `done` is guarded by requestId, so R2 finishing does not
    // wipe the retained R1 from state. But the recovery panel lives inside the
    // streaming bubble, and ANY terminal outcome hides that bubble — so once
    // R2 settles, the retained R1 is no longer reachable from the UI either.
    //
    // What matters, and what this pins: the component never silently resends a
    // stale submission on its own. No automatic retry, ever.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => sse({ t: "done" }));
    const { getByRole, getByLabelText, queryByRole } = render(
      <ActionInput campaignId="campaign-1" />
    );

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");
    expect(getByRole("button", { name: "Reintentar" })).toBeInTheDocument();

    fireEvent.change(getByLabelText("Tu acción"), { target: { value: "I look around" } });
    fireEvent.click(getByRole("button", { name: "Actuar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Exactly two requests: R1 once, the new action once. R1 was not replayed
    // as a side effect of the new submission resolving.
    await waitFor(() =>
      expect(queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentIds(fetchMock)[0]).toBe("R1");
    expect(sentIds(fetchMock)[1]).not.toBe("R1");
  });

  it("11. the retry button never mislabels one submission as another", async () => {
    // If a second submission also ends uncertain, the retry slot describes THAT
    // one — and resends exactly it. The button must never claim to retry R1
    // while sending R2, or vice versa.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    const { getByRole, getByLabelText } = render(<ActionInput campaignId="campaign-1" />);

    await submitExternal({ action: "Attack", targetIds: ["enemy-1"] }, "R1");
    fireEvent.change(getByLabelText("Tu acción"), { target: { value: "I look around" } });
    fireEvent.click(getByRole("button", { name: "Actuar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondId = sentIds(fetchMock)[1];
    expect(secondId).not.toBe("R1");

    fireEvent.click(await waitFor(() => getByRole("button", { name: "Reintentar" })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Resends the submission the slot actually holds — the newer one — not a
    // stale R1 dressed up as it.
    const third = sentBodies(fetchMock)[2];
    expect(third.requestId).toBe(secondId);
    expect(third.action).toBe("I look around");
  });

  it("9. a genuinely new action is sent under a different id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => sse({ t: "done" }));
    const { getByRole, getByLabelText } = render(<ActionInput campaignId="campaign-1" />);

    fireEvent.change(getByLabelText("Tu acción"), { target: { value: "I open the door" } });
    fireEvent.click(getByRole("button", { name: "Actuar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(getByLabelText("Tu acción"), { target: { value: "I close the door" } });
    fireEvent.click(getByRole("button", { name: "Actuar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [first, second] = sentIds(fetchMock);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
