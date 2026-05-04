"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CombatHUD from "./CombatHUD";
import type { ActionStreamFrame, CombatConsequencePayload } from "@/lib/events/game-events";
import { applyCombatTargetsToCombatants } from "./combat-state";

function isCombatConsequencePayload(
  p: Record<string, unknown>
): p is CombatConsequencePayload {
  return Array.isArray(p.targets);
}

interface Props {
  campaignId: string;
  combatants: Array<{
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    initiativeTotal: number;
    conditions: string[];
  }>;
  activeTurnIndex: number;
}

export default function CombatHUDController({
  campaignId,
  combatants,
  activeTurnIndex,
}: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  // Transient state for immediate visual feedback during AI narration
  const [localCombatants, setLocalCombatants] = useState(combatants);
  const [localTurnIndex, setLocalTurnIndex] = useState(activeTurnIndex);

  // Sync local state when server data updates and we are not in the middle of an action
  useEffect(() => {
    if (!isPending) {
      setLocalCombatants(combatants);
      setLocalTurnIndex(activeTurnIndex);
    }
  }, [combatants, activeTurnIndex, isPending]);

  async function handleAction(action: string) {
    if (isPending) return;

    // Satisfy browser gesture policy for AudioContext in GameEventHandler
    window.dispatchEvent(new CustomEvent("dungeon-action-start"));

    setIsPending(true);
    try {
      const response = await fetch(`/api/campaign/${campaignId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok || !response.body) {
        console.error("Failed to trigger action:", action);
        setIsPending(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          
          try {
            const frame = JSON.parse(line.slice(6)) as ActionStreamFrame;
            
            // 1. Dispatch global event (Sound/Effects)
            if (frame.t === "evt") {
              window.dispatchEvent(new CustomEvent("dungeon-game-event", {
                detail: { event: frame.e }
              }));

              // 2. Map to local HUD state for immediate visual feedback
              if (frame.e.type === "COMBAT_CONSEQUENCE") {
                const raw = frame.e.payload as Record<string, unknown>;
                if (isCombatConsequencePayload(raw)) {
                  setLocalCombatants((current) =>
                    applyCombatTargetsToCombatants(current, raw.targets)
                  );
                }
              } else if (frame.e.type === "TURN_ADVANCE" || frame.e.type === "ROUND_ADVANCE") {
                const nextId = frame.e.payload.nextTurnIndex;
                if (typeof nextId === "number") {
                  setLocalTurnIndex(nextId);
                }
              }
            } else if (frame.t === "done") {
              // Final authoritative sync
              router.refresh();
            }
          } catch (e) {
            console.warn("[CombatHUD] Frame parse error:", e);
          }
        }
      }
    } catch (error) {
      console.error("Error triggering action:", error);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <CombatHUD
      combatants={localCombatants}
      activeTurnIndex={localTurnIndex}
      onActionTrigger={handleAction}
    />
  );
}
