/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import StoryLog, { type StoryLogEntry } from "@/app/campaign/[id]/StoryLog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function entry(id: string, createdAt: string, role: "assistant" | "user" | "system" = "assistant", content?: string): StoryLogEntry {
  return { id, role, content: content ?? `content-${id}`, createdAt };
}

function chronicleRegion() {
  return screen.getByRole("region", { name: "Bitácora de aventura" });
}

describe("StoryLog — presentation", () => {
  it("renders logs in chronological order", () => {
    const initialLogs = [
      entry("log-1", "2026-01-01T00:00:00.000Z"),
      entry("log-2", "2026-01-01T00:01:00.000Z"),
      entry("log-3", "2026-01-01T00:02:00.000Z"),
    ];
    render(<StoryLog campaignId="camp-1" initialLogs={initialLogs} initialHasMore={false} />);

    const items = within(chronicleRegion()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("content-log-1"),
      expect.stringContaining("content-log-2"),
      expect.stringContaining("content-log-3"),
    ]);
  });

  it("orders tied-createdAt entries deterministically by id", () => {
    const tiedTime = "2026-01-01T00:00:00.000Z";
    const initialLogs = [
      entry("log-b", tiedTime),
      entry("log-a", tiedTime),
      entry("log-c", tiedTime),
    ];
    render(<StoryLog campaignId="camp-1" initialLogs={initialLogs} initialHasMore={false} />);

    const items = within(chronicleRegion()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("content-log-a"),
      expect.stringContaining("content-log-b"),
      expect.stringContaining("content-log-c"),
    ]);
  });

  it("shows the empty-history state with zero logs", () => {
    render(<StoryLog campaignId="camp-1" initialLogs={[]} initialHasMore={false} />);
    expect(screen.getByText(/Aún no hay entradas/)).toBeInTheDocument();
  });

  it("has the exact aria-label and id the skip-link and e2e depend on", () => {
    render(<StoryLog campaignId="camp-1" initialLogs={[]} initialHasMore={false} />);
    const region = chronicleRegion();
    expect(region).toHaveAttribute("id", "chronicle");
  });
});

describe("StoryLog — load older control", () => {
  it("does not render the control when initialHasMore is false", () => {
    render(<StoryLog campaignId="camp-1" initialLogs={[entry("log-1", "2026-01-01T00:00:00.000Z")]} initialHasMore={false} />);
    expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument();
  });

  it("renders the control when initialHasMore is true", () => {
    render(<StoryLog campaignId="camp-1" initialLogs={[entry("log-51", "2026-01-01T00:50:00.000Z")]} initialHasMore={true} />);
    expect(screen.getByRole("button", { name: "Cargar anteriores" })).toBeInTheDocument();
  });

  it("fetches an older page keyed off the oldest currently-visible entry, disables while loading, then merges and dedupes", async () => {
    const initialLogs = [entry("log-51", "2026-01-01T00:50:00.000Z"), entry("log-52", "2026-01-01T00:51:00.000Z")];
    const olderPage = {
      logs: [entry("log-49", "2026-01-01T00:48:00.000Z"), entry("log-50", "2026-01-01T00:49:00.000Z")],
      hasMore: true,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(olderPage), { status: 200 })
    );

    render(<StoryLog campaignId="camp-1" initialLogs={initialLogs} initialHasMore={true} />);

    const button = screen.getByRole("button", { name: "Cargar anteriores" });
    fireEvent.click(button);

    // Disabled while the request is in flight.
    expect(button).toBeDisabled();

    await waitFor(() => expect(button).not.toBeDisabled());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(calledUrl.pathname).toBe("/api/campaign/camp-1/logs");
    expect(calledUrl.searchParams.get("before")).toBe("2026-01-01T00:50:00.000Z");
    expect(calledUrl.searchParams.get("beforeId")).toBe("log-51");
    expect(calledUrl.searchParams.get("limit")).toBe("50");

    const items = within(chronicleRegion()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("content-log-49"),
      expect.stringContaining("content-log-50"),
      expect.stringContaining("content-log-51"),
      expect.stringContaining("content-log-52"),
    ]);
    // Still hasMore per the response, so the control remains.
    expect(screen.getByRole("button", { name: "Cargar anteriores" })).toBeInTheDocument();
  });

  it("shows a recoverable error and keeps the control when the fetch fails, and allows retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ logs: [entry("log-49", "2026-01-01T00:48:00.000Z")], hasMore: false }), { status: 200 })
      );

    render(
      <StoryLog
        campaignId="camp-1"
        initialLogs={[entry("log-50", "2026-01-01T00:49:00.000Z")]}
        initialHasMore={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cargar anteriores" })).toBeInTheDocument();

    // Retry succeeds.
    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    await waitFor(() => expect(screen.queryByText("boom")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prevents concurrent requests from a double click", async () => {
    let resolveFetch!: (v: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(
      <StoryLog
        campaignId="camp-1"
        initialLogs={[entry("log-50", "2026-01-01T00:49:00.000Z")]}
        initialHasMore={true}
      />
    );

    const button = screen.getByRole("button", { name: "Cargar anteriores" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ logs: [], hasMore: false }), { status: 200 }));
      await Promise.resolve();
    });
  });

  it("removes the control once the server reports hasMore:false", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ logs: [entry("log-1", "2026-01-01T00:00:00.000Z")], hasMore: false }), { status: 200 })
    );

    render(
      <StoryLog
        campaignId="camp-1"
        initialLogs={[entry("log-2", "2026-01-01T00:01:00.000Z")]}
        initialHasMore={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("StoryLog — router.refresh() interaction (simulated via rerender)", () => {
  it("preserves previously loaded older history, admits new logs, avoids duplicates, and keeps chronological order across a window slide", async () => {
    // Simulate: campaign has logs 1..102. Initial server window is 53..102
    // (the 50 most recent at that point). The player loads one older page
    // (3..52), then an action lands two new logs and router.refresh() moves
    // the server window to 55..104 — sliding 53 and 54 out of the *new*
    // window even though the player already saw them.
    const makeEntry = (n: number) => entry(`log-${n}`, `2026-01-01T${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00.000Z`);

    const initialWindow = Array.from({ length: 50 }, (_, i) => makeEntry(53 + i)); // 53..102
    const olderPage = {
      logs: Array.from({ length: 50 }, (_, i) => makeEntry(3 + i)), // 3..52
      hasMore: true,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(olderPage), { status: 200 })
    );

    const { rerender } = render(
      <StoryLog campaignId="camp-1" initialLogs={initialWindow} initialHasMore={true} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const items = within(chronicleRegion()).getAllByRole("listitem");
      expect(items).toHaveLength(100); // 3..102
    });

    // Simulate router.refresh(): the Server Component re-renders with a new
    // window that has slid forward and no longer includes log-53/log-54.
    const refreshedWindow = Array.from({ length: 50 }, (_, i) => makeEntry(55 + i)); // 55..104
    rerender(
      <StoryLog campaignId="camp-1" initialLogs={refreshedWindow} initialHasMore={true} />
    );

    await waitFor(() => {
      const items = within(chronicleRegion()).getAllByRole("listitem");
      // 3..104, no gaps, no duplicates: 102 rows.
      expect(items).toHaveLength(102);
    });

    const texts = within(chronicleRegion())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    // Previously loaded older history (3..52) survives the refresh.
    expect(texts.some((t) => t.includes("content-log-3"))).toBe(true);
    expect(texts.some((t) => t.includes("content-log-52"))).toBe(true);
    // Rows that slid out of the *new* server window (53, 54) are still present.
    expect(texts.some((t) => t.includes("content-log-53"))).toBe(true);
    expect(texts.some((t) => t.includes("content-log-54"))).toBe(true);
    // The newly arrived logs (103, 104) are present.
    expect(texts.some((t) => t.includes("content-log-103"))).toBe(true);
    expect(texts.some((t) => t.includes("content-log-104"))).toBe(true);
    // No duplicates: unique text set has the same length as the rendered list.
    expect(new Set(texts).size).toBe(texts.length);
    // Chronological order preserved end-to-end.
    expect(texts[0]).toContain("content-log-3");
    expect(texts[texts.length - 1]).toContain("content-log-104");

    // Only one fetch happened — the refresh itself must not trigger a request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reset hasMore to true after the player has already paginated to the true start of history", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ logs: [entry("log-1", "2026-01-01T00:00:01.000Z")], hasMore: false }), { status: 200 })
    );

    const { rerender } = render(
      <StoryLog
        campaignId="camp-1"
        initialLogs={[entry("log-2", "2026-01-01T00:00:02.000Z")]}
        initialHasMore={true}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cargar anteriores" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument());

    // A later router.refresh() re-renders with initialHasMore:true again —
    // the campaign has since grown past 50 recent logs — but the player
    // already has the true beginning of history loaded. The control must
    // stay gone.
    rerender(
      <StoryLog
        campaignId="camp-1"
        initialLogs={[entry("log-3", "2026-01-01T00:00:03.000Z")]}
        initialHasMore={true}
      />
    );

    expect(screen.queryByRole("button", { name: "Cargar anteriores" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
