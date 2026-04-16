"use client";

import { useEffect, useState } from "react";
import DialogueOverlay from "./DialogueOverlay";
import type { DialogueOpenPayload } from "@/lib/events/game-events";

/**
 * DialogueOverlayController.tsx — Milestone N: Slice 3
 * 
 * The bridging component between the AI Narrator (via ActionInput SSE)
 * and the DialogueOverlay UI. 
 * 
 * Responsibilities:
 *  - Opens the overlay when a `dialogue_open` frame arrives.
 *  - Accumulates narrative tokens into `narrationText`.
 *  - Updates NPC disposition in real-time from `dialogue_update` frames.
 *  - Dispatches social intents as natural-language actions.
 */

interface Props {
  campaignId: string;
  characterId: string;
}

export default function DialogueOverlayController({ campaignId, characterId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [npc, setNpc] = useState<DialogueOpenPayload | null>(null);
  const [narrationText, setNarrationText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // 1. Open dialogue when event arrives
    function handleDialogueOpen(e: Event) {
      const customEvent = e as CustomEvent<DialogueOpenPayload>;
      setNpc(customEvent.detail);
      setIsOpen(true);
      setNarrationText(""); // Clear for new conversation
    }

    // 2. Real-time disposition update
    function handleDispositionUpdate(e: Event) {
      const customEvent = e as CustomEvent<{ disposition: number }>;
      setNpc(prev => {
        if (!prev) return null;
        return { ...prev, disposition: customEvent.detail.disposition };
      });
    }

    // 3. Accumulate narrative tokens
    function handleToken(e: Event) {
      const customEvent = e as CustomEvent<{ chunk: string }>;
      setNarrationText(prev => prev + customEvent.detail.chunk);
    }

    // 4. Track loading state from ActionInput
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

    window.addEventListener("dungeon-dialogue-open", handleDialogueOpen);
    window.addEventListener("dungeon-dialogue-update", handleDispositionUpdate);
    window.addEventListener("dungeon-token", handleToken);
    window.addEventListener("dungeon-action-start", handleActionStart);
    window.addEventListener("dungeon-action-end", handleActionEnd);
    
    return () => {
      window.removeEventListener("dungeon-dialogue-open", handleDialogueOpen);
      window.removeEventListener("dungeon-dialogue-update", handleDispositionUpdate);
      window.removeEventListener("dungeon-token", handleToken);
      window.removeEventListener("dungeon-action-start", handleActionStart);
      window.removeEventListener("dungeon-action-end", handleActionEnd);
    };
  }, []);

  if (!isOpen || !npc) return null;

  const dispatchAction = (text: string) => {
    window.dispatchEvent(new CustomEvent("dungeon-remote-action", { detail: { action: text } }));
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
      npc={{
        ...npc,
        id: npc.npcId
      }}
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
