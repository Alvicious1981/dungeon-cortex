"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "summary",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalFocusOptions {
  open: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

type ModalEntry = { dialog: HTMLElement; focus(): void };
const modalStack: ModalEntry[] = [];
const isolated = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
let bodyOverflow = "";

/** Only the top modal owns isolation; recomputing also supports nested portals. */
function isolateTopModal() {
  for (const [element, previous] of isolated) {
    if (!previous.inert) element.removeAttribute("inert");
    if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", previous.ariaHidden);
  }
  isolated.clear();
  let branch: HTMLElement | undefined = modalStack.at(-1)?.dialog;
  while (branch?.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      isolated.set(sibling, { inert: sibling.hasAttribute("inert"), ariaHidden: sibling.getAttribute("aria-hidden") });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    if (branch.parentElement === document.body) break;
    branch = branch.parentElement;
  }
}

function availableControls(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
        const summary = Array.from(ancestor.children).find((child) => child.tagName === "SUMMARY");
        if (!summary?.contains(element)) return false;
      }
      if (ancestor === dialog) break;
    }
    return true;
  });
}

export function useModalFocus({ open, onClose, dialogRef, initialFocusRef, returnFocusRef }: ModalFocusOptions) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog: HTMLElement = dialogRef.current;
    const returnFocusElement = returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (modalStack.length === 0) bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const entry: ModalEntry = {
      dialog,
      focus: () => (initialFocusRef?.current ?? availableControls(dialog)[0] ?? dialog).focus(),
    };
    modalStack.push(entry);
    isolateTopModal();
    entry.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = availableControls(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!focusable.includes(active as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event: FocusEvent) {
      if (modalStack.at(-1) === entry && !dialog.contains(event.target as Node)) entry.focus();
    }

    // New siblings (e.g. streamed UI) must not become interactive behind a modal.
    const observer = new MutationObserver(() => isolateTopModal());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", containFocus);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", containFocus);
      const wasTop = modalStack.at(-1) === entry;
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      isolateTopModal();
      if (modalStack.length === 0) document.body.style.overflow = bodyOverflow;
      if (!wasTop) return;
      const remaining = modalStack.at(-1);
      if (returnFocusElement?.isConnected && (!remaining || remaining.dialog.contains(returnFocusElement))) {
        returnFocusElement.focus();
      } else remaining?.focus();
    };
  }, [dialogRef, initialFocusRef, open, returnFocusRef]);
}
