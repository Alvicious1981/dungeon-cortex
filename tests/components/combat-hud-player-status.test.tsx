/** @vitest-environment jsdom */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CombatHUD from "@/components/combat/CombatHUD";
import CombatHUDController from "@/components/combat/CombatHUDController";

afterEach(cleanup);

const PLAYER = { id: "pc", name: "Mira", initiativeTotal: 18, hp: 6, maxHp: 10, isPlayer: true, conditions: ["prone"] };
const GOBLIN = { id: "gob", name: "Goblin", initiativeTotal: 11, hp: 7, maxHp: 7, isPlayer: false, conditions: [] };

function renderHud(
  props: Partial<React.ComponentProps<typeof CombatHUD>> = {},
  combatants: React.ComponentProps<typeof CombatHUD>["combatants"] = [PLAYER, GOBLIN],
) {
  return render(
    <CombatHUD
      combatants={combatants}
      activeTurnIndex={0}
      isPending={false}
      onActionTrigger={vi.fn()}
      {...props}
    />,
  );
}

const playerRegion = () => screen.getByRole("region", { name: "Estado del jugador" });
/** The slot rows only: the player's conditions are list items too, so the region alone would mix them. */
const slotItems = () =>
  within(within(playerRegion()).getByRole("list", { name: "Espacios de conjuro" })).getAllByRole("listitem");
const emit = (type: string, detail: unknown) => act(() => void window.dispatchEvent(new CustomEvent(type, { detail })));
const playerTakesDamage = (hpAfter: number) =>
  emit("dungeon-game-event", {
    event: { type: "COMBAT_CONSEQUENCE", payload: { targets: [{ targetId: "pc", hpAfter, targetMaxHp: 10, conditionsApplied: [] }] } },
  });

describe("CombatHUD — player status block", () => {
  it("shows the player's own hit points as text, not an enemy's", () => {
    renderHud();
    const region = playerRegion();
    expect(within(region).getByText("Puntos de golpe")).toBeInTheDocument();
    expect(within(region).getByText("6 / 10")).toBeInTheDocument();
    expect(within(region).queryByText("7 / 7")).toBeNull();
  });

  it("exposes the same value as a labelled meter, with a width that follows the ratio", () => {
    renderHud();
    const meter = within(playerRegion()).getByRole("meter", { name: "Puntos de golpe: 6 de 10" });
    expect(meter).toHaveAttribute("aria-valuenow", "6");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
    expect((meter.firstElementChild as HTMLElement).style.width).toBe("60%");
    // The fill takes its colour from hpColor, not from a literal in the HUD.
    expect((meter.firstElementChild as HTMLElement).style.background).toBe("var(--dc-success)");
  });

  it("lists the player's conditions with their Spanish labels", () => {
    renderHud();
    expect(within(playerRegion()).getByText("Derribado")).toBeInTheDocument();
  });

  it("renders no status block when no combatant is the player", () => {
    renderHud({}, [{ ...PLAYER, isPlayer: undefined }, GOBLIN]);
    expect(screen.queryByRole("region", { name: "Estado del jugador" })).toBeNull();
  });

  it("keeps the block at 0 HP for a downed player, next to the existing pointer to the death-save action", () => {
    renderHud({ playerDown: true }, [{ ...PLAYER, hp: 0 }, GOBLIN]);
    const meter = within(playerRegion()).getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect((meter.firstElementChild as HTMLElement).style.width).toBe("0%");
    expect(screen.getByText(/Estás inconsciente/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("follows damage streamed through targets[] before the server snapshot arrives", () => {
    render(<CombatHUDController combatants={[PLAYER, GOBLIN]} activeTurnIndex={0} />);
    expect(within(playerRegion()).getByText("6 / 10")).toBeInTheDocument();
    playerTakesDamage(2);
    expect(within(playerRegion()).getByText("2 / 10")).toBeInTheDocument();
    const meter = within(playerRegion()).getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect((meter.firstElementChild as HTMLElement).style.background).toBe("var(--dc-error)");
  });
});

describe("CombatHUD — player resources only when real data exists", () => {
  const slots = [
    { level: 1, total: 3, used: 1 },
    { level: 2, total: 2, used: 2 },
  ];

  it("lists spell slots by level as text, available out of total", () => {
    renderHud({ playerResources: { spellSlots: slots } });
    const items = slotItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Nv 1");
    expect(items[0]).toHaveTextContent("2 de 3 disponibles");
    expect(items[1]).toHaveTextContent("Nv 2");
    expect(items[1]).toHaveTextContent("0 de 2 disponibles");
  });

  it("uses the singular when a level has exactly one slot", () => {
    renderHud({ playerResources: { spellSlots: [{ level: 9, total: 1, used: 0 }, { level: 1, total: 2, used: 0 }] } });
    const items = slotItems();
    expect(items[0]).toHaveTextContent("Nv 1");
    expect(items[0]).toHaveTextContent("2 de 2 disponibles");
    expect(items[1]).toHaveTextContent("1 de 1 disponible");
    expect(items[1]).not.toHaveTextContent("disponibles");
  });

  it("orders the levels ascending whatever order they arrive in", () => {
    renderHud({ playerResources: { spellSlots: [{ level: 3, total: 1, used: 0 }, { level: 1, total: 4, used: 0 }] } });
    const items = slotItems();
    expect(items[0]).toHaveTextContent("Nv 1");
    expect(items[1]).toHaveTextContent("Nv 3");
  });

  it("never shows a negative number when used exceeds total", () => {
    renderHud({ playerResources: { spellSlots: [{ level: 1, total: 2, used: 5 }] } });
    expect(slotItems()[0]).toHaveTextContent("0 de 2 disponibles");
  });

  it.each([
    ["no resources prop", undefined],
    ["an empty slot list", { spellSlots: [] }],
    ["only levels with no slots", { spellSlots: [{ level: 1, total: 0, used: 0 }] }],
  ])("renders no slot list for %s", (_label, playerResources) => {
    renderHud({ playerResources });
    expect(screen.queryByRole("list", { name: "Espacios de conjuro" })).toBeNull();
    expect(screen.queryByText(/disponibles/)).toBeNull();
  });

  it("shows Concentración only while the player is concentrating", () => {
    const { rerender } = renderHud({ playerResources: { concentrating: true } });
    expect(within(playerRegion()).getByText("Concentración")).toBeInTheDocument();
    rerender(
      <CombatHUD combatants={[PLAYER, GOBLIN]} activeTurnIndex={0} isPending={false} onActionTrigger={vi.fn()} playerResources={{ concentrating: false }} />,
    );
    expect(screen.queryByText("Concentración")).toBeNull();
  });

  it("passes the resources through the controller", () => {
    render(
      <CombatHUDController combatants={[PLAYER, GOBLIN]} activeTurnIndex={0} playerResources={{ spellSlots: slots }} />,
    );
    expect(slotItems()).toHaveLength(2);
  });

  it("keeps the server snapshot of the slots while the stream streams damage (the stream carries no slot data)", () => {
    const { rerender } = render(
      <CombatHUDController combatants={[PLAYER, GOBLIN]} activeTurnIndex={0} playerResources={{ spellSlots: slots }} />,
    );
    playerTakesDamage(3);
    expect(slotItems()[0]).toHaveTextContent("2 de 3 disponibles");
    rerender(
      <CombatHUDController
        combatants={[PLAYER, GOBLIN]}
        activeTurnIndex={0}
        playerResources={{ spellSlots: [{ level: 1, total: 3, used: 2 }] }}
      />,
    );
    expect(slotItems()).toHaveLength(1);
    expect(slotItems()[0]).toHaveTextContent("1 de 3 disponibles");
  });
});

describe("CombatHUD — active turn", () => {
  it("announces whose turn it is in a status region and marks the player's own turn with text", () => {
    renderHud();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Turno de Mira");
    expect(within(status).getByText("Tu turno")).toBeInTheDocument();
  });

  it("does not say «Tu turno» on an enemy's turn", () => {
    renderHud({ activeTurnIndex: 1 });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Turno de Goblin");
    expect(within(status).queryByText("Tu turno")).toBeNull();
  });

  it("falls back to «Esperando turno» when no combatant is active", () => {
    renderHud({ activeTurnIndex: 5 });
    expect(screen.getByRole("status")).toHaveTextContent("Esperando turno");
  });
});

describe("CombatHUD — reading order and the actions slot", () => {
  it("orders the header, the player block, the initiative list and then the actions slot", () => {
    renderHud({ children: <button type="button">Acción de prueba</button> });
    const status = screen.getByRole("status");
    const player = playerRegion();
    const initiative = screen.getByRole("region", { name: "Orden de iniciativa" });
    const slot = document.querySelector('[data-combat-hud-slot="actions"]') as HTMLElement;

    expect(slot).not.toBeNull();
    expect(within(slot).getByRole("button", { name: "Acción de prueba" })).toBeInTheDocument();
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(status, player)).toBe(true);
    expect(before(player, initiative)).toBe(true);
    expect(before(initiative, slot)).toBe(true);
  });

  it("renders one initiative list and the actions slot empty when there are no children", () => {
    renderHud();
    expect(screen.getAllByRole("region", { name: "Orden de iniciativa" })).toHaveLength(1);
    expect(document.querySelector('[data-combat-hud-slot="actions"]')?.childElementCount).toBe(0);
  });
});
