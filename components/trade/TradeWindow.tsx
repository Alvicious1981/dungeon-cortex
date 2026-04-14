"use client";

import React, { memo, useEffect, useId, useState } from "react";
import type { MerchantPayload } from "@/lib/rules/trade";
import type { InventoryItem } from "@/app/generated/prisma/client";

// Re-using same rarity style logic as SpoilsOfWar
const RARITY_STYLE: Record<string, { color: string; border: string; bg: string; glow?: string }> = {
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

const RarityBadge = memo(function RarityBadge({ rarity }: { rarity: string }) {
  const s = RARITY_STYLE[rarity] || RARITY_STYLE.mundane;
  const label = rarity.replace("_", " ").toUpperCase();
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "2px",
        background: s.bg,
        border: `1px solid ${s.border}`,
        boxShadow: s.glow,
        fontFamily: "var(--font-cinzel)",
        fontSize: "0.5rem",
        fontWeight: 700,
        color: s.color,
        letterSpacing: "0.15em",
        verticalAlign: "middle"
      }}
    >
      {label}
    </span>
  );
});

export interface TradeResult {
  success: boolean;
  action: "buy" | "sell";
  itemName: string;
  quantity: number;
  goldDelta: number;
  newGoldBalance: number;
  error?: string;
}

export interface TradeWindowProps {
  merchant: MerchantPayload;
  playerInventory: InventoryItem[];
  gold: number;
  onBuy: (itemIndex: number, quantity: number) => Promise<TradeResult>;
  onSell: (inventoryItemId: string, quantity: number) => Promise<TradeResult>;
  onClose: () => void;
  isOpen: boolean;
}

export default memo(function TradeWindow({
  merchant,
  playerInventory,
  gold,
  onBuy,
  onSell,
  onClose,
  isOpen
}: TradeWindowProps) {
  const headingId = useId();
  const [flash, setFlash] = useState<{ amount: number; type: "buy" | "sell"; id: number } | null>(null);

  const modalRef = React.useRef<HTMLDivElement>(null);

  // Close on Escape & Focus Trap
  useEffect(() => {
    if (!isOpen) return;

    // Move focus to modal
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable && focusable.length > 0) {
      focusable[focusable.length - 1].focus(); // Focus Leave button
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      
      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElems = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusableElems[0];
        const last = focusableElems[focusableElems.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBuy = async (index: number) => {
    try {
      const res = await onBuy(index, 1);
      if (res.success) {
        setFlash({ amount: res.goldDelta, type: "buy", id: Date.now() });
      }
    } catch (err) {
      console.error("Trade failed", err);
    }
  };

  const handleSell = async (id: string) => {
    try {
      const res = await onSell(id, 1);
      if (res.success) {
        setFlash({ amount: res.goldDelta, type: "sell", id: Date.now() });
      }
    } catch (err) {
      console.error("Trade failed", err);
    }
  };

  return (
    <>
      <style>{`
        @keyframes dg-trade-in {
          from { opacity: 0; transform: scale(0.98); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes gold-flash {
          0% { transform: translateY(0); opacity: 1; font-weight: bold; }
          100% { transform: translateY(-20px); opacity: 0; font-weight: bold; }
        }
        .dg-trade-panel {
          animation: dg-trade-in 0.4s ease-out both;
        }
        .gold-anim {
          animation: gold-flash 1.2s ease-out forwards;
          position: absolute;
          right: -50px;
        }
        @media (prefers-reduced-motion: reduce) {
          .dg-trade-panel, .gold-anim { animation: none !important; }
        }
        .split-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }
        @media (max-width: 768px) {
          .split-layout {
            grid-template-columns: 1fr;
          }
        }
        .panel-column {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          height: 100%;
          overflow-y: auto;
          max-height: 50vh;
        }
      `}</style>
      
      {/* Backdrop */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10, 10, 14, 0.92)",
          zIndex: 1000,
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="dg-trade-panel"
        ref={modalRef}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1001,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "1rem"
        }}
      >
        <div style={{
          background: "var(--color-surface-elevated, #111)",
          border: "1px solid var(--color-amber-600, #d97706)",
          maxWidth: "900px",
          width: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "6px",
          overflow: "hidden"
        }}>
          {/* Header */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(179,139,45,0.2)" }}>
            <h2
              id={headingId}
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "var(--color-amber-400, #fbbf24)",
                margin: "0 0 8px 0"
              }}
            >
              🏪 {merchant.name} — {merchant.archetype.charAt(0).toUpperCase() + merchant.archetype.slice(1)}
            </h2>
            <blockquote
              style={{
                margin: 0,
                color: "var(--color-text-muted, #9ca3af)",
                fontStyle: "italic",
                fontFamily: "var(--font-crimson)",
                fontSize: "1.1rem"
              }}
            >
              {merchant.greeting}
            </blockquote>
          </div>

          {/* Gold Bar */}
          <div style={{
            background: "linear-gradient(90deg, #78350f, #b45309)",
            padding: "8px 24px",
            display: "flex",
            justifyContent: "center",
            borderBottom: "1px solid rgba(179,139,45,0.2)"
          }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "#fde68a"
              }}>
                💰 Party Gold: {gold} GP
              </span>
              {flash && (
                <span key={flash.id} className="gold-anim" style={{
                  color: flash.type === "sell" ? "#4ade80" : "#f87171",
                  fontFamily: "var(--font-cinzel)"
                }}>
                  {flash.type === "sell" ? "+" : ""}{flash.amount} GP
                </span>
              )}
            </div>
          </div>

          {/* Split Body */}
          <div className="split-layout" style={{ flex: 1, padding: "16px 24px", overflow: "hidden" }}>
            {/* Merchant Wares */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{
                fontFamily: "var(--font-cinzel)",
                color: "#d97706",
                fontSize: "1.1rem",
                borderBottom: "1px solid rgba(217, 119, 6, 0.3)",
                paddingBottom: "8px",
                marginBottom: "12px",
                marginTop: 0
              }}>Merchant Wares</h3>
              <div className="panel-column">
                {merchant.inventory.map((item) => {
                  const canAfford = gold >= item.buyPriceGP;
                  return (
                    <div key={item.index} style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "rgba(20,20,25,0.8)",
                      border: "1px solid rgba(179,139,45,0.15)",
                      padding: "8px 12px",
                      borderRadius: "4px"
                    }}>
                      <div style={{ flex: 1, paddingRight: "12px" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontFamily: "var(--font-cinzel)", fontSize: "0.9rem", color: "#e5e7eb", fontWeight: 600 }}>{item.name}</span>
                          <RarityBadge rarity={item.rarity} />
                        </div>
                        <div style={{ fontFamily: "var(--font-crimson)", fontSize: "0.8rem", color: "#9ca3af" }}>
                          {item.description}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                        <span style={{
                          fontFamily: "var(--font-cinzel)",
                          fontWeight: 700,
                          color: canAfford ? "#fde68a" : "#f87171"
                        }}>
                          Buy: {item.buyPriceGP} GP
                        </span>
                        <button
                          onClick={() => handleBuy(item.index)}
                          disabled={!canAfford}
                          aria-label={`Buy ${item.name} for ${item.buyPriceGP} gold`}
                          aria-disabled={!canAfford}
                          style={{
                            background: canAfford ? "linear-gradient(180deg, #d97706, #b45309)" : "#374151",
                            color: canAfford ? "#fff" : "#9ca3af",
                            border: "none",
                            padding: "4px 12px",
                            borderRadius: "3px",
                            fontFamily: "var(--font-cinzel)",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: canAfford ? "pointer" : "not-allowed",
                            boxShadow: canAfford ? "0 2px 4px rgba(0,0,0,0.5)" : "none"
                          }}
                        >
                          BUY
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Player Inventory */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{
                fontFamily: "var(--font-cinzel)",
                color: "#10b981",
                fontSize: "1.1rem",
                borderBottom: "1px solid rgba(16, 185, 129, 0.3)",
                paddingBottom: "8px",
                marginBottom: "12px",
                marginTop: 0
              }}>Your Inventory</h3>
              <div className="panel-column">
                {playerInventory.length === 0 ? (
                  <p style={{ color: "#6b7280", fontStyle: "italic", textAlign: "center", marginTop: "20px" }}>
                    Your inventory is empty.
                  </p>
                ) : (
                  playerInventory.map((item) => {
                    let baseValue = 0;
                    let itemRarity = "mundane";
                    if (item.properties && typeof item.properties === "object") {
                      if ("valueGP" in item.properties) {
                        baseValue = Number((item.properties as any).valueGP) || 0;
                      }
                      if ("_rarity" in item.properties) {
                        itemRarity = String((item.properties as any)._rarity);
                      } else if ("rarity" in item.properties) {
                        itemRarity = String((item.properties as any).rarity);
                      }
                    }
                    const sellPrice = Math.max(1, Math.floor(baseValue * merchant.sellModifier));
                    
                    const isEquipped = item.equippedSlot !== null;

                    return (
                      <div key={item.id} style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(20,20,25,0.8)",
                        border: "1px solid rgba(16, 185, 129, 0.15)",
                        padding: "8px 12px",
                        borderRadius: "4px"
                      }}>
                        <div style={{ flex: 1, paddingRight: "12px" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
                            <span style={{ fontFamily: "var(--font-cinzel)", fontSize: "0.9rem", color: "#e5e7eb", fontWeight: 600 }}>
                              {item.name} {item.quantity > 1 && `(x${item.quantity})`}
                            </span>
                            {isEquipped && (
                              <span style={{ fontSize: "0.6rem", color: "#fbbf24", border: "1px solid #fbbf24", padding: "1px 4px", borderRadius: "2px" }}>
                                EQUIPPED
                              </span>
                            )}
                          </div>
                          <div style={{ fontFamily: "var(--font-crimson)", fontSize: "0.8rem", color: "#9ca3af" }}>
                            {item.type} {itemRarity !== "mundane" && `· ${itemRarity.replace("_", " ")}`}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                          <span style={{
                            fontFamily: "var(--font-cinzel)",
                            fontWeight: 700,
                            color: "#a7f3d0"
                          }}>
                            Sell: {sellPrice} GP
                          </span>
                          <button
                            onClick={() => handleSell(item.id)}
                            disabled={isEquipped}
                            aria-label={`Sell ${item.name} for ${sellPrice} gold`}
                            style={{
                              background: isEquipped ? "#374151" : "linear-gradient(180deg, #059669, #047857)",
                              color: isEquipped ? "#9ca3af" : "#fff",
                              border: "none",
                              padding: "4px 12px",
                              borderRadius: "3px",
                              fontFamily: "var(--font-cinzel)",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: isEquipped ? "not-allowed" : "pointer",
                              boxShadow: isEquipped ? "none" : "0 2px 4px rgba(0,0,0,0.5)"
                            }}
                          >
                            SELL
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div style={{
            padding: "16px 24px",
            borderTop: "1px solid rgba(179,139,45,0.2)",
            display: "flex",
            justifyContent: "center"
          }}>
            <button
              onClick={onClose}
              style={{
                fontFamily: "var(--font-cinzel)",
                fontSize: "0.85rem",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#e5e7eb",
                background: "#374151",
                border: "1px solid #4b5563",
                borderRadius: "4px",
                padding: "8px 24px",
                cursor: "pointer",
                transition: "background 0.2s"
              }}
            >
              🚪 Leave the Market
            </button>
          </div>
        </div>
      </div>
    </>
  );
});
