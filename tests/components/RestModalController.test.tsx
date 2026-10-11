/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RestModalController, { type RestCharacterPayload } from "@/components/campaign/RestModalController";
import { openShortRest, openLongRest } from "@/lib/events/campaign-ui";
import type { RestFacts } from "@/lib/rules/rest-service";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

const sampleCharacter: RestCharacterPayload = {
  name: "Theron",
  hp: 8,
  maxHp: 20,
  hitDiceRemaining: 2,
  hitDiceTotal: 3,
  hitDie: "1d10",
  className: "Fighter",
  exhaustionLevel: 1,
};

const sampleShortFacts: RestFacts = {
  type: "rest_resolved",
  campaignId: "camp-123",
  characterId: "char-123",
  restType: "short",
  hpBefore: 8,
  hpAfter: 15,
  hpRecovered: 7,
  hitDiceSpent: 1,
  hitDiceRecovered: 0,
  hitDiceRemainingBefore: 2,
  hitDiceRemainingAfter: 1,
  exhaustionReduced: 0,
  slotsRestored: false,
  hitDie: "1d10",
  rolled: 5,
  conMod: 2,
};

const sampleLongFacts: RestFacts = {
  type: "rest_resolved",
  campaignId: "camp-123",
  characterId: "char-123",
  restType: "long",
  hpBefore: 8,
  hpAfter: 20,
  hpRecovered: 12,
  hitDiceSpent: 0,
  hitDiceRecovered: 1,
  hitDiceRemainingBefore: 2,
  hitDiceRemainingAfter: 3,
  exhaustionReduced: 1,
  slotsRestored: true,
  hitDie: null,
  rolled: null,
  conMod: null,
};

describe("RestModalController — UI wiring and REST cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing by default when idle", () => {
    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens ShortRestModal on openShortRest event", () => {
    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openShortRest();
    });

    expect(screen.getByRole("dialog", { name: /Descanso corto/i })).toBeInTheDocument();
    expect(screen.getByText(/Theron/)).toBeInTheDocument();
    expect(screen.getByText("8 / 20 PG")).toBeInTheDocument();
  });

  it("opens LongRestModal on openLongRest event", () => {
    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openLongRest();
    });

    expect(screen.getByRole("dialog", { name: /Descanso largo/i })).toBeInTheDocument();
    expect(screen.getByText(/Theron/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Agotamiento actual: Nivel 1");
  });

  it("shows an error when opened while inCombat is true", () => {
    render(<RestModalController campaignId="camp-123" character={sampleCharacter} inCombat={true} />);

    act(() => {
      openShortRest();
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No puedes descansar durante un encuentro activo.");
  });

  it("executes POST /api/campaign/[id]/rest on short rest confirm, presents facts, and calls router.refresh()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => sampleShortFacts,
    } as Response);

    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openShortRest();
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirmar descanso" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/campaign/camp-123/rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "short" }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Descanso completado");
      expect(screen.getByText(/Recuperados/)).toHaveTextContent("7 PG");
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Aceptar y cerrar" })).toBeInTheDocument();
  });

  it("executes POST /api/campaign/[id]/rest on long rest confirm, presents facts, and calls router.refresh()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => sampleLongFacts,
    } as Response);

    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openLongRest();
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirmar descanso" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/campaign/camp-123/rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "long" }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Descanso completado");
      expect(screen.getByText(/Recuperados/)).toHaveTextContent("12 PG");
      expect(screen.getByText(/Nivel de agotamiento reducido en/)).toBeInTheDocument();
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("handles API error by displaying error message without calling router.refresh()", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "El personaje no tiene dados de golpe disponibles." }),
    } as Response);

    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openShortRest();
    });

    const confirmBtn = screen.getByRole("button", { name: "Confirmar descanso" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("El personaje no tiene dados de golpe disponibles.");
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirmar descanso" })).toBeInTheDocument();
  });

  it("closes modal and resets state on Cancel click", () => {
    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openShortRest();
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes modal on Accept and Close click after successful rest", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => sampleShortFacts,
    } as Response);

    render(<RestModalController campaignId="camp-123" character={sampleCharacter} />);

    act(() => {
      openShortRest();
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar descanso" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Aceptar y cerrar" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Aceptar y cerrar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
