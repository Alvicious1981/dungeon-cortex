"use client";

import React, { useState } from "react";
import { WildernessMapVTT, WildernessHex } from "./WildernessMapVTT";
import { Map as MapIcon, X } from "lucide-react";

interface WildernessMapControllerProps {
  hexes: WildernessHex[];
  currentQ: number;
  currentR: number;
}

/**
 * Controller for the Wilderness VTT Map.
 * Handles the toggle state and full-screen overlay rendering.
 */
export const WildernessMapController: React.FC<WildernessMapControllerProps> = ({
  hexes,
  currentQ,
  currentR,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Toggle Button in the Story Feed flow */}
      <div className="mb-4">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 hover:border-blue-500/50 transition-all group font-cinzel tracking-widest uppercase text-sm"
        >
          <MapIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
          Consult The Cartographer's Map
        </button>
      </div>

      {/* Full-Screen Map Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-[2000] bg-[#070710] flex flex-col animate-in fade-in duration-300">
          {/* Header / Close Bar */}
          <div className="flex items-center justify-between px-6 py-4 bg-black/40 border-b border-white/10 backdrop-blur-md">
            <h2 className="text-xl font-bold font-cinzel tracking-widest text-[#E8C84A]">
              World Map
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors uppercase text-xs font-bold tracking-tighter"
            >
              <X className="w-4 h-4" />
              Close Map
            </button>
          </div>

          {/* Map Content - Fills the rest of the screen */}
          <div className="flex-1 overflow-hidden relative">
            <WildernessMapVTT 
                hexes={hexes} 
                currentQ={currentQ} 
                currentR={currentR} 
            />
          </div>
        </div>
      )}
    </>
  );
};
