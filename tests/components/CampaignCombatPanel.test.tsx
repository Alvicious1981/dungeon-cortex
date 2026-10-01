/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CombatHUDController from "@/components/combat/CombatHUDController";
import MacroDeck from "@/components/combat/MacroDeck";
import ActionInput from "@/app/campaign/[id]/ActionInput";
import { DUNGEON_ACTION_END, DUNGEON_ACTION_START } from "@/lib/events/action-transport";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => vi.restoreAllMocks());

const combatants = [
  { id: "pc", name: "Mira", initiativeTotal: 23, hp: 10, maxHp: 10, isPlayer: true, conditions: [] },
  { id: "enemy", name: "Goblin", initiativeTotal: 11, hp: 7, maxHp: 7, isPlayer: false, conditions: [] },
];

function mount() {
  return render(
    <CombatHUDController combatants={combatants} activeTurnIndex={0}>
      <ActionInput campaignId="camp" selectableTargets={combatants} controls={<MacroDeck inCombat />} />
    </CombatHUDController>,
  );
}

describe("integrated combat panel", () => {
  it("offers one initiative list and one end-turn control through the existing action transport", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('data: {"t":"done"}\n\n'));
    mount();
    const panel = screen.getByRole("region", { name: "Panel de combate" });
    expect(within(panel).getAllByRole("region", { name: "Orden de iniciativa" })).toHaveLength(1);
    expect(within(panel).getByText("23")).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: "Finalizar turno" })).toHaveLength(1);
    expect(within(panel).queryByRole("button", { name: "Siguiente turno" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Finalizar turno" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ action: "End Turn" });
  });

  it("keeps received HP and turn changes visible until refreshed props arrive", () => {
    const { rerender } = mount();
    act(() => {
      window.dispatchEvent(new CustomEvent(DUNGEON_ACTION_START, { detail: { requestId: "one" } }));
      window.dispatchEvent(new CustomEvent("dungeon-game-event", { detail: { event: {
        type: "COMBAT_CONSEQUENCE", payload: { targets: [{ targetId: "enemy", hpAfter: 3, targetMaxHp: 7, conditionsApplied: ["prone"] }] },
      } } }));
      window.dispatchEvent(new CustomEvent("dungeon-game-event", { detail: { event: { type: "TURN_ADVANCE", payload: { nextTurnIndex: 1 } } } }));
      // A rejected second request must not unlock the pending first request.
      window.dispatchEvent(new CustomEvent(DUNGEON_ACTION_END, { detail: { requestId: "other" } }));
    });
    expect(screen.getByRole("button", { name: "Finalizar turno" })).toBeDisabled();
    act(() => window.dispatchEvent(new CustomEvent(DUNGEON_ACTION_END, { detail: { requestId: "one" } })));
    expect(screen.getByText("3 / 7 PG")).toBeInTheDocument();
    expect(screen.getByText("Derribado")).toBeInTheDocument();
    expect(screen.getByText("Turno de Goblin")).toBeInTheDocument();
    const entries = within(screen.getByRole("region", { name: "Orden de iniciativa" })).getAllByRole("listitem");
    expect(entries[1]).toHaveAttribute("aria-current", "true");
    rerender(<CombatHUDController combatants={combatants.map((c) => ({ ...c, hp: c.id === "enemy" ? 2 : c.hp }))} activeTurnIndex={0} />);
    expect(screen.getByText("2 / 7 PG")).toBeInTheDocument();
    expect(screen.queryByText("Derribado")).toBeNull();
  });
});
