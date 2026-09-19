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
  it("F1 requests the Attack action exactly once", () => {
    renderController();
    const event = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("F2 requests the End Turn action exactly once", () => {
    renderController();
    const event = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(requests.map((r) => r.request)).toEqual([{ action: "End Turn" }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores repeated keydown events (event.repeat === true)", () => {
    renderController();
    // Initial keydown triggers action exactly once
    const initial = new KeyboardEvent("keydown", {
      key: "F1",
      bubbles: true,
      cancelable: true,
      repeat: false,
    });
    window.dispatchEvent(initial);
    expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
    expect(initial.defaultPrevented).toBe(true);

    // Repeated keydown while holding key does not trigger action or prevent default
    const repeat1 = new KeyboardEvent("keydown", {
      key: "F1",
      bubbles: true,
      cancelable: true,
      repeat: true,
    });
    window.dispatchEvent(repeat1);

    const repeat2 = new KeyboardEvent("keydown", {
      key: "F1",
      bubbles: true,
      cancelable: true,
      repeat: true,
    });
    window.dispatchEvent(repeat2);

    expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
    expect(repeat1.defaultPrevented).toBe(false);
    expect(repeat2.defaultPrevented).toBe(false);

    // Similarly for F2
    const f2Repeat = new KeyboardEvent("keydown", {
      key: "F2",
      bubbles: true,
      cancelable: true,
      repeat: true,
    });
    window.dispatchEvent(f2Repeat);
    expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
    expect(f2Repeat.defaultPrevented).toBe(false);
  });

  it("ignores F1/F2 originating inside active modal and dialog overlays", () => {
    renderController();

    // Modal matching project pattern: role="dialog" aria-modal="true"
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;

    const modalButton = document.createElement("button");
    modalButton.textContent = "Cerrar";
    dialog.appendChild(modalButton);

    // Native dialog element
    const nativeDialog = document.createElement("dialog");
    nativeDialog.open = true;
    const nativeDialogButton = document.createElement("button");
    nativeDialogButton.textContent = "Aceptar";
    nativeDialog.appendChild(nativeDialogButton);

    // Alert dialog matching role="alertdialog"
    const alertDialog = document.createElement("div");
    alertDialog.setAttribute("role", "alertdialog");
    const alertText = document.createElement("span");
    alertText.textContent = "¿Confirmar acción?";
    alertDialog.appendChild(alertText);

    document.body.append(dialog, nativeDialog, alertDialog);

    try {
      // Event on child inside dialog
      const e1 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
      modalButton.dispatchEvent(e1);
      expect(e1.defaultPrevented).toBe(false);

      // Event on dialog container itself
      const e2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      dialog.dispatchEvent(e2);
      expect(e2.defaultPrevented).toBe(false);

      // Event inside native dialog
      const e3 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
      nativeDialogButton.dispatchEvent(e3);
      expect(e3.defaultPrevented).toBe(false);

      // Event inside alertdialog
      const e4 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      alertText.dispatchEvent(e4);
      expect(e4.defaultPrevented).toBe(false);

      // No combat actions should have been triggered
      expect(requests).toEqual([]);

      // Non-modal element outside dialog still triggers action
      const outsideButton = document.createElement("button");
      document.body.append(outsideButton);
      const e5 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
      outsideButton.dispatchEvent(e5);
      expect(e5.defaultPrevented).toBe(true);
      expect(requests.map((r) => r.request)).toEqual([{ action: "Attack" }]);
      outsideButton.remove();
    } finally {
      dialog.remove();
      nativeDialog.remove();
      alertDialog.remove();
    }
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
    const e1 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
    window.dispatchEvent(e1);
    const e2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    window.dispatchEvent(e2);
    expect(requests).toEqual([]);
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
  });

  it("ignores the keys while typing in a text field", () => {
    renderController();
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, editable);
    try {
      const e1 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
      input.dispatchEvent(e1);
      const e2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      textarea.dispatchEvent(e2);
      const e3 = new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true });
      editable.dispatchEvent(e3);

      expect(requests).toEqual([]);
      expect(e1.defaultPrevented).toBe(false);
      expect(e2.defaultPrevented).toBe(false);
      expect(e3.defaultPrevented).toBe(false);
    } finally {
      input.remove();
      textarea.remove();
      editable.remove();
    }
  });

  it("ignores the keys when a modifier is held", () => {
    renderController();
    const e1 = new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e1);
    const e2 = new KeyboardEvent("keydown", { key: "F1", altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e2);
    const e3 = new KeyboardEvent("keydown", { key: "F2", shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e3);
    const e4 = new KeyboardEvent("keydown", { key: "F2", metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e4);

    expect(requests).toEqual([]);
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    expect(e3.defaultPrevented).toBe(false);
    expect(e4.defaultPrevented).toBe(false);
  });

  it("ignores unrelated keys without preventing default", () => {
    renderController();
    const e1 = new KeyboardEvent("keydown", { key: "F3", bubbles: true, cancelable: true });
    window.dispatchEvent(e1);
    const e2 = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    window.dispatchEvent(e2);
    const e3 = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(e3);

    expect(requests).toEqual([]);
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    expect(e3.defaultPrevented).toBe(false);
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
