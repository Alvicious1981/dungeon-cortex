"use client";

/**
 * components/combat/SpoilsOfWar.tsx
 *
 * Post-combat "Spoils of War" overlay — Iron Grimoire aesthetic.
 *
 * Renders over the VTT when all enemies are defeated and the `generateLoot`
 * tool has returned a LootPayload. Displays gold, mundane items, and magic
 * items with visual distinction by rarity. Dismissible via button or Escape.
 *
 * Accessibility:
 *   role="dialog" + aria-modal="true" + aria-labelledby → screen-reader friendly.
 *   Escape key dismisses the overlay (keyboard users).
 *
 * Animations:
 *   CSS @keyframes fadeIn for the backdrop and panel entrance.
 *   All animations respect prefers-reduced-motion.
 */

import React, { memo, useEffect, useId } from "react";
import type { LootPayload, LootRarity, LootItem } from "@/lib/rules/loot";

// ---------------------------------------------------------------------------
// Rarity colour tokens — dark-fantasy palette
// ---------------------------------------------------------------------------

const RARITY_STYLE: Record<
  LootRarity,
  { color: string; border: string; bg: string; glow?: string }
> = {
  mundane:   { color: "hsl(0 0% 55%)",     border: "rgba(120,120,120,0.35)", bg: "rgba(40,40,40,0.6)" },
  uncommon:  { color: "hsl(145 42% 48%)",  border: "rgba(72,160,96,0.4)",   bg: "rgba(20,50,30,0.6)" },
  rare:      { color: "hsl(215 62% 55%)",  border: "rgba(70,120,200,0.4)",  bg: "rgba(20,30,60,0.6)" },
  very_rare: { color: "hsl(270 52% 60%)",  border: "rgba(150,80,220,0.4)",  bg: "rgba(35,15,55,0.6)" },
  legendary: {
    color:  "hsl(40 100% 58%)",
    border: "rgba(228,168,50,0.55)",
    bg:     "rgba(50,35,5,0.7)",
    glow:   "0 0 10px rgba(228,168,50,0.35)",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const RarityBadge = memo(function RarityBadge({ rarity }: { rarity: LootRarity }) {
  const s = RARITY_STYLE[rarity];
  const label = rarity.replace("_", " ").toUpperCase();
  return (
    <span
      data-testid="rarity-badge"
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "3px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        boxShadow: s.glow,
        fontFamily: "var(--font-cinzel)",
        fontSize: "0.55rem",
        fontWeight: 700,
        color: s.color,
        letterSpacing: "0.18em",
      }}
    >
      {label}
    </span>
  );
});

const ItemRow = memo(function ItemRow({ item }: { item: LootItem }) {
  const s = RARITY_STYLE[item.rarity];
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "6px 8px",
        borderRadius: "3px",
        background: "rgba(12,10,20,0.6)",
        border: `1px solid ${s.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span
          style={{
            fontFamily: "var(--font-cinzel)",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: s.color,
            boxShadow: s.glow,
          }}
        >
          {item.name}
        </span>
        {item.rarity !== "mundane" && (
          <span
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.45rem",
              fontWeight: 700,
              color: s.color,
              border: `1px solid ${s.border}`,
              borderRadius: "2px",
              padding: "1px 5px",
              letterSpacing: "0.12em",
              opacity: 0.85,
            }}
          >
            {item.rarity.replace("_", " ").toUpperCase()}
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-crimson)",
            fontSize: "0.65rem",
            color: "rgba(179,139,45,0.6)",
          }}
        >
          {item.valueGP} GP
        </span>
      </div>
      <p
        style={{
          fontFamily: "var(--font-crimson)",
          fontSize: "0.72rem",
          fontStyle: "italic",
          color: "rgba(180,165,140,0.7)",
          margin: 0,
          lineHeight: 1.35,
        }}
      >
        {item.description}
      </p>
    </li>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface SpoilsOfWarProps {
  payload: LootPayload;
  onClaim: () => void;
}

export default memo(function SpoilsOfWar({ payload, onClaim }: SpoilsOfWarProps) {
  const headingId = useId();

  // Escape-key dismissal
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClaim();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClaim]);

  const allItems = [...payload.mundaneItems, ...payload.magicItems];
  const totalItems = allItems.length;

  return (
    <>
      {/* Inline animation styles — scoped to this component */}
      <style>{`
        @keyframes dg-spoils-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dg-spoils-panel { animation: none !important; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(4,4,10,0.88)",
          zIndex: 10,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dg-spoils-panel"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 11,
          display: "flex",
          flexDirection: "column",
          padding: "20px 16px 16px",
          overflowY: "auto",
          animation: "dg-spoils-in 0.4s ease-out both",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "14px",
          }}
        >
          <h2
            id={headingId}
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "#C49A2A",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            ⚔ The Spoils of War ⚔
          </h2>
          <RarityBadge rarity={payload.rarityBracket} />
        </div>

        {/* ── Gold ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            marginBottom: "14px",
            padding: "8px 12px",
            borderRadius: "4px",
            background: "rgba(50,35,5,0.55)",
            border: "1px solid rgba(179,139,45,0.25)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "1rem",
              color: "#C49A2A",
            }}
          >
            ◈
          </span>
          <span
            data-testid="gold-amount"
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.8rem",
              fontWeight: 700,
              color: "#E4A832",
              letterSpacing: "0.06em",
            }}
          >
            {payload.gold} Gold Pieces
          </span>
        </div>

        {/* ── Items ── */}
        {totalItems > 0 && (
          <div style={{ marginBottom: "14px" }}>
            {/* Mundane items */}
            {payload.mundaneItems.length > 0 && (
              <div style={{ marginBottom: "10px" }}>
                <p
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    fontSize: "0.5rem",
                    fontWeight: 700,
                    color: "rgba(179,139,45,0.45)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                    borderBottom: "1px solid rgba(60,40,10,0.4)",
                    paddingBottom: "4px",
                  }}
                >
                  Mundane Items
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
                  {payload.mundaneItems.map((item, i) => (
                    <ItemRow key={i} item={item} />
                  ))}
                </ul>
              </div>
            )}

            {/* Magic items */}
            {payload.magicItems.length > 0 && (
              <div data-testid="magic-items-section">
                <p
                  style={{
                    fontFamily: "var(--font-cinzel)",
                    fontSize: "0.5rem",
                    fontWeight: 700,
                    color: "rgba(179,139,45,0.45)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                    borderBottom: "1px solid rgba(60,40,10,0.4)",
                    paddingBottom: "4px",
                  }}
                >
                  Magic Items
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
                  {payload.magicItems.map((item, i) => (
                    <ItemRow key={i} item={item} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Flavor text ── */}
        <blockquote
          style={{
            margin: "0 0 16px",
            padding: "8px 12px",
            borderLeft: "2px solid rgba(179,139,45,0.3)",
            borderRadius: "0 3px 3px 0",
            background: "rgba(10,10,18,0.5)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-crimson)",
              fontSize: "0.8rem",
              fontStyle: "italic",
              color: "rgba(200,185,155,0.8)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {payload.flavorText}
          </p>
        </blockquote>

        {/* ── Claim button ── */}
        <div style={{ textAlign: "center", marginTop: "auto" }}>
          <button
            type="button"
            onClick={onClaim}
            style={{
              fontFamily: "var(--font-cinzel)",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#C49A2A",
              background: "rgba(12,10,20,0.9)",
              border: "1px solid rgba(179,139,45,0.4)",
              borderRadius: "4px",
              padding: "8px 24px",
              cursor: "pointer",
              boxShadow: "0 0 12px rgba(179,139,45,0.1)",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          >
            ⚔ Claim &amp; Continue
          </button>
        </div>
      </div>
    </>
  );
});
