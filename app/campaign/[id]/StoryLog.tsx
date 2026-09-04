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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

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
function compareChronological(a: StoryLogEntry, b: StoryLogEntry): number {
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoryLog({ campaignId, initialLogs, initialHasMore }: StoryLogProps) {
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
    setAccumulated((prev) => {
      const next = new Map(prev);
      for (const log of initialLogs) next.set(log.id, log);
      return next;
    });
  }, [initialLogs]);

  const sorted = useMemo(
    () => [...accumulated.values()].sort(compareChronological),
    [accumulated]
  );

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
    <section
      aria-label="Bitácora de aventura"
      id="chronicle"
      className="dc-panel dc-panel--narrative scroll-mt-20 rounded-sm p-4 sm:p-5"
    >
      <p
        className="mb-3 text-[10px] uppercase tracking-[0.3em]"
        style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
      >
        Bitácora
      </p>

      {hasMore && (
        <div className="mb-3 flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            loading={loading}
            onClick={() => void loadOlder()}
          >
            Cargar anteriores
          </Button>
          {error && (
            <p
              aria-live="polite"
              className="text-xs"
              style={{ color: "#EF4444", fontFamily: "var(--font-crimson)" }}
            >
              {error}
            </p>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        <div
          className="rounded-lg p-10 text-center"
          style={{
            background: "rgba(12,12,22,0.6)",
            border: "1px dashed rgba(100,70,14,0.3)",
          }}
        >
          <p
            className="text-sm"
            style={{ fontFamily: "var(--font-crimson)", fontStyle: "italic", color: "#7A6A50", lineHeight: "1.75" }}
          >
            Aún no hay entradas. Describe qué intenta hacer tu personaje para comenzar.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" role="list">
          {sorted.map((log) => {
            const isDM = log.role === "assistant";
            const isPlayer = log.role === "user";
            return (
              <li
                key={log.id}
                className="rounded-lg px-4 py-3"
                style={
                  isDM
                    ? {
                        background: "rgba(12,12,22,0.92)",
                        border: "1px solid rgba(100,70,14,0.25)",
                        color: "#C8BEA0",
                      }
                    : isPlayer
                    ? {
                        background: "rgba(25,16,3,0.7)",
                        border: "1px solid rgba(228,168,50,0.22)",
                        color: "#E8C84A",
                      }
                    : {
                        background: "rgba(8,8,18,0.6)",
                        border: "1px solid rgba(99,102,241,0.15)",
                        color: "#7872A8",
                      }
                }
              >
                <span
                  className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.2em]"
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    color: isDM ? "#C49A2A" : isPlayer ? "#F59E0B" : "#5B56A0",
                  }}
                >
                  {isDM ? "Director de Mazmorras" : isPlayer ? "Tú" : "Sistema"}
                </span>
                <p
                  className="text-sm leading-relaxed"
                  style={{
                    fontFamily: isDM ? "var(--font-crimson)" : "inherit",
                    fontSize: isDM ? "0.9375rem" : "0.875rem",
                    lineHeight: isDM ? "1.75" : "1.6",
                  }}
                >
                  {log.content}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
