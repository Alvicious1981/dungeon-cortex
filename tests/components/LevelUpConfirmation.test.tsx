/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import ActionInput from "@/app/campaign/[id]/ActionInput";
import LevelUpConfirmationController from "@/components/character/LevelUpConfirmation";
import {
  DUNGEON_ACTION_END,
  requestDungeonAction,
} from "@/lib/events/action-transport";
import type { LevelUpAvailablePayload } from "@/lib/actions/backend-presentation-resolution";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
// A pending payload as the backend emits it, and an applied payload as
// applyLevelUp returns it. They are never interchangeable.

const AVAILABLE: LevelUpAvailablePayload = {
  characterId: "char-1",
  className: "fighter",
  hitDie: "1d10",
  fromLevel: 1,
  toLevel: 2,
  targetLevel: 2,
  pendingLevels: 1,
  conModifier: 2,
  currentMaxHp: 12,
  currentHitDiceTotal: 1,
  requiresPlayerConfirmation: true,
};

/** Three levels of XP banked; the backend still only offers the next step. */
const AVAILABLE_MULTI: LevelUpAvailablePayload = {
  ...AVAILABLE,
  fromLevel: 2,
  toLevel: 3,
  targetLevel: 5,
  pendingLevels: 3,
  currentMaxHp: 21,
  currentHitDiceTotal: 2,
};

/** The frame the backend emits after 2 → 3 has actually been applied. */
const AVAILABLE_AFTER_APPLY: LevelUpAvailablePayload = {
  ...AVAILABLE,
  fromLevel: 3,
  toLevel: 4,
  targetLevel: 5,
  pendingLevels: 2,
  currentMaxHp: 30,
  currentHitDiceTotal: 3,
};

const APPLIED = {
  characterId: "char-1",
  previousLevel: 1,
  newLevel: 2,
  hitDie: "1d10",
  hpRoll: 7,
  conModifier: 2,
  hpGained: 9,
  previousMaxHp: 12,
  newMaxHp: 21,
  newHitDiceTotal: 2,
  className: "fighter",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitAvailable(payload: LevelUpAvailablePayload = AVAILABLE) {
  act(() => {
    window.dispatchEvent(new CustomEvent("dungeon-level-up-available", { detail: payload }));
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Captures every dispatch of an event for the duration of one test. */
function listen(eventName: string) {
  const spy = vi.fn();
  window.addEventListener(eventName, spy);
  return {
    spy,
    stop: () => window.removeEventListener(eventName, spy),
  };
}

const averageButton = () => screen.getByRole("button", { name: /promedio/i }) as HTMLButtonElement;
const rollButton = () => screen.getByRole("button", { name: /tirar/i }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

// ─── A. ActionInput frame branch ─────────────────────────────────────────────

describe("A. ActionInput — level_up_available frame", () => {
  async function streamFrames(frames: unknown[]) {
    const body = [...frames.map((f) => `data: ${JSON.stringify(f)}`), ""].join("\n\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    const ended = listen(DUNGEON_ACTION_END);
    render(<ActionInput campaignId="campaign-1" />);
    act(() => {
      requestDungeonAction({ action: "I press on." });
    });
    await waitFor(() => expect(ended.spy).toHaveBeenCalledTimes(1));
    ended.stop();
  }

  it("A1. dispatches dungeon-level-up-available, not dungeon-level-up", async () => {
    const available = listen("dungeon-level-up-available");
    const applied = listen("dungeon-level-up");

    await streamFrames([{ t: "level_up_available", payload: AVAILABLE }, { t: "done" }]);

    expect(available.spy).toHaveBeenCalledTimes(1);
    expect((available.spy.mock.calls[0][0] as CustomEvent).detail).toEqual(AVAILABLE);
    expect(applied.spy).not.toHaveBeenCalled();

    available.stop();
    applied.stop();
  });

  it("A2. keeps the applied level_up frame on its original event", async () => {
    const available = listen("dungeon-level-up-available");
    const applied = listen("dungeon-level-up");

    await streamFrames([{ t: "level_up", payload: APPLIED }, { t: "done" }]);

    expect(applied.spy).toHaveBeenCalledTimes(1);
    expect((applied.spy.mock.calls[0][0] as CustomEvent).detail).toEqual(APPLIED);
    expect(available.spy).not.toHaveBeenCalled();

    available.stop();
    applied.stop();
  });
});

// ─── B. Panel presentation ───────────────────────────────────────────────────

describe("B. LevelUpConfirmation — presentation", () => {
  it("B1. renders nothing until a pending level-up arrives", () => {
    const { container } = render(<LevelUpConfirmationController campaignId="campaign-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("B2. shows only information known before applying — never a computed hit point", () => {
    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("1 → 2")).toBeTruthy();
    expect(screen.getByText("1d10")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    // Nothing that only exists after the server rolls.
    // `newHitDiceTotal` is deliberately absent from this scan: under Model E it
    // always equals the new level, so it is textually indistinguishable from
    // `toLevel` and a substring check on it would prove nothing.
    const text = screen.getByRole("dialog").textContent ?? "";
    for (const unknownValue of [
      String(APPLIED.hpRoll),
      String(APPLIED.hpGained),
      String(APPLIED.newMaxHp),
    ]) {
      expect(text).not.toContain(unknownValue);
    }
    expect(text).not.toMatch(/rolled|tirada obtenida/i);
  });

  it("B4. renders the hit-dice cell from currentHitDiceTotal, not toLevel", () => {
    // The fixture must keep these distinct or this test cannot tell a
    // regression from coincidence.
    expect(AVAILABLE.currentHitDiceTotal).not.toBe(AVAILABLE.toLevel);

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();

    const hitDiceTerm = screen.getByText("Dados de golpe", { selector: "dt" });
    expect(hitDiceTerm.nextElementSibling).toHaveTextContent(
      String(AVAILABLE.currentHitDiceTotal)
    );
    expect(hitDiceTerm.nextElementSibling).not.toHaveTextContent(String(AVAILABLE.toLevel));
  });

  it("B3. issues no POST when the frame arrives — confirmation is the player's", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── C. Request contract ─────────────────────────────────────────────────────

describe("C. LevelUpConfirmation — request contract", () => {
  it("C1. sends { useAverage: true } when the player takes the average", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ payload: APPLIED }));
    render(<LevelUpConfirmationController campaignId="campaign-7" />);
    emitAvailable();

    fireEvent.click(averageButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/campaign/campaign-7/level-up",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ useAverage: true }) })
    );
  });

  it("C2. sends { useAverage: false } and nothing else when the player rolls", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ payload: APPLIED }));
    render(<LevelUpConfirmationController campaignId="campaign-7" />);
    emitAvailable(AVAILABLE_MULTI);

    fireEvent.click(rollButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // The single authority bit, and no smuggled level or hit-point field.
    expect(body).toEqual({ useAverage: false });
    expect(Object.keys(body)).toEqual(["useAverage"]);
  });

  it("C3. uses the campaignId passed as a prop", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ payload: APPLIED }));
    render(<LevelUpConfirmationController campaignId="explicit-prop-id" />);
    emitAvailable();

    fireEvent.click(averageButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/campaign/explicit-prop-id/level-up");
  });

  it("C4. disables both buttons while the request is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      })
    );
    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();

    fireEvent.click(averageButton());

    await waitFor(() => expect(averageButton().disabled).toBe(true));
    expect(rollButton().disabled).toBe(true);

    await act(async () => {
      resolve(jsonResponse({ payload: APPLIED }));
    });
  });
});

// ─── D. Success ──────────────────────────────────────────────────────────────

describe("D. LevelUpConfirmation — applied", () => {
  it("D1. dispatches exactly one dungeon-level-up after a 200, carrying the server payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ payload: APPLIED }));
    const applied = listen("dungeon-level-up");

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(rollButton());

    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));
    const detail = (applied.spy.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual(APPLIED);
    // The celebration never sees the pending payload.
    expect(detail).not.toHaveProperty("requiresPlayerConfirmation");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    applied.stop();
  });

  it("D2. does not dispatch dungeon-level-up before the response arrives", async () => {
    let resolve!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      })
    );
    const applied = listen("dungeon-level-up");

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(averageButton());

    await waitFor(() => expect(averageButton().disabled).toBe(true));
    expect(applied.spy).not.toHaveBeenCalled();

    await act(async () => {
      resolve(jsonResponse({ payload: APPLIED }));
    });
    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));

    applied.stop();
  });

  it("D3. treats a 200 without payload as a failure, never as an ascension", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    const applied = listen("dungeon-level-up");

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(rollButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(applied.spy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();

    applied.stop();
  });
});

// ─── E. Stale payload: 401 / 404 / 409 / 422 ─────────────────────────────────

describe("E. LevelUpConfirmation — stale payload closes and resynchronises", () => {
  const cases: Array<[number, unknown]> = [
    [401, { error: "Unauthorized" }],
    [404, { error: "Campaign not found." }],
    [409, { error: "There is no pending level-up to apply.", code: "INVALID_LEVEL_UP_STATE" }],
    [422, { error: "The stored progression state is inconsistent.", code: "INVALID_CHARACTER_XP" }],
  ];

  it.each(cases)(
    "E. %i discards the payload, closes the panel and offers no retry",
    async (status, body) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(body, status as number));
      const applied = listen("dungeon-level-up");

      render(<LevelUpConfirmationController campaignId="campaign-1" />);
      emitAvailable();
      fireEvent.click(rollButton());

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // A non-modal notice replaces it, holding no payload.
      const notice = screen.getByRole("status");
      expect(notice).toBeTruthy();
      expect(notice.getAttribute("aria-modal")).toBeNull();

      // No control here can repeat the dead request.
      expect(screen.queryByRole("button", { name: /promedio/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /tirar/i })).toBeNull();

      expect(applied.spy).not.toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalledTimes(1);

      applied.stop();
    }
  );

  it("E5. the notice is dismissible and never reopens the panel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "gone" }, 409));
    const { container } = render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(rollButton());

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /cerrar aviso/i }));

    expect(container).toBeEmptyDOMElement();
  });
});

// ─── F. Recoverable failures: 400 / 500 / network ────────────────────────────

describe("F. LevelUpConfirmation — recoverable failures keep the panel", () => {
  it("F1. 500 keeps the dialog open, shows the reason and allows a manual retry", async () => {
    const applied = listen("dungeon-level-up");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(jsonResponse({ payload: APPLIED }));

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(averageButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(applied.spy).not.toHaveBeenCalled();
    // Exactly one attempt so far: nothing retried on its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Buttons are usable again — the retry is the player's.
    expect(averageButton().disabled).toBe(false);
    fireEvent.click(averageButton());

    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    applied.stop();
  });

  it("F2. 400 keeps the dialog open without resynchronising", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Invalid request body.", code: "INVALID_BODY" }, 400)
    );
    const applied = listen("dungeon-level-up");

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(rollButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(applied.spy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();

    applied.stop();
  });

  it("F3. a network failure keeps the dialog open and permits another attempt", async () => {
    const applied = listen("dungeon-level-up");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ payload: APPLIED }));

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable();
    fireEvent.click(rollButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(applied.spy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(rollButton());
    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));

    applied.stop();
  });
});

// ─── G. Multiple pending ascensions ──────────────────────────────────────────

describe("G. LevelUpConfirmation — several pending levels", () => {
  it("G1. confirms one level only and waits for the backend before offering the next", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ payload: { ...APPLIED, previousLevel: 2, newLevel: 3 } }));
    const applied = listen("dungeon-level-up");

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    // level 2, targetLevel 5, three pending — the backend still offers 2 → 3.
    emitAvailable(AVAILABLE_MULTI);

    expect(screen.getByText("2 → 3")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).not.toContain("3 → 4");

    fireEvent.click(rollButton());
    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));

    // Exactly one POST, and no fabricated follow-up panel.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Only a fresh backend-authorized frame may present the next level.
    emitAvailable(AVAILABLE_AFTER_APPLY);
    expect(screen.getByText("3 → 4")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    applied.stop();
  });
});

// ─── H. Integrated UI flow ───────────────────────────────────────────────────

describe("H. Flujo integrado UI", () => {
  it("H1. available → choose → POST → applied → celebration, without mixing payloads", async () => {
    const available = listen("dungeon-level-up-available");
    const applied = listen("dungeon-level-up");

    // 1) The action stream announces availability.
    const streamBody = [
      `data: ${JSON.stringify({ t: "level_up_available", payload: AVAILABLE })}`,
      `data: ${JSON.stringify({ t: "txt", d: "El poder crece." })}`,
      `data: ${JSON.stringify({ t: "done" })}`,
      "",
    ].join("\n\n");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(streamBody, { status: 200, headers: { "Content-Type": "text/event-stream" } })
      )
      .mockResolvedValueOnce(jsonResponse({ payload: APPLIED }));

    const ended = listen(DUNGEON_ACTION_END);

    render(
      <>
        <ActionInput campaignId="campaign-9" />
        <LevelUpConfirmationController campaignId="campaign-9" />
      </>
    );

    act(() => {
      requestDungeonAction({ action: "I press on." });
    });
    await waitFor(() => expect(ended.spy).toHaveBeenCalledTimes(1));

    // 2) The decision panel appears, with no applied numbers.
    expect(available.spy).toHaveBeenCalledTimes(1);
    expect(applied.spy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain(String(APPLIED.newMaxHp));

    // 3) The player chooses, 4) the server applies.
    fireEvent.click(rollButton());
    await waitFor(() => expect(applied.spy).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/campaign/campaign-9/level-up",
      expect.objectContaining({ body: JSON.stringify({ useAverage: false }) })
    );

    // 5) Only the applied payload reaches the celebration, and the panel is gone.
    expect((applied.spy.mock.calls[0][0] as CustomEvent).detail).toEqual(APPLIED);
    expect(screen.queryByRole("dialog")).toBeNull();

    ended.stop();
    available.stop();
    applied.stop();
  });
});

// ─── I. Concurrent frames ────────────────────────────────────────────────────

describe("I. LevelUpConfirmation — concurrent level_up_available frames", () => {
  it("I1. replaces the payload wholesale when no confirmation is in flight", () => {
    render(<LevelUpConfirmationController campaignId="campaign-1" />);

    emitAvailable(AVAILABLE_MULTI);
    expect(screen.getByText("2 → 3")).toBeTruthy();

    // Fresher backend state supersedes the previous frame entirely.
    emitAvailable(AVAILABLE_AFTER_APPLY);

    const dialog = screen.getByRole("dialog");
    expect(screen.getByText("3 → 4")).toBeTruthy();
    expect(dialog.textContent).not.toContain("2 → 3");
    // Displayed values come from the new payload, never merged with the old one.
    expect(screen.getByText(String(AVAILABLE_AFTER_APPLY.currentMaxHp))).toBeTruthy();
    expect(dialog.textContent).not.toContain(String(AVAILABLE_MULTI.currentMaxHp));
  });

  it("I2. does not swap the payload the player is confirming", async () => {
    let resolve!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      })
    );

    render(<LevelUpConfirmationController campaignId="campaign-1" />);
    emitAvailable(AVAILABLE_MULTI);
    fireEvent.click(rollButton());
    await waitFor(() => expect(rollButton().disabled).toBe(true));

    // A frame arriving mid-flight must not move the ground under the request.
    emitAvailable(AVAILABLE_AFTER_APPLY);
    expect(screen.getByText("2 → 3")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).not.toContain("3 → 4");

    await act(async () => {
      resolve(jsonResponse({ payload: { ...APPLIED, previousLevel: 2, newLevel: 3 } }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
