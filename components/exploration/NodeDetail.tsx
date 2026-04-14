"use client";

/**
 * components/exploration/NodeDetail.tsx
 *
 * Detail panel for the currently occupied exploration node.
 * Displays name, description, feature type, and move buttons for exits.
 *
 * Receives all state from ExplorationPanel — no direct data fetching.
 */

import type { ContextExplorationNode } from "@/lib/memory/context";

// ─── Passage type labels + colors ────────────────────────────────────────────

const PASSAGE_LABEL: Record<string, string> = {
  open:      "Open",
  door:      "Door",
  locked:    "Locked",
  hidden:    "Hidden",
  collapsed: "Collapsed",
};

const PASSAGE_ICON: Record<string, string> = {
  open:      "→",
  door:      "⛩",
  locked:    "🔒",
  hidden:    "?",
  collapsed: "✗",
};

const PASSAGE_COLOR: Record<string, string> = {
  open:      "#A89070",
  door:      "#C49A2A",
  locked:    "#E05050",
  hidden:    "#8070B0",
  collapsed: "#505060",
};

// ─── Feature labels ──────────────────────────────────────────────────────────

const FEATURE_ICONS: Record<string, string> = {
  npc:        "◆",
  hazard:     "⚠",
  treasure:   "🗃",
  quest_hook: "📜",
  rest:       "🔥",
  shop:       "💰",
  exit:       "🚪",
  empty:      "",
};

const FEATURE_LABELS: Record<string, string> = {
  npc:        "NPC Present",
  hazard:     "Hazard",
  treasure:   "Treasure",
  quest_hook: "Quest Hook",
  rest:       "Rest Point",
  shop:       "Vendor",
  exit:       "Exit",
  empty:      "Empty",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NodeDetailProps {
  currentNode: ContextExplorationNode;
  adjacentNodes: Array<{ node: ContextExplorationNode; passageType: string }>;
  onMoveToNode: (index: number) => void;
  isMoving: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NodeDetail({
  currentNode,
  adjacentNodes,
  onMoveToNode,
  isMoving,
}: NodeDetailProps) {
  const featureIcon  = FEATURE_ICONS[currentNode.feature] ?? "";
  const featureLabel = FEATURE_LABELS[currentNode.feature] ?? currentNode.feature;

  return (
    <div
      role="complementary"
      aria-label={`Details for current room: ${currentNode.name}`}
      style={{
        background: "rgba(12,12,22,0.96)",
        borderTop: "1px solid rgba(100,70,14,0.3)",
        padding: "12px 16px 14px",
      }}
    >
      {/* ── Room name ── */}
      <p
        style={{
          fontFamily: "var(--font-cinzel, serif)",
          fontSize: 14,
          fontWeight: 700,
          color: "#E8C84A",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {featureIcon && <span aria-hidden="true" style={{ marginRight: 5 }}>{featureIcon}</span>}
        {currentNode.name}
      </p>

      {/* ── Room description ── */}
      <p
        style={{
          fontFamily: "var(--font-crimson, serif)",
          fontSize: 13,
          fontStyle: "italic",
          color: "#A89070",
          lineHeight: 1.65,
          marginBottom: 8,
        }}
      >
        {currentNode.description}
      </p>

      {/* ── Feature tag ── */}
      {currentNode.feature !== "empty" && (
        <p
          style={{
            fontSize: 10,
            fontFamily: "var(--font-cinzel, serif)",
            color: "#7A6A50",
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            marginBottom: 10,
          }}
        >
          Feature: {featureLabel}
          {currentNode.npcSeed && (
            <span style={{ color: "#6060A0", marginLeft: 6 }}>
              [{currentNode.npcSeed}]
            </span>
          )}
        </p>
      )}

      {/* ── Exits ── */}
      {adjacentNodes.length === 0 ? (
        <p
          style={{
            fontSize: 11,
            fontFamily: "var(--font-crimson, serif)",
            fontStyle: "italic",
            color: "#5A5040",
          }}
        >
          No exits. Dead end.
        </p>
      ) : (
        <div>
          <p
            style={{
              fontSize: 10,
              fontFamily: "var(--font-cinzel, serif)",
              color: "#7A6A50",
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              marginBottom: 6,
            }}
          >
            Exits ({adjacentNodes.length})
          </p>
          <ul
            role="list"
            style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 6 }}
          >
            {adjacentNodes.map(({ node, passageType }) => {
              const pIcon  = PASSAGE_ICON[passageType] ?? "→";
              const pColor = PASSAGE_COLOR[passageType] ?? "#A89070";
              const pLabel = PASSAGE_LABEL[passageType] ?? passageType;
              const isBlocked = passageType === "locked" || passageType === "collapsed";

              return (
                <li key={node.index}>
                  <button
                    type="button"
                    disabled={isMoving || isBlocked}
                    onClick={() => !isBlocked && onMoveToNode(node.index)}
                    aria-label={`Move to ${node.name} via ${pLabel} passage${isBlocked ? " (blocked)" : ""}`}
                    title={isBlocked ? `${pLabel} — cannot pass` : `Move to ${node.name}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 4,
                      border: `1px solid ${isBlocked ? "rgba(80,80,96,0.4)" : "rgba(228,168,50,0.25)"}`,
                      background: isBlocked
                        ? "rgba(20,20,30,0.5)"
                        : isMoving
                        ? "rgba(20,20,30,0.7)"
                        : "rgba(30,22,5,0.8)",
                      cursor: isMoving ? "wait" : isBlocked ? "not-allowed" : "pointer",
                      fontFamily: "var(--font-cinzel, serif)",
                      fontSize: 10,
                      color: isBlocked ? "#505060" : "#C8B080",
                      letterSpacing: "0.06em",
                      transition: "background 120ms, border-color 120ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!isBlocked && !isMoving) {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(60,44,10,0.9)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(228,168,50,0.5)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = isBlocked
                        ? "rgba(20,20,30,0.5)"
                        : "rgba(30,22,5,0.8)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = isBlocked
                        ? "rgba(80,80,96,0.4)"
                        : "rgba(228,168,50,0.25)";
                    }}
                  >
                    <span aria-hidden="true" style={{ color: pColor, fontSize: 11 }}>
                      {pIcon}
                    </span>
                    <span>{node.name.length > 14 ? node.name.slice(0, 13) + "…" : node.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
