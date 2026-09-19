/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import CombatHUD from "@/components/combat/CombatHUD";
import CombatHUDController from "@/components/combat/CombatHUDController";
import {
  DUNGEON_ACTION_REQUEST,
  DUNGEON_ACTION_START,
  type DungeonActionRequestDetail,
} from "@/lib/events/action-transport";

const COMBATANTS = [
  { id: "p1", name: "Aldric", hp: 12, maxHp: 12, initiativeTotal: 14, conditions: [] },
  { id: "g1", name: "Goblin", hp: 7, maxHp: 7, initiativeTotal: 9, conditions: [] },
];

let requests: DungeonActionRequestDetail[];
function recordRequest(event: Event) {
  requests.push((event as CustomEvent<DungeonActionRequestDetail>).detail);
}

beforeEach(() => {
  requests = [];
  window.addEventListener(DUNGEON_ACTION_REQUEST, recordRequest);
});

afterEach(() => {
  window.removeEventListener(DUNGEON_ACTION_REQUEST, recordRequest);
  cleanup();
});

function renderController(props: { playerDown?: boolean } = {}) {
  return render(
    <CombatHUDController combatants={COMBATANTS} activeTurnIndex={0} {...props} />
  );
}

describe("CombatHUD keyboard shortcuts", () => {
  it("F1 requests the Attack action", () => {
    renderController();
    fireEvent.keyDown(window, { key: "F1" });
    expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
  });

  it("F2 requests the End Turn action", () => {
    renderController();
    fireEvent.keyDown(window, { key: "F2" });
    expect(requests.map((r) => r.request)).toEqual([{ action: "End Turn" }]);
  });

  it("prevents the browser default (F1 help) when it handles the key", () => {
    renderController();
    const event = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing while an action is pending (button disabled)", () => {
    const { getByRole } = renderController();
    act(() => {
      window.dispatchEvent(new CustomEvent(DUNGEON_ACTION_START));
    });
    expect((getByRole("button", { name: "Attack (F1)" }) as HTMLButtonElement).disabled).toBe(true);

    const event = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(requests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing while the player is down (buttons not offered)", () => {
    renderController({ playerDown: true });
    fireEvent.keyDown(window, { key: "F1" });
    fireEvent.keyDown(window, { key: "F2" });
    expect(requests).toEqual([]);
  });

  it("ignores the keys while typing in a text field", () => {
    renderController();
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, editable);
    try {
      fireEvent.keyDown(input, { key: "F1" });
      fireEvent.keyDown(textarea, { key: "F2" });
      fireEvent.keyDown(editable, { key: "F1" });
      expect(requests).toEqual([]);
    } finally {
      input.remove();
      textarea.remove();
      editable.remove();
    }
  });

  it("ignores the keys when a modifier is held", () => {
    renderController();
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    fireEvent.keyDown(window, { key: "F1", altKey: true });
    fireEvent.keyDown(window, { key: "F2", shiftKey: true });
    fireEvent.keyDown(window, { key: "F2", metaKey: true });
    expect(requests).toEqual([]);
  });

  it("removes the listener on unmount", () => {
    const onActionTrigger = vi.fn();
    const { unmount } = render(
      <CombatHUD
        combatants={COMBATANTS}
        activeTurnIndex={0}
        isPending={false}
        onActionTrigger={onActionTrigger}
      />
    );
    fireEvent.keyDown(window, { key: "F1" });
    expect(onActionTrigger).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(window, { key: "F1" });
    expect(onActionTrigger).toHaveBeenCalledTimes(1);
  });
});
