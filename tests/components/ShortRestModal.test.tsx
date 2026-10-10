/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ShortRestModal, { type ShortRestCharacterData } from "@/components/campaign/ShortRestModal";
import type { RestFacts } from "@/lib/rules/rest-service";

afterEach(() => {
  cleanup();
});

const defaultCharacter: ShortRestCharacterData = {
  name: "Kaelen",
  hp: 7,
  maxHp: 15,
  hitDiceRemaining: 2,
  hitDiceTotal: 2,
  hitDie: "1d10",
  className: "Fighter",
};

const sampleSuccessFacts: RestFacts = {
  type: "rest_resolved",
  campaignId: "camp-1",
  characterId: "char-1",
  restType: "short",
  hpBefore: 7,
  hpAfter: 14,
  hpRecovered: 7,
  hitDiceSpent: 1,
  hitDiceRecovered: 0,
  hitDiceRemainingBefore: 2,
  hitDiceRemainingAfter: 1,
  exhaustionReduced: 0,
  slotsRestored: true,
  hitDie: "1d10",
  rolled: 5,
  conMod: 2,
};

describe("ShortRestModal — state lifecycle and mechanical presentation", () => {
  it("renders nothing when isOpen is false", () => {
    render(
      <ShortRestModal
        isOpen={false}
        onClose={vi.fn()}
        character={defaultCharacter}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders character HP and hit dice information in initial state", () => {
    render(
      <ShortRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={defaultCharacter}
      />
    );

    expect(screen.getByRole("dialog", { name: /Descanso corto/i })).toBeInTheDocument();
    expect(screen.getByText(/Kaelen/)).toBeInTheDocument();
    expect(screen.getByText("7 / 15 PG")).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/\(1d10\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar descanso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("triggers onConfirm when Confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ShortRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={defaultCharacter}
        onConfirm={onConfirm}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: "Confirmar descanso" });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("triggers onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ShortRestModal
        isOpen={true}
        onClose={onClose}
        character={defaultCharacter}
      />
    );

    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
    fireEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables controls and prevents close while isProcessing is true", () => {
    const onClose = vi.fn();
    render(
      <ShortRestModal
        isOpen={true}
        onClose={onClose}
        character={defaultCharacter}
        isProcessing={true}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: "Confirmar descanso" });
    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });

    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();

    // Trigger escape
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders warning status message when no hit dice remain", () => {
    render(
      <ShortRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={{ ...defaultCharacter, hitDiceRemaining: 0 }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Sin dados de golpe");
    expect(screen.getByText(/No te quedan dados de golpe disponibles/)).toBeInTheDocument();
  });

  it("renders info status message when character is already at max HP", () => {
    render(
      <ShortRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={{ ...defaultCharacter, hp: 15 }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Salud máxima");
    expect(screen.getByText(/Ya te encuentras en tu salud máxima/)).toBeInTheDocument();
  });

  it("renders error message with alert role when error is provided", () => {
    render(
      <ShortRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={defaultCharacter}
        error="No puedes descansar durante un encuentro activo."
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudo descansar");
    expect(alert).toHaveTextContent("No puedes descansar durante un encuentro activo.");
  });

  it("renders success state with RestFacts details and close button", () => {
    const onClose = vi.fn();
    render(
      <ShortRestModal
        isOpen={true}
        onClose={onClose}
        character={defaultCharacter}
        facts={sampleSuccessFacts}
      />
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Descanso completado");
    expect(status).toHaveTextContent("Recuperados 7 PG");
    expect(status).toHaveTextContent("Dados de golpe gastados: 1");
    expect(status).toHaveTextContent("Espacios de conjuro de pacto restaurados.");

    const acceptBtn = screen.getByRole("button", { name: "Aceptar y cerrar" });
    expect(acceptBtn).toBeInTheDocument();

    fireEvent.click(acceptBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
