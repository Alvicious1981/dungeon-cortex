/**
 * components/QuestTracker.tsx
 *
 * Server Component — receives pre-fetched quest entries as props.
 * Displays active and completed quests for the current campaign.
 * Uses the same dark/diegetic visual language as the rest of the campaign page.
 *
 * No client-side JS required: purely static server-rendered HTML.
 */

type QuestStatus = "active" | "completed" | "failed";

interface Quest {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: Date | string;
  /** Primary location the quest takes place in or leads to. */
  location?: string | null;
  /** Narrative hook — the inciting atmospheric detail. */
  hook?: string | null;
  /** The specific objective the party must accomplish. */
  objective?: string | null;
  /** What the party gains on completion. */
  reward?: string | null;
}

interface QuestTrackerProps {
  quests: Quest[];
}

const STATUS_CONFIG: Record<
  QuestStatus,
  { label: string; glyph: string; borderColor: string; textColor: string; bg: string; labelColor: string }
> = {
  active: {
    label: "Active",
    glyph: "◈",
    borderColor: "rgba(245,158,11,0.22)",
    textColor: "#C8B898",
    bg: "rgba(100,70,14,0.1)",
    labelColor: "#F59E0B",
  },
  completed: {
    label: "Completed",
    glyph: "✓",
    borderColor: "rgba(34,197,94,0.18)",
    textColor: "#86EFAC",
    bg: "rgba(20,60,30,0.15)",
    labelColor: "#22C55E",
  },
  failed: {
    label: "Failed",
    glyph: "✕",
    borderColor: "rgba(239,68,68,0.18)",
    textColor: "#FCA5A5",
    bg: "rgba(60,10,10,0.15)",
    labelColor: "#EF4444",
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status as QuestStatus] ?? STATUS_CONFIG.active;
}

// Render order: active quests first, then completed, then failed
const STATUS_ORDER: QuestStatus[] = ["active", "completed", "failed"];

export default function QuestTracker({ quests }: QuestTrackerProps) {
  const grouped = STATUS_ORDER.reduce<Record<QuestStatus, Quest[]>>(
    (acc, s) => {
      acc[s] = quests.filter((q) => q.status === s);
      return acc;
    },
    { active: [], completed: [], failed: [] }
  );

  const activeCount = grouped.active.length;

  return (
    <section
      aria-label="Quest tracker"
      className="rounded-lg p-5 space-y-3"
      style={{
        background: "rgba(12,12,22,0.92)",
        border: "1px solid rgba(228,168,50,0.18)",
        boxShadow: "inset 0 1px 0 rgba(255,220,80,0.04)",
      }}
    >
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <h2
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ fontFamily: "var(--font-cinzel)", color: "#C49A2A" }}
        >
          Quest Log
        </h2>
        {activeCount > 0 && (
          <span
            className="text-[9px] tabular-nums"
            style={{ color: "#B8921E" }}
          >
            {activeCount} active
          </span>
        )}
      </div>

      {/* Empty state */}
      {quests.length === 0 ? (
        <p
          className="text-xs leading-relaxed"
          style={{
            fontFamily: "var(--font-crimson)",
            fontStyle: "italic",
            color: "#7A6A50",
          }}
        >
          No quests yet. Speak with the world and your purpose will reveal itself.
        </p>
      ) : (
        <div className="space-y-4">
          {STATUS_ORDER.map((status) => {
            const group = grouped[status];
            if (group.length === 0) return null;
            const cfg = getStatusConfig(status);

            return (
              <div key={status}>
                {/* Status group label */}
                <h3
                  className="mb-1.5 text-[9px] uppercase tracking-widest font-semibold"
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    color: cfg.labelColor,
                    opacity: 0.75,
                  }}
                >
                  {cfg.label}
                </h3>

                <ul className="space-y-2" role="list">
                  {group.map((quest) => (
                    <QuestCard key={quest.id} quest={quest} status={status} cfg={cfg} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Quest Card ──────────────────────────────────────────────────────────────

function QuestCard({
  quest,
  status,
  cfg,
}: {
  quest: Quest;
  status: QuestStatus;
  cfg: (typeof STATUS_CONFIG)[QuestStatus];
}) {
  const isActive = status === "active";

  return (
    <li
      className="rounded px-3 py-2.5 space-y-2"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.borderColor}`,
      }}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[10px] leading-none"
          style={{ color: cfg.labelColor, opacity: 0.8 }}
        >
          {cfg.glyph}
        </span>
        <span
          className="text-sm font-medium leading-snug"
          style={{
            fontFamily: "var(--font-cinzel)",
            color: isActive ? "#E8C84A" : cfg.textColor,
            fontSize: "0.8rem",
            letterSpacing: "0.02em",
          }}
        >
          {quest.title}
        </span>
      </div>

      {/* Hook — atmospheric inciting detail; visually distinct */}
      {quest.hook && (
        <blockquote
          className="pl-3 leading-relaxed"
          style={{
            borderLeft: "2px solid rgba(228,168,50,0.35)",
            margin: 0,
          }}
        >
          <p
            className="text-xs"
            style={{
              fontFamily: "var(--font-crimson)",
              fontStyle: "italic",
              color: isActive ? "#D4BC88" : "#7A6A50",
              lineHeight: "1.65",
            }}
          >
            {quest.hook}
          </p>
        </blockquote>
      )}

      {/* Description (if no hook, or supplementary) */}
      {quest.description && !quest.hook && (
        <p
          className="text-xs leading-relaxed pl-4"
          style={{
            fontFamily: "var(--font-crimson)",
            color: isActive ? "#C8B898" : "#7A6A50",
            lineHeight: "1.6",
            fontStyle: "italic",
          }}
        >
          {quest.description}
        </p>
      )}

      {/* Procedural detail rows: location, objective, reward */}
      {(quest.location || quest.objective || quest.reward) && (
        <dl className="space-y-1 pl-4">
          {quest.location && (
            <QuestDetailRow
              glyph="◎"
              label="Where"
              value={quest.location}
              isActive={isActive}
              valueColor={isActive ? "#C8B898" : "#7A6A50"}
            />
          )}
          {quest.objective && (
            <QuestDetailRow
              glyph="⊕"
              label="Objective"
              value={quest.objective}
              isActive={isActive}
              valueColor={isActive ? "#C8B898" : "#7A6A50"}
            />
          )}
          {quest.reward && (
            <QuestDetailRow
              glyph="◆"
              label="Reward"
              value={quest.reward}
              isActive={isActive}
              valueColor={isActive ? "#E8C84A" : "#7A6A50"}
            />
          )}
        </dl>
      )}
    </li>
  );
}

function QuestDetailRow({
  glyph,
  label,
  value,
  isActive,
  valueColor,
}: {
  glyph: string;
  label: string;
  value: string;
  isActive: boolean;
  valueColor: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        aria-hidden="true"
        className="shrink-0 text-[8px]"
        style={{ color: isActive ? "rgba(228,168,50,0.5)" : "rgba(120,100,60,0.4)" }}
      >
        {glyph}
      </span>
      <dt
        className="shrink-0 text-[9px] uppercase tracking-widest"
        style={{ fontFamily: "var(--font-cinzel)", color: isActive ? "#8A7040" : "#5A4830" }}
      >
        {label}
      </dt>
      <dd
        className="text-[11px] leading-snug"
        style={{ fontFamily: "var(--font-crimson)", color: valueColor, margin: 0 }}
      >
        {value}
      </dd>
    </div>
  );
}
