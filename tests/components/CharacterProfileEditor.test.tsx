/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CharacterProfileEditor from "@/components/character/sheet/CharacterProfileEditor";
import type { CharacterChangeProposalDto, CharacterEditableSnapshot } from "@/lib/character-sheet/contracts";

const snapshot: CharacterEditableSnapshot = {
  id: "character-1",
  name: "Mira",
  revision: 2,
  updatedAt: new Date(0).toISOString(),
  appearance: "Silver hair",
  backstory: "An archivist.",
  personalityTraits: "Patient",
  ideals: "Knowledge",
  bonds: "Her mentor",
  flaws: "Overcautious",
};

function response(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body }) as Promise<Response>;
}

describe("CharacterProfileEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return response(url.endsWith("/history") ? [] : []);
    }));
  });

  it("explains a locked name and keeps other narrative fields editable", async () => {
    render(
      <CharacterProfileEditor
        characterId="character-1"
        initialSnapshot={snapshot}
        nameLocked
        mode="profile"
        onSnapshotChange={vi.fn()}
      />
    );

    const nameButton = screen.getByRole("button", { name: "Editar Nombre" });
    expect(nameButton).toBeDisabled();
    expect(nameButton).toHaveAttribute("title", "Bloqueado durante un encuentro activo");
    expect(screen.getByText("Bloqueado durante el encuentro activo.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar Aspecto" }));
    expect(screen.getByRole("textbox", { name: "Aspecto" })).toHaveValue("Silver hair");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("shows current and proposed values with explicit accept and reject commands", async () => {
    const proposal: CharacterChangeProposalDto = {
      proposalId: "proposal-1",
      characterId: "character-1",
      expectedVersion: 2,
      actor: "AI",
      reason: "Adds a stronger motivation.",
      changes: [{ field: "ideals", value: "Knowledge must serve everyone." }],
      previousValues: [{ field: "ideals", value: "Knowledge" }],
      validationStatus: "VALID",
      warnings: [],
      requiresPlayerConfirmation: true,
      status: "PENDING",
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return response(url.endsWith("/proposals") ? [proposal] : []);
    }));

    render(
      <CharacterProfileEditor
        characterId="character-1"
        initialSnapshot={snapshot}
        nameLocked={false}
        mode="profile"
        onSnapshotChange={vi.fn()}
      />
    );

    expect(await screen.findByText("Knowledge must serve everyone.")).toBeInTheDocument();
    expect(screen.getByText("Actual · Ideales")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
  });

  it("uses a compatible idempotency key when crypto.randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return response({
          snapshot: { ...snapshot, appearance: "Copper scales", revision: 3 },
          idempotent: false,
        });
      }
      return response([]);
    }));

    render(
      <CharacterProfileEditor
        characterId="character-1"
        initialSnapshot={snapshot}
        nameLocked={false}
        mode="profile"
        onSnapshotChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar Aspecto" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Aspecto" }), {
      target: { value: "Copper scales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      const patchCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body));
      expect(body.idempotencyKey).toMatch(/^manual:[A-Za-z0-9._:-]{8,}$/);
    });
  });
});
