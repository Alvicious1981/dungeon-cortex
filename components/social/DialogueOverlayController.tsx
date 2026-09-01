"use client";

import { useEffect, useState } from "react";
import DialogueOverlay from "./DialogueOverlay";
import { requestDungeonAction } from "@/lib/events/action-transport";

/**
 * DialogueOverlayController.tsx — Milestone N: Slice 3
 *
 * The bridging component between the AI Narrator (via ActionInput SSE)
 * and the DialogueOverlay UI.
 *
 * Responsibilities:
 *  - Opens the overlay when the NPC roster dispatches `dungeon-npc-selected`.
 *  - Accumulates narrative tokens into `narrationText`.
 *  - Dispatches social intents as natural-language actions.
 */

/**
 * Detail carried by the `dungeon-npc-selected` window CustomEvent, dispatched
 * by NPCRoster when a player activates an NPC row.
 */
interface NpcSelectedDetail {
  npcId: string;
  name: string;
  disposition: number;
  hasMetPlayer: boolean;
}

/** Shape DialogueOverlay expects for the NPC it is rendering. */
interface DialogueNpc {
  id: string;
  name: string;
  race: string | null;
  profession: string | null;
  disposition: number;
  personalityTags: {
    motivation: string;
    secret: string;
    distinctiveTrait: string;
  } | null;
  hasMetPlayer: boolean;
}

interface Props {
  campaignId: string;
  characterId: string;
}

export default function DialogueOverlayController({ characterId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [npc, setNpc] = useState<DialogueNpc | null>(null);
  const [narrationText, setNarrationText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // 1. Open dialogue when the roster selects an NPC
    function handleNpcSelected(e: Event) {
      const customEvent = e as CustomEvent<NpcSelectedDetail>;
      const { npcId, name, disposition, hasMetPlayer } = customEvent.detail;
      setNpc({
        id: npcId,
        name,
        race: null,
        profession: null,
        disposition,
        personalityTags: null,
        hasMetPlayer,
      });
      setIsOpen(true);
      setNarrationText(""); // Clear for new conversation
    }

    // 2. Accumulate narrative tokens
    function handleToken(e: Event) {
      const customEvent = e as CustomEvent<{ chunk: string }>;
      setNarrationText(prev => prev + customEvent.detail.chunk);
    }

    // 3. Track loading state from ActionInput
    function handleActionStart() {
      setIsLoading(true);
      setNarrationText(""); // Clear for new turn
    }
    
    // We listen to the window's broadcast of "done" (implicitly via router.refresh in ActionInput,
    // but better to have a direct event if possible. For now, ActionInput manages isLoading.)
    // Actually, let's just listen for tokens. If tokens are flowing, we are loading.
    // Better: listen for the end of the stream.
    function handleActionEnd() {
      setIsLoading(false);
    }

    window.addEventListener("dungeon-npc-selected", handleNpcSelected);
    window.addEventListener("dungeon-token", handleToken);
    window.addEventListener("dungeon-action-start", handleActionStart);
    window.addEventListener("dungeon-action-end", handleActionEnd);

    return () => {
      window.removeEventListener("dungeon-npc-selected", handleNpcSelected);
      window.removeEventListener("dungeon-token", handleToken);
      window.removeEventListener("dungeon-action-start", handleActionStart);
      window.removeEventListener("dungeon-action-end", handleActionEnd);
    };
  }, []);

  if (!isOpen || !npc) return null;

  const dispatchAction = (text: string) => {
    requestDungeonAction({ action: text });
  };

  const handleSocialIntent = (approach: "persuade" | "intimidate" | "deceive") => {
    const verb = approach === "persuade" ? "to persuade" : approach;
    dispatchAction(`I try ${verb} ${npc.name}.`);
  };

  const handleSpeak = (words: string, approach: "persuade" | "intimidate" | "deceive") => {
    dispatchAction(`"${words}" (I am trying to ${approach} them)`);
  };

  const handleAskRumors = () => {
    dispatchAction(`I ask ${npc.name} what rumors they have heard lately.`);
  };

  const handleApproach = () => {
    dispatchAction(`I approach ${npc.name} and introduce myself.`);
  };

  return (
    <DialogueOverlay
      npc={npc}
      narrationText={narrationText}
      characterId={characterId}
      onSpeak={handleSpeak}
      onSocialIntent={handleSocialIntent}
      onAskRumors={handleAskRumors}
      onApproach={handleApproach}
      onClose={() => {
        setIsOpen(false);
        setNpc(null);
      }}
      isLoading={isLoading}
    />
  );
}
