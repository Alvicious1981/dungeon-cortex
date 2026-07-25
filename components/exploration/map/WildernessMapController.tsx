"use client";

import React, { useCallback, useRef, useState } from "react";
import { Map as MapIcon, X } from "lucide-react";
import { WildernessMapVTT, type WildernessHex } from "./WildernessMapVTT";
import { useModalFocus } from "@/lib/hooks/useModalFocus";

interface WildernessMapControllerProps {
  hexes: WildernessHex[];
  currentQ: number;
  currentR: number;
}

export const WildernessMapController: React.FC<WildernessMapControllerProps> = ({ hexes, currentQ, currentR }) => {
  const [isOpen, setIsOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeMap = useCallback(() => setIsOpen(false), []);
  useModalFocus({ open: isOpen, onClose: closeMap, dialogRef, initialFocusRef: closeButtonRef, returnFocusRef: openButtonRef });

  return (
    <>
      <div className="mb-4">
        <button ref={openButtonRef} type="button" onClick={() => setIsOpen(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-sm border border-violet-400/35 bg-violet-950/40 px-6 py-3 font-semibold uppercase tracking-[0.14em] text-violet-200 transition-colors hover:border-violet-300/60 hover:bg-violet-900/40">
          <MapIcon aria-hidden="true" className="h-5 w-5" />
          Consult The Cartographer&apos;s Map
        </button>
      </div>

      {isOpen && (
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wilderness-map-title" className="fixed inset-0 z-[2000] flex flex-col bg-[#070710]">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4">
            <div>
              <p className="dc-kicker">Cartographer&apos;s table</p>
              <h2 id="wilderness-map-title" className="dc-heading mt-1 text-lg font-bold text-[#e8c84a] sm:text-xl">World Map</h2>
            </div>
            <button ref={closeButtonRef} type="button" onClick={closeMap} className="flex min-h-11 items-center gap-2 rounded-sm border border-red-400/35 bg-red-950/30 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-200 hover:bg-red-900/40">
              <X aria-hidden="true" className="h-4 w-4" /> Close Map
            </button>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <WildernessMapVTT hexes={hexes} currentQ={currentQ} currentR={currentR} />
          </div>
        </div>
      )}
    </>
  );
};
