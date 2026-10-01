/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActionInput from "@/app/campaign/[id]/ActionInput";
import StoryLog, { type StoryLogEntry } from "@/app/campaign/[id]/StoryLog";
import { CampaignStoryProvider, useCampaignStory } from "@/app/campaign/[id]/CampaignStoryProvider";
import { prepareDungeonAction } from "@/lib/events/campaign-ui";
import type { ActionStreamFrame, GameEvent } from "@/lib/events/game-events";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); refresh.mockReset(); });

const row = (id: string, role: string, content: string, minute = 0): StoryLogEntry => ({
  id, role, content, createdAt: `2026-10-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
});

function Campaign({ logs = [], hasMore = false }: { logs?: StoryLogEntry[]; hasMore?: boolean }) {
  return <CampaignStoryProvider>
    <StoryLog campaignId="campaign-1" initialLogs={logs} initialHasMore={hasMore} />
    <div data-testid="controls"><ActionInput campaignId="campaign-1" /></div>
  </CampaignStoryProvider>;
}

function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    async send(...frames: ActionStreamFrame[]) {
      await act(async () => {
        for (const frame of frames) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
      });
    },
    async fail() { await act(async () => controller.error(new Error("connection lost"))); },
  };
}

function submit(action = "Ataco al guardián") {
  fireEvent.change(screen.getByLabelText("Tu acción"), { target: { value: action } });
  fireEvent.click(screen.getByRole("button", { name: "Actuar" }));
}

const consequence: GameEvent = {
  type: "COMBAT_CONSEQUENCE",
  payload: {
    attackerName: "Aldric", attackerIsPlayer: true,
    targets: [{ targetName: "Guardián", targetId: "guardian", targetIsPlayer: false,
      damage: 0, naturalRoll: 12, isCrit: false, isFumble: false, hitLocation: "torso",
      narrativeTags: [], hpAfter: 18, targetMaxHp: 18, isKill: false, conditionsApplied: ["restrained"] }],
  },
};

describe("campaign story through the real action stream", () => {
  it("searches only loaded text and restores the whole log when returning to the present", () => {
    render(<Campaign logs={[row("one", "assistant", "La torre guarda silencio."), row("two", "user", "Abro la puerta", 1)]} />);
    const search = screen.getByRole("searchbox", { name: "Buscar en las entradas cargadas" });
    fireEvent.change(search, { target: { value: "TORRE" } });
    expect(screen.getByText("La torre guarda silencio.")).toBeInTheDocument();
    expect(screen.queryByText("Abro la puerta")).not.toBeInTheDocument();
    expect(screen.getByText(/1 coincidencia en lo cargado/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "dragón" } });
    expect(screen.getByText("No hay coincidencias con los filtros actuales.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver al presente" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("Abro la puerta")).toBeInTheDocument();
  });
  // Assistive technology only speaks a live region when it changes, so the same sentence set
  // twice is silent. These tests watch the region itself rather than the text it holds.
  it("changes the live region for every response, even when the announcement text repeats", () => {
    let actions!: NonNullable<ReturnType<typeof useCampaignStory>>["actions"];
    function Probe() { actions = useCampaignStory()!.actions; return null; }
    render(<CampaignStoryProvider>
      <StoryLog campaignId="campaign-1" initialLogs={[]} initialHasMore={false} />
      <Probe />
    </CampaignStoryProvider>);
    const region = within(screen.getByRole("region", { name: "Bitácora de aventura" })).getByRole("status");
    const observer = new MutationObserver(() => {});
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      act(() => { actions.begin("request-1", "Ataco"); actions.text("request-1", "Primer relato"); });
      expect(region).toHaveTextContent("Nueva respuesta en la bitácora");
      expect(observer.takeRecords().length).toBeGreaterThan(0);

      const spoken = region.textContent;
      act(() => {
        actions.finish("request-1", "received");
        actions.begin("request-2", "Ataco");
        actions.text("request-2", "Segundo relato");
      });
      expect(region.textContent).toBe(spoken);
      expect(observer.takeRecords().length).toBeGreaterThan(0);
    } finally {
      observer.disconnect();
    }
  });
  it("changes the live region each time the server window brings new entries", () => {
    const first = row("one", "assistant", "Uno");
    const second = row("two", "user", "Dos", 1);
    const { rerender } = render(<Campaign logs={[first]} />);
    const region = within(screen.getByRole("region", { name: "Bitácora de aventura" })).getByRole("status");
    const observer = new MutationObserver(() => {});
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      rerender(<Campaign logs={[first, second]} />);
      expect(region).toHaveTextContent("Hay nuevas entradas en la bitácora.");
      expect(observer.takeRecords().length).toBeGreaterThan(0);

      rerender(<Campaign logs={[first, second, row("three", "assistant", "Tres", 2)]} />);
      expect(region).toHaveTextContent("Hay nuevas entradas en la bitácora.");
      expect(observer.takeRecords().length).toBeGreaterThan(0);
    } finally {
      observer.disconnect();
    }
  });
  it("does not present the zero sentinel for an unrolled consequence as a natural die", async () => {
    const incoming = stream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(incoming.response);
    render(<Campaign />);
    submit("Lanzo un conjuro");
    const unrolled = structuredClone(consequence);
    if (unrolled.type !== "COMBAT_CONSEQUENCE") throw new Error("Expected consequence fixture");
    unrolled.payload.targets[0]!.naturalRoll = 0;
    await incoming.send({ t: "evt", e: unrolled }, { t: "done" });
    const result = screen.getByLabelText("Resultado de la acción");
    expect(result).toHaveTextContent("18/18 PG");
    expect(within(result).queryByText("Tirada natural")).not.toBeInTheDocument();
  });
  it("does not attach a refused attempt to a later successful action with identical text", async () => {
    const incoming = stream();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "No disponible" }), { status: 400 }))
      .mockResolvedValueOnce(incoming.response);
    const { rerender } = render(<Campaign />);
    submit("equipar Espada");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No disponible"));
    submit("equipar Espada");
    await incoming.send({ t: "txt", d: "Preparas tu espada." }, { t: "done" });
    rerender(<Campaign logs={[row("success-intent", "user", "equipar Espada", 1), row("success-story", "assistant", "Preparas tu espada.", 2)]} />);
    const chronicle = screen.getByRole("region", { name: "Bitácora de aventura" });
    const attempts = within(chronicle).getAllByText("equipar Espada").map((element) => element.closest("li")!);
    const success = attempts.find((attempt) => attempt.textContent?.includes("Preparas tu espada."))!;
    expect(success).toBeDefined();
    expect(success).not.toHaveTextContent("Acción rechazada");
    // The successful block is anchored to its own persisted intent. The local
    // refusal must not consume that row and precede it in canonical history.
    expect(chronicle.querySelector("ul > li")).toBe(success);
  });
  it("shows actual results before narration, preserves received text through refresh, and reconciles without remount or duplication", async () => {
    const incoming = stream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(incoming.response);
    const { rerender } = render(<Campaign />);
    submit();
    await incoming.send({ t: "evt", e: consequence });

    const chronicle = screen.getByRole("region", { name: "Bitácora de aventura" });
    const result = within(chronicle).getByLabelText("Resultado de la acción");
    expect(result).toHaveTextContent("0 de daño");
    expect(result).toHaveTextContent("18/18 PG");
    expect(result).toHaveTextContent("Restringido");
    expect(result).not.toHaveTextContent(/fallo|inmunidad|éxito/i);
    expect(within(chronicle).getByText("Esperando el relato…")).toBeInTheDocument();
    const facts = within(result).getByText("Ver hechos exactos (1)").closest("details")!;
    expect(within(facts).getByText("Tirada natural").nextElementSibling).toHaveTextContent("12");
    expect(within(facts).getByText("Daño").nextElementSibling).toHaveTextContent("0");
    expect(within(facts).getByText("PG actuales").nextElementSibling).toHaveTextContent("18");
    expect(facts).not.toHaveTextContent("guardian");
    expect(facts.querySelector("pre")).toBeNull();

    const prose = "El guardián se detiene.\n\nLa puerta permanece abierta.";
    await incoming.send({ t: "txt", d: prose });
    const narrative = within(chronicle).getByText(/El guardián se detiene/);
    const liveItem = narrative.closest("li");
    expect(result.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(narrative.textContent).toBe(prose);
    expect(narrative).toHaveClass("whitespace-pre-wrap", "max-w-[70ch]");
    expect(within(screen.getByTestId("controls")).queryByText(/El guardián se detiene/)).not.toBeInTheDocument();

    await incoming.send({ t: "done" });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(narrative).toBeInTheDocument();
    rerender(<Campaign logs={[row("intent", "user", "Ataco al guardián", 1), row("narrative", "assistant", prose, 2)]} />);
    await waitFor(() => expect(screen.queryByText(/Sincronizando la bitácora/)).not.toBeInTheDocument());
    expect(within(chronicle).getAllByText(/El guardián se detiene/)).toHaveLength(1);
    expect(within(chronicle).getAllByText("Ataco al guardián")).toHaveLength(1);
    expect(within(chronicle).getByText(/El guardián se detiene/).closest("li")).toBe(liveItem);
    expect(result).toBeInTheDocument();
    expect(chronicle).not.toHaveAttribute("aria-live");
    expect(within(chronicle).getByRole("status")).not.toHaveTextContent(prose);
  });

  it("does not mistake an old identical narrative for the response to the current action", async () => {
    const incoming = stream();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(incoming.response);
    const old = row("old", "assistant", "El camino sigue en silencio.");
    const { rerender } = render(<Campaign logs={[old]} />);
    submit("Miro el camino");
    await incoming.send({ t: "txt", d: old.content }, { t: "done" });
    expect(screen.getAllByText(old.content)).toHaveLength(2);
    expect(screen.getByText(/Sincronizando la bitácora/)).toBeInTheDocument();
    rerender(<Campaign logs={[old, row("intent", "user", "Miro el camino", 1), row("new", "assistant", old.content, 2)]} />);
    await waitFor(() => expect(screen.queryByText(/Sincronizando la bitácora/)).not.toBeInTheDocument());
    expect(screen.getAllByText(old.content)).toHaveLength(2);
  });

  it("filters loaded entries without manufacturing events from historical system prose", async () => {
    const logs = [row("u", "user", "Examino la cerradura"), row("s", "system", "Prueba antigua: 18 contra CD 12", 1), row("a", "assistant", "Una marca en el hierro.", 2)];
    render(<Campaign logs={logs} />);
    expect(screen.queryByLabelText("Resultado de la acción")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Relato" }));
    expect(screen.getByText("Una marca en el hierro.")).toBeInTheDocument();
    expect(screen.getByText("Examino la cerradura")).toBeInTheDocument();
    expect(screen.queryByText("Prueba antigua: 18 contra CD 12")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));
    expect(screen.getByText("Prueba antigua: 18 contra CD 12")).toBeInTheDocument();
    expect(screen.queryByText("Una marca en el hierro.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver al presente" }));
    await waitFor(() => expect(screen.getByLabelText("Presente de la bitácora")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Examino la cerradura")).toBeInTheDocument();
  });

  it("retains partial results and retries the identical request without duplicating replayed events", async () => {
    const first = stream();
    const retry = stream();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(first.response).mockResolvedValueOnce(retry.response);
    render(<Campaign />);
    submit();
    await first.send({ t: "evt", e: consequence }, { t: "txt", d: "El guardián retrocede." });
    await first.fail();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(screen.getByText("El guardián retrocede.")).toBeInTheDocument();
    await retry.send({ t: "duplicate", requestId: JSON.parse(fetchMock.mock.calls[0][1]!.body as string).requestId }, { t: "evt", e: consequence }, { t: "done" });
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body);
    expect(screen.getAllByLabelText("Resultado de la acción")).toHaveLength(1);
    expect(screen.getByText("Ver hechos exactos (1)")).toBeInTheDocument();
    expect(screen.getByText("El guardián retrocede.")).toBeInTheDocument();
  });

  it("keeps a typed draft when equipment prepares an action and never submits preparation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<Campaign />);
    fireEvent.change(screen.getByLabelText("Tu acción"), { target: { value: "Examino el puente" } });
    act(() => prepareDungeonAction("equipar Espada larga"));
    expect(screen.getByLabelText("Tu acción")).toHaveValue("Examino el puente");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sustituir borrador" }));
    expect(screen.getByLabelText("Tu acción")).toHaveValue("equipar Espada larga");
    await waitFor(() => expect(screen.getByLabelText("Tu acción")).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains preparation during an active request until the player can use it", async () => {
    const incoming = stream();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(incoming.response);
    render(<Campaign />);
    submit();
    act(() => prepareDungeonAction("equipar Escudo"));
    const usePrepared = screen.getByRole("button", { name: "Usar acción preparada" });
    expect(usePrepared).toBeDisabled();
    expect(screen.getByLabelText("Tu acción")).toHaveValue("");
    await incoming.send({ t: "done" });
    await waitFor(() => expect(usePrepared).not.toBeDisabled());
    fireEvent.click(usePrepared);
    expect(screen.getByLabelText("Tu acción")).toHaveValue("equipar Escudo");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves the reader's visible entry when loading earlier rows and does not scroll on new entries", async () => {
    const current = row("current", "assistant", "Mi punto de lectura", 2);
    const older = row("older", "assistant", "Un relato anterior", 1);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ logs: [older], hasMore: false })));
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const { rerender } = render(<Campaign logs={[current]} hasMore />);
    const item = screen.getByText(current.content).closest("li")!;
    // jsdom has no layout. This models that row moving 160px after insertion.
    vi.spyOn(item, "getBoundingClientRect").mockImplementation(() => {
      const top = screen.queryByText(older.content) ? 200 : 40;
      return { top, bottom: top + 80 } as DOMRect;
    });
    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    await screen.findByText(older.content);
    expect(scrollBy).toHaveBeenCalledWith({ top: 160, behavior: "instant" });
    scrollBy.mockClear();
    rerender(<Campaign logs={[current, row("new", "assistant", "Un nuevo relato", 3)]} />);
    await screen.findByText("Un nuevo relato");
    expect(scrollBy).not.toHaveBeenCalled();
    expect(screen.getByText(older.content)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument();
  });
});
