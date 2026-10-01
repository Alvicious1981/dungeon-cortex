/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CombatHUDController from "@/components/combat/CombatHUDController";
import { DUNGEON_ACTION_END, DUNGEON_ACTION_START } from "@/lib/events/action-transport";

afterEach(cleanup);

/**
 * A fresh array on every call, like the payload `router.refresh()` hands the
 * controller: the props change by identity, whatever the values are.
 */
function snapshot(goblinHp: number) {
  return [
    { id: "pc", name: "Mira", initiativeTotal: 23, hp: 10, maxHp: 10, isPlayer: true, conditions: [] },
    { id: "enemy", name: "Goblin", initiativeTotal: 11, hp: goblinHp, maxHp: 7, isPlayer: false, conditions: [] },
  ];
}

const emit = (type: string, detail: unknown) => act(() => void window.dispatchEvent(new CustomEvent(type, { detail })));
const start = (requestId: string) => emit(DUNGEON_ACTION_START, { requestId });
const end = (requestId: string) => emit(DUNGEON_ACTION_END, { requestId });
const goblinTakesDamage = (hpAfter: number) =>
  emit("dungeon-game-event", {
    event: { type: "COMBAT_CONSEQUENCE", payload: { targets: [{ targetId: "enemy", hpAfter, targetMaxHp: 7, conditionsApplied: [] }] } },
  });
const turnAdvances = (nextTurnIndex: number) =>
  emit("dungeon-game-event", { event: { type: "TURN_ADVANCE", payload: { nextTurnIndex } } });

describe("CombatHUDController — props versus what the stream already showed", () => {
  it("does not let a refresh that lands mid-request take back the streamed HP", () => {
    const { rerender } = render(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    start("two");
    goblinTakesDamage(3);
    expect(screen.getByText("3 / 7 PG")).toBeInTheDocument();

    // The previous action's refresh lands now, with state older than the stream.
    rerender(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    expect(screen.queryByText("7 / 7 PG")).toBeNull();
    expect(screen.getByText("3 / 7 PG")).toBeInTheDocument();

    // Ending the request must not apply those stale props either: this request's
    // own refresh is still in flight and will land after the end event.
    end("two");
    expect(screen.getByText("3 / 7 PG")).toBeInTheDocument();

    // Props that arrive while nothing is pending are the new truth.
    rerender(<CombatHUDController combatants={snapshot(2)} activeTurnIndex={0} />);
    expect(screen.getByText("2 / 7 PG")).toBeInTheDocument();
  });

  it("does not let a stale refresh move the turn back mid-request", () => {
    const { rerender } = render(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    start("one");
    turnAdvances(1);
    expect(screen.getByText("Turno de Goblin")).toBeInTheDocument();

    rerender(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    expect(screen.getByText("Turno de Goblin")).toBeInTheDocument();
    end("one");
    expect(screen.getByText("Turno de Goblin")).toBeInTheDocument();
  });

  it("applies a refresh that landed mid-request once it ends, if the stream changed nothing", () => {
    // A refused request: no consequence event, no refresh of its own. The only
    // thing that can bring the HUD up to date is the refresh that landed meanwhile.
    const { rerender } = render(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    start("refused");
    rerender(<CombatHUDController combatants={snapshot(4)} activeTurnIndex={0} />);
    end("refused");
    expect(screen.getByText("4 / 7 PG")).toBeInTheDocument();
  });

  it("judges 'the stream changed something' per run of requests, not for the whole session", () => {
    const { rerender } = render(<CombatHUDController combatants={snapshot(7)} activeTurnIndex={0} />);
    // Request one streams a change and ends; its refresh is still in flight.
    start("one");
    goblinTakesDamage(3);
    end("one");
    // Request two is refused. Meanwhile one's refresh lands, carrying a change
    // the stream never showed (2, not 3). Nothing else will deliver it.
    start("two");
    rerender(<CombatHUDController combatants={snapshot(2)} activeTurnIndex={0} />);
    end("two");
    expect(screen.getByText("2 / 7 PG")).toBeInTheDocument();
  });
});
