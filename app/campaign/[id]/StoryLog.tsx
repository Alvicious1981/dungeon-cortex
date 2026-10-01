"use client";

/**
 * app/campaign/[id]/StoryLog.tsx — DC-AUD-006
 *
 * The Bitácora ("Story Log"). Renders the server's initial window of the
 * most recent GameLog rows (DC-AUD-005) and lets the player explicitly load
 * older pages via GET /api/campaign/[id]/logs, one bounded page at a time
 * (never infinite scroll, never the full history at once).
 *
 * Server ↔ client contract:
 *   - `initialLogs`/pages from the API always use the same total order —
 *     `createdAt DESC, id DESC` in the DB, reversed here to ASC for display.
 *     A plain `createdAt` compare can tie; `id` is the deterministic
 *     tiebreak on both ends.
 *   - Seen rows are kept in a Map keyed by `id`, seeded from `initialLogs`
 *     and only ever added to — never replaced wholesale. That is what lets
 *     a log survive `router.refresh()` after it slides out of the server's
 *     recent-50 window: the window prop changes, but the id stays in the
 *     map.
 *   - `initialHasMore` seeds state once, at mount. It is deliberately never
 *     re-applied from later renders of the same prop: the server's "have I
 *     shown 50-of-N" answer depends on the campaign's *current* size, not
 *     on how much of the actual, older history this viewer has already
 *     paged back through. Once paginated to the true start, only the
 *     player's own `/logs` fetches may flip `hasMore` again.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCampaignStory, type LiveStoryEntry } from "./CampaignStoryProvider";
import { StoryResults } from "./StoryResults";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoryLogEntry {
  id: string;
  role: string;
  content: string;
  /** ISO-8601 string — normalized server-side before crossing into this Client Component. */
  createdAt: string;
}

interface StoryLogProps {
  campaignId: string;
  initialLogs: StoryLogEntry[];
  initialHasMore: boolean;
}

interface LogsPageResponse {
  logs: StoryLogEntry[];
  hasMore: boolean;
}

const PAGE_LIMIT = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Total order: createdAt ascending, `id` breaks any tie. Deterministic even
 *  when several GameLog rows share a millisecond-precision createdAt. */
function compareChronological(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return at - bt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Cheap fingerprint of a logs window, used only to detect that the server
 *  actually sent a *different* window (not a merely-new array identity). */
function windowSignature(logs: StoryLogEntry[]): string {
  if (logs.length === 0) return "0";
  return `${logs.length}:${logs[0].id}:${logs[logs.length - 1].id}`;
}

type StoryFilter = "Todo" | "Relato" | "Sistema";
type DisplayEntry = { key: string; log: StoryLogEntry } | { key: string; live: LiveStoryEntry; persisted: boolean };

/** Match only newly loaded, exact text. Old repeated prose cannot consume a live response. */
function displayEntries(logs: StoryLogEntry[], live: LiveStoryEntry[]): DisplayEntry[] {
  const claimed = new Set<string>();
  const anchored = new Map<string, DisplayEntry>();
  const pending: DisplayEntry[] = [];
  for (const entry of live) {
    // Refusals have no persisted intention and cannot claim a later retry.
    if (entry.status === "refused") {
      pending.push({ key: `request:${entry.requestId}`, live: entry, persisted: false });
      continue;
    }
    const candidates = logs.filter((log) => !entry.baselineIds.has(log.id) && !claimed.has(log.id)
      && (!entry.afterLog || compareChronological(log, entry.afterLog) > 0));
    const intent = candidates.find((log) => log.role === "user" && log.content.trim() === entry.action.trim());
    const narrative = entry.narrative.trim() ? candidates.find((log) =>
      log.role === "assistant" && log.content.trim() === entry.narrative.trim()
      && (!intent || compareChronological(log, intent) >= 0)) : undefined;
    const row: DisplayEntry = { key: `request:${entry.requestId}`, live: entry, persisted: Boolean(narrative) };
    const anchor = intent ?? narrative;
    if (anchor) anchored.set(anchor.id, row);
    else pending.push(row);
    if (intent) claimed.add(intent.id);
    if (narrative) claimed.add(narrative.id);
  }
  const result: DisplayEntry[] = [];
  for (const log of logs) {
    const row = anchored.get(log.id);
    if (row) result.push(row);
    else if (!claimed.has(log.id)) result.push({ key: log.id, log });
  }
  return [...result, ...pending];
}

function Narrative({ children }: { children: string }) {
  return <p className="max-w-[70ch] whitespace-pre-wrap break-words text-[17px] leading-[1.75] text-[#ddd2bb] sm:text-lg"
    style={{ fontFamily: "var(--font-crimson)" }}>{children}</p>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoryLog({ campaignId, initialLogs, initialHasMore }: StoryLogProps) {
  const story = useCampaignStory();
  const sectionRef = useRef<HTMLElement>(null);
  const presentRef = useRef<HTMLDivElement>(null);
  const readingAnchorRef = useRef<{ key: string; top: number } | null>(null);
  const [filter, setFilter] = useState<StoryFilter>("Todo");
  const [search, setSearch] = useState("");
  const [presentSequence, setPresentSequence] = useState(0);
  // A live region is only spoken when it changes, so the same sentence set twice would be
  // silent. Each announcement is a keyed element: repeating it replaces the node.
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);
  const announcedRequests = useRef(new Set<string>());
  const [accumulated, setAccumulated] = useState<Map<string, StoryLogEntry>>(
    () => new Map(initialLogs.map((log) => [log.id, log]))
  );
  // Seeded once from the server's first answer — see file header for why
  // this must not be re-derived from `initialHasMore` on later renders.
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a double click firing two overlapping requests — a ref
  // because it must be read synchronously, before React commits the
  // `loading` state update (same guard shape as ActionInput's submittingRef).
  const loadingRef = useRef(false);
  const lastMergedSignatureRef = useRef(windowSignature(initialLogs));

  // Merge the server's live window whenever it actually changes (e.g. a new
  // turn lands and router.refresh() re-renders the page). Never replaces
  // `accumulated` — only adds/updates by id, so a row that slides out of the
  // new window is never lost once it has been seen.
  useEffect(() => {
    const signature = windowSignature(initialLogs);
    if (signature === lastMergedSignatureRef.current) return;
    lastMergedSignatureRef.current = signature;
    announce("Hay nuevas entradas en la bitácora.");
    setAccumulated((prev) => {
      const next = new Map(prev);
      for (const log of initialLogs) next.set(log.id, log);
      return next;
    });
  }, [initialLogs, announce]);

  const sorted = useMemo(
    () => [...accumulated.values()].sort(compareChronological),
    [accumulated]
  );

  const display = useMemo(() => displayEntries(sorted, story?.entries ?? []), [sorted, story?.entries]);
  const visible = display.filter((row) => {
    const content = "live" in row ? `${row.live.action} ${row.live.narrative}` : row.log.content;
    if (search.trim() && !content.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es"))) return false;
    if (filter === "Todo") return true;
    if ("live" in row) return filter === "Relato" || row.live.events.length > 0;
    return filter === "Relato" ? row.log.role === "assistant" || row.log.role === "user" : row.log.role !== "assistant" && row.log.role !== "user";
  });

  useEffect(() => { story?.actions.rememberLogs(sorted); }, [sorted, story?.actions]);
  useEffect(() => {
    for (const entry of story?.entries ?? []) {
      if ((entry.events.length || entry.narrative) && !announcedRequests.current.has(entry.requestId)) {
        announcedRequests.current.add(entry.requestId);
        announce("Nueva respuesta en la bitácora. Puedes volver al presente.");
      }
    }
  }, [story?.entries, announce]);

  useLayoutEffect(() => {
    const anchor = readingAnchorRef.current;
    if (!anchor) return;
    readingAnchorRef.current = null;
    const element = [...(sectionRef.current?.querySelectorAll<HTMLElement>("[data-story-entry]") ?? [])]
      .find((item) => item.dataset.storyEntry === anchor.key);
    if (element) {
      const difference = element.getBoundingClientRect().top - anchor.top;
      if (difference) window.scrollBy({ top: difference, behavior: "instant" });
    }
  }, [accumulated]);

  function returnToPresent() {
    setFilter("Todo");
    setSearch("");
    setPresentSequence((sequence) => sequence + 1);
  }

  useEffect(() => {
    if (presentSequence === 0) return;
    presentRef.current?.scrollIntoView?.({ block: "end", behavior: "auto" });
    presentRef.current?.focus({ preventScroll: true });
  }, [presentSequence]);

  const loadOlder = useCallback(async () => {
    if (loadingRef.current) return;
    const oldest = sorted[0];
    if (!oldest) return;

    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        before: oldest.createdAt,
        beforeId: oldest.id,
        limit: String(PAGE_LIMIT),
      });
      const res = await fetch(`/api/campaign/${campaignId}/logs?${qs.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `Error ${res.status}`);
        return;
      }
      const data: LogsPageResponse = await res.json();
      // Capture immediately before insertion: the reader may have moved while
      // the page was in flight. Restore that exact visible row after prepending.
      const visibleEntry = [...(sectionRef.current?.querySelectorAll<HTMLElement>("[data-story-entry]") ?? [])]
        .find((element) => element.getBoundingClientRect().bottom > 0 && element.getBoundingClientRect().top < window.innerHeight);
      if (visibleEntry?.dataset.storyEntry) {
        readingAnchorRef.current = { key: visibleEntry.dataset.storyEntry, top: visibleEntry.getBoundingClientRect().top };
      }
      setAccumulated((prev) => {
        const next = new Map(prev);
        for (const log of data.logs) next.set(log.id, log);
        return next;
      });
      setHasMore(data.hasMore);
    } catch {
      setError("No se pudo cargar el historial anterior. Vuelve a intentarlo.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [campaignId, sorted]);

  return (
    <section ref={sectionRef} aria-label="Bitácora de aventura" id="chronicle" tabIndex={-1}
      className="dc-panel dc-panel--narrative min-w-0 scroll-mt-20 rounded-sm p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-amber-200" style={{ fontFamily: "var(--font-cinzel)" }}>Bitácora</h2>
        {(sorted.length > 0 || Boolean(story?.entries.length)) && (
          <button type="button" onClick={returnToPresent} className="min-h-11 rounded px-3 text-sm text-amber-200 underline underline-offset-4">Volver al presente</button>
        )}
      </div>
      <div role="group" aria-label="Filtrar entradas cargadas" className="mb-4 flex flex-wrap gap-2">
        {(["Todo", "Relato", "Sistema"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}
            className={`min-h-11 rounded border px-4 text-sm ${filter === option ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-neutral-700 text-neutral-300"}`}>{option}</button>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement && <p key={announcement.id}>{announcement.text}</p>}
      </div>
      <div className="mb-4 space-y-2">
        <label htmlFor="story-search" className="block text-xs text-[var(--dc-text-muted)]">Buscar en las entradas cargadas</label>
        <div className="flex gap-2">
          <input id="story-search" type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Texto del relato o de tu intención" className="dc-field min-w-0 flex-1 px-3 text-base" />
          {search && <Button variant="ghost" size="compact" onClick={() => setSearch("")}>Limpiar</Button>}
        </div>
        {search && <p className="text-xs text-[var(--dc-text-muted)]">{visible.length} {visible.length === 1 ? "coincidencia" : "coincidencias"} en lo cargado. Carga entradas anteriores para ampliar la búsqueda.</p>}
      </div>
      {hasMore && (
        <div className="mb-4 flex flex-col items-start gap-2">
          <Button type="button" variant="secondary" loading={loading} onClick={() => void loadOlder()}>Cargar anteriores</Button>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
      )}
      {display.length === 0 ? (
        <p className="py-8 text-base italic leading-relaxed text-neutral-300">Aún no hay entradas. Describe qué intenta hacer tu personaje para comenzar.</p>
      ) : visible.length === 0 ? (
        <p className="py-5 text-sm text-neutral-400">{search ? "No hay coincidencias con los filtros actuales." : "No hay entradas de este tipo entre las que has cargado."}</p>
      ) : (
        <ul className="space-y-5" role="list">
          {visible.map((row) => {
            if ("live" in row) {
              const entry = row.live;
              return (
                <li key={row.key} data-story-entry={row.key} className="min-w-0 space-y-3 border-b border-amber-900/25 pb-5">
                  {filter !== "Sistema" && (
                    <div className="border-l-2 border-amber-500/60 pl-3">
                      <p className="mb-1 text-xs font-semibold text-amber-300">Tu intención</p>
                      <p className="max-w-[70ch] whitespace-pre-wrap break-words text-sm text-amber-100">{entry.action}</p>
                    </div>
                  )}
                  {filter !== "Relato" && <StoryResults events={entry.events} />}
                  {filter !== "Sistema" && (entry.narrative || entry.status === "receiving") && (
                    <div className="min-h-[4.5rem]">
                      <p className="mb-1 text-xs font-semibold text-[#c5aa74]">Relato</p>
                      {entry.narrative ? <Narrative>{entry.narrative}</Narrative> : <p className="text-sm text-neutral-400">Esperando el relato…</p>}
                    </div>
                  )}
                  {filter === "Todo" && entry.status === "uncertain" && <p className="text-sm text-amber-200">Conexión interrumpida. Comprueba la acción en los controles.</p>}
                  {filter === "Todo" && entry.status === "refused" && <p className="text-sm text-red-300">Acción rechazada. Revisa el aviso junto a los controles.</p>}
                  {filter !== "Sistema" && entry.narrative && entry.status === "receiving" && <p className="text-xs text-neutral-400">Recibiendo relato…</p>}
                  {filter !== "Sistema" && entry.narrative && entry.status === "received" && !row.persisted && <p className="text-xs text-neutral-400">Relato recibido. Sincronizando la bitácora…</p>}
                </li>
              );
            }
            const log = row.log;
            return (
              <li key={row.key} data-story-entry={row.key} className={`min-w-0 ${log.role === "user" ? "border-l-2 border-amber-500/60 pl-3" : log.role === "assistant" ? "py-1" : "rounded bg-neutral-900/40 px-3 py-2"}`}>
                <p className={`mb-1 text-xs font-semibold ${log.role === "user" ? "text-amber-300" : "text-[#c5aa74]"}`}>
                  {log.role === "assistant" ? "Relato" : log.role === "user" ? "Tu intención" : "Sistema"}
                </p>
                {log.role === "assistant" ? <Narrative>{log.content}</Narrative> : <p className={`max-w-[70ch] whitespace-pre-wrap break-words text-sm leading-relaxed ${log.role === "user" ? "text-amber-100" : "text-neutral-300"}`}>{log.content}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={presentRef} tabIndex={-1} aria-label="Presente de la bitácora" className="mt-2 outline-none" />
    </section>
  );
}
