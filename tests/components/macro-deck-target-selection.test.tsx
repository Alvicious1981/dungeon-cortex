/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import MacroDeck from "@/components/combat/MacroDeck";
import ActionInput from "@/app/campaign/[id]/ActionInput";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshMock.mockReset();
});

type Target = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  isPlayer: boolean;
};

const goblin: Target = { id: "enemy-1", name: "Goblin", hp: 7, maxHp: 7, isPlayer: false };
const orc: Target = { id: "enemy-2", name: "Orco", hp: 15, maxHp: 15, isPlayer: false };
const hero: Target = { id: "player-1", name: "Aldric", hp: 12, maxHp: 12, isPlayer: true };

function mockActionStream() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(`data: ${JSON.stringify({ t: "done" })}\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
  );
}

function CombatCommands({
  targets,
  showDeck = true,
}: {
  targets: Target[];
  showDeck?: boolean;
}) {
  // Same sibling order as app/campaign/[id]/page.tsx.
  return (
    <>
      {showDeck && <MacroDeck inCombat />}
      <ActionInput campaignId="campaign-1" selectableTargets={targets} />
    </>
  );
}

function tick(name: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
}

function attackBodies(fetchMock: ReturnType<typeof mockActionStream>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe("MacroDeck attack uses ActionInput's real target selection", () => {
  it("attacks the target ticked in Objetivos", async () => {
    const fetchMock = mockActionStream();
    render(<CombatCommands targets={[hero, goblin, orc]} />);

    tick("Goblin");
    fireEvent.click(screen.getByRole("button", { name: "Atacar con arma" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/campaign/campaign-1/action");
    expect(attackBodies(fetchMock)[0]).toMatchObject({
      action: "Attack",
      targetIds: ["enemy-1"],
    });
    expect(screen.queryByText(/Selecciona exactamente un objetivo/)).not.toBeInTheDocument();
  });

  it("sees a selection made before MacroDeck mounted", async () => {
    const fetchMock = mockActionStream();
    const { rerender } = render(<CombatCommands targets={[goblin, orc]} showDeck={false} />);

    tick("Orco");
    rerender(<CombatCommands targets={[goblin, orc]} />);
    fireEvent.click(screen.getByRole("button", { name: "Atacar con arma" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(attackBodies(fetchMock)[0]).toMatchObject({
      action: "Attack",
      targetIds: ["enemy-2"],
    });
  });

  it("keeps refusing Attack with zero or several targets, including after a target dies", () => {
    const fetchMock = mockActionStream();
    const { rerender } = render(<CombatCommands targets={[goblin, orc]} />);
    const attack = () =>
      fireEvent.click(screen.getByRole("button", { name: "Atacar con arma" }));

    attack();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selecciona exactamente un objetivo para atacar."
    );

    tick("Goblin");
    tick("Orco");
    attack();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selecciona exactamente un objetivo para atacar."
    );

    // The only ticked target that survives is pruned out with the dead one.
    tick("Orco");
    rerender(<CombatCommands targets={[{ ...goblin, hp: 0 }, orc]} />);
    attack();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Selecciona exactamente un objetivo para atacar."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
