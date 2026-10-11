/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LongRestModal, { type LongRestCharacterData } from "@/components/campaign/LongRestModal";
import type { RestFacts } from "@/lib/rules/rest-service";

afterEach(() => {
  cleanup();
});

const defaultCharacter: LongRestCharacterData = {
  name: "Kaelen",
  hp: 7,
  maxHp: 15,
  hitDiceRemaining: 1,
  hitDiceTotal: 2,
  hitDie: "1d10",
  className: "Fighter",
  exhaustionLevel: 0,
};

const sampleSuccessFacts: RestFacts = {
  type: "rest_resolved",
  campaignId: "camp-1",
  characterId: "char-1",
  restType: "long",
  hpBefore: 7,
  hpAfter: 15,
  hpRecovered: 8,
  hitDiceSpent: 0,
  hitDiceRecovered: 1,
  hitDiceRemainingBefore: 1,
  hitDiceRemainingAfter: 2,
  exhaustionReduced: 1,
  slotsRestored: true,
  hitDie: null,
  rolled: null,
  conMod: null,
};

describe("LongRestModal — state lifecycle and mechanical presentation", () => {
  it("renders nothing when isOpen is false", () => {
    render(
      <LongRestModal
        isOpen={false}
        onClose={vi.fn()}
        character={defaultCharacter}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders character HP and hit dice information in initial state", () => {
    render(
      <LongRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={defaultCharacter}
      />
    );

    expect(screen.getByRole("dialog", { name: /Descanso largo/i })).toBeInTheDocument();
    expect(screen.getByText(/Kaelen/)).toBeInTheDocument();
    expect(screen.getByText("7 / 15 PG")).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/\(1d10\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar descanso" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("triggers onConfirm when Confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <LongRestModal
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
      <LongRestModal
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
      <LongRestModal
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

  it("renders info status message when character is already at full health, hit dice, and no exhaustion", () => {
    render(
      <LongRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={{
          ...defaultCharacter,
          hp: 15,
          hitDiceRemaining: 2,
          exhaustionLevel: 0,
        }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Salud y recursos completos");
    expect(screen.getByText(/Ya te encuentras en tu salud máxima/)).toBeInTheDocument();
  });

  it("renders warning status message and indicator when character has exhaustion", () => {
    render(
      <LongRestModal
        isOpen={true}
        onClose={vi.fn()}
        character={{
          ...defaultCharacter,
          exhaustionLevel: 1,
        }}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Agotamiento actual: Nivel 1");
    expect(screen.getByText(/reducirá tu nivel de agotamiento en 1/)).toBeInTheDocument();
  });

  it("renders error message with alert role when error is provided", () => {
    render(
      <LongRestModal
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
      <LongRestModal
        isOpen={true}
        onClose={onClose}
        character={defaultCharacter}
        facts={sampleSuccessFacts}
      />
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Descanso completado");
    expect(status).toHaveTextContent("Recuperados 8 PG (de 7 a 15 PG).");
    expect(status).toHaveTextContent("Dados de golpe recuperados: 1");
    expect(status).toHaveTextContent("Nivel de agotamiento reducido en 1");
    expect(status).toHaveTextContent("Espacios de conjuro restaurados.");

    const acceptBtn = screen.getByRole("button", { name: "Aceptar y cerrar" });
    expect(acceptBtn).toBeInTheDocument();

    fireEvent.click(acceptBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
