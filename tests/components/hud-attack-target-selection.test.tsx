/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import CombatHUDController from "@/components/combat/CombatHUDController";
import ActionInput from "@/app/campaign/[id]/ActionInput";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_ERROR,
  type DungeonActionErrorDetail,
} from "@/lib/events/action-transport";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

const goblin = { id: "enemy-1", name: "Goblin", hp: 7, maxHp: 7, isPlayer: false };
const orc = { id: "enemy-2", name: "Orco", hp: 15, maxHp: 15, isPlayer: false };
const hero = { id: "player-1", name: "Aldric", hp: 12, maxHp: 12, isPlayer: true };
const targets = [hero, goblin, orc];

function mockActionStream() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(`data: ${JSON.stringify({ t: "done" })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
  );
}

function renderCombat() {
  // Same pieces app/campaign/[id]/page.tsx wires together.
  return render(
    <>
      <CombatHUDController
        combatants={targets.map((t, i) => ({
          id: t.id,
          name: t.name,
          hp: t.hp,
          maxHp: t.maxHp,
          initiativeTotal: 20 - i,
          conditions: [],
        }))}
        activeTurnIndex={0}
      />
      <ActionInput campaignId="campaign-1" selectableTargets={targets} />
    </>
  );
}

function tick(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
}

function pressHudAttack() {
  fireEvent.click(screen.getByRole("button", { name: "Attack (F1)" }));
}

describe("HUD Attack (F1) needs exactly one target", () => {
  it("attacks the single target ticked in Objetivos", async () => {
    const fetchMock = mockActionStream();
    renderCombat();

    tick("Orco");
    pressHudAttack();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      action: "Attack",
      targetIds: ["enemy-2"],
    });
    expect(screen.queryByText(/Selecciona exactamente un objetivo/)).not.toBeInTheDocument();
  });

  it.each([
    ["no target", [] as string[]],
    ["two targets", ["Goblin", "Orco"]],
  ])("refuses with %s and sends nothing", async (_label, names) => {
    const fetchMock = mockActionStream();
    const errors: string[] = [];
    const onError = (e: Event) =>
      errors.push((e as CustomEvent<DungeonActionErrorDetail>).detail.error);
    const onEnd = vi.fn();
    window.addEventListener(DUNGEON_ACTION_ERROR, onError);
    window.addEventListener(DUNGEON_ACTION_END, onEnd);
    renderCombat();

    names.forEach(tick);
    pressHudAttack();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selecciona exactamente un objetivo para atacar."
    );
    expect(errors).toEqual(["Selecciona exactamente un objetivo para atacar."]);
    // The HUD leaves its pending state once the refusal ends the request.
    expect(onEnd).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Attack (F1)" })).not.toBeDisabled()
    );
    expect(fetchMock).not.toHaveBeenCalled();

    window.removeEventListener(DUNGEON_ACTION_ERROR, onError);
    window.removeEventListener(DUNGEON_ACTION_END, onEnd);
  });
});
