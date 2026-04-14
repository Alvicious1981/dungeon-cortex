"use client";

import { useEffect, useState } from "react";
import TradeWindow from "./TradeWindow";
import type { MerchantPayload, TradeResult } from "@/lib/rules/trade";
import type { InventoryItem } from "@/app/generated/prisma/client";
import { executeTradeAction } from "@/app/actions/trade";

export default function TradeOverlayController({ 
  campaignId, 
  initialGold, 
  playerInventory 
}: { 
  campaignId: string; 
  initialGold: number;
  playerInventory: InventoryItem[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [merchant, setMerchant] = useState<MerchantPayload | null>(null);

  useEffect(() => {
    function handleMerchantEvent(e: Event) {
      const customEvent = e as CustomEvent<MerchantPayload>;
      setMerchant(customEvent.detail);
      setIsOpen(true);
    }

    window.addEventListener("dungeon-merchant", handleMerchantEvent);
    return () => window.removeEventListener("dungeon-merchant", handleMerchantEvent);
  }, []);

  if (!isOpen || !merchant) return null;

  const handleBuy = async (itemIndex: number, quantity: number): Promise<TradeResult> => {
    return executeTradeAction(
      campaignId,
      "buy",
      itemIndex,
      undefined,
      quantity,
      merchant.npcSeed,
      merchant.archetype
    );
  };

  const handleSell = async (inventoryItemId: string, quantity: number): Promise<TradeResult> => {
    return executeTradeAction(
      campaignId,
      "sell",
      undefined,
      inventoryItemId,
      quantity,
      merchant.npcSeed,
      merchant.archetype
    );
  };

  return (
    <TradeWindow
      merchant={merchant}
      playerInventory={playerInventory}
      gold={initialGold}
      onBuy={handleBuy}
      onSell={handleSell}
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
        setMerchant(null);
      }}
    />
  );
}
