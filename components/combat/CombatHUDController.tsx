"use client";

import { useEffect, useState } from "react";
import CombatHUD from "./CombatHUD";
import type { GameEvent } from "@/lib/events/game-events";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_START,
  requestDungeonAction,
} from "@/lib/events/action-transport";
import { applyCombatTargetsToCombatants } from "./combat-state";

interface Props {
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
  combatants,
  activeTurnIndex,
}: Props) {
  const [isPending, setIsPending] = useState(false);
  const [localCombatants, setLocalCombatants] = useState(combatants);
  const [localTurnIndex, setLocalTurnIndex] = useState(activeTurnIndex);

  useEffect(() => {
    if (!isPending) {
      setLocalCombatants(combatants);
      setLocalTurnIndex(activeTurnIndex);
    }
  }, [combatants, activeTurnIndex, isPending]);

  useEffect(() => {
    function handleActionStart() {
      setIsPending(true);
    }

    function handleActionEnd() {
      setIsPending(false);
    }

    function handleGameEvent(event: Event) {
      const { event: gameEvent } = (
        event as CustomEvent<{ event: GameEvent }>
      ).detail;

      if (gameEvent.type === "COMBAT_CONSEQUENCE") {
        setLocalCombatants((current) =>
          applyCombatTargetsToCombatants(current, gameEvent.payload.targets)
        );
        return;
      }

      if (
        gameEvent.type === "TURN_ADVANCE" ||
        gameEvent.type === "ROUND_ADVANCE"
      ) {
        const nextTurnIndex = gameEvent.payload.nextTurnIndex;
        if (typeof nextTurnIndex === "number") {
          setLocalTurnIndex(nextTurnIndex);
        }
      }
    }

    window.addEventListener(DUNGEON_ACTION_START, handleActionStart);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    window.addEventListener("dungeon-game-event", handleGameEvent);

    return () => {
      window.removeEventListener(DUNGEON_ACTION_START, handleActionStart);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
      window.removeEventListener("dungeon-game-event", handleGameEvent);
    };
  }, []);

  function handleAction(action: string) {
    if (isPending) return;
    requestDungeonAction({ action });
  }

  return (
    <CombatHUD
      combatants={localCombatants}
      activeTurnIndex={localTurnIndex}
      isPending={isPending}
      onActionTrigger={handleAction}
    />
  );
}
