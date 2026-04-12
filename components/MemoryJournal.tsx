/**
 * components/MemoryJournal.tsx
 *
 * Server Component — receives pre-fetched memory entries as props.
 * Displays the AI DM's consolidated session memories in reverse-chronological
 * order. Uses the same dark/diegetic visual language as the campaign page.
 *
 * No client-side JS required: purely static server-rendered HTML.
 */

interface MemoryEntry {
  id: string;
  content: string;
  importance: number;
  createdAt: Date | string;
}

interface MemoryJournalProps {
  memories: MemoryEntry[];
}

/**
 * Formats a Date (or ISO string) as a human-readable relative time label.
 * Runs server-side; no client hydration mismatch risk.
 */
function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function MemoryJournal({ memories }: MemoryJournalProps) {
  return (
    <section
      aria-label="Memory journal"
      className="rounded-lg p-5 space-y-3"
      style={{
        background: "rgba(12,12,22,0.92)",
        border: "1px solid rgba(99,102,241,0.18)",
        boxShadow: "inset 0 1px 0 rgba(165,180,252,0.03)",
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h2
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ fontFamily: "var(--font-cinzel)", color: "#9B93E0" }}
        >
          Cortex Memory
        </h2>
        {memories.length > 0 && (
          <span
            className="text-[9px] tabular-nums"
            style={{ color: "#756EB0" }}
          >
            {memories.length} {memories.length === 1 ? "record" : "records"}
          </span>
        )}
      </div>

      {/* Empty state */}
      {memories.length === 0 ? (
        <p
          className="text-xs leading-relaxed"
          style={{
            fontFamily: "var(--font-crimson)",
            fontStyle: "italic",
            color: "#3A3860",
          }}
        >
          The Dungeon Master remembers nothing yet.
          Play more to build your history.
        </p>
      ) : (
        <ol className="space-y-3" role="list">
          {memories.map((entry) => {
            // Importance > 1.5 gets a subtle amber highlight; default is purple-tinted
            const isHighImportance = entry.importance > 1.5;

            return (
              <li
                key={entry.id}
                className="rounded px-3 py-2.5 space-y-1.5"
                style={{
                  background: isHighImportance
                    ? "rgba(100,70,14,0.12)"
                    : "rgba(20,18,40,0.6)",
                  border: `1px solid ${isHighImportance ? "rgba(245,158,11,0.15)" : "rgba(99,102,241,0.1)"}`,
                }}
              >
                {/* Timestamp */}
                <p
                  className="text-[9px] uppercase tracking-widest"
                  style={{ color: isHighImportance ? "#B8921E" : "#756EB0" }}
                >
                  {formatRelative(entry.createdAt)}
                </p>

                {/* Content */}
                <p
                  className="text-xs leading-relaxed"
                  style={{
                    fontFamily: "var(--font-crimson)",
                    color: isHighImportance ? "#C8A870" : "#ABA7CF",
                    lineHeight: "1.65",
                  }}
                >
                  {entry.content}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
