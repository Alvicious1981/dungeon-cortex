"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";

export interface InventoryItemProps {
  id: string;
  name: string;
  imageUrl: string;
  append: (message: { role: "user" | "assistant"; content: string }) => void;
}

export function InventoryItem({ id, name, imageUrl, append }: InventoryItemProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu if clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setContextMenuOpen(false);
      }
    }
    if (contextMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [contextMenuOpen]);

  // Handle intent dispatch
  const handleAction = (action: string) => {
    append({
      role: "user",
      content: `[SYSTEM INTENT: Player attempts to ${action} the item: ${name}]`
    });
    setContextMenuOpen(false);
  };

  const actions = ["Use", "Equip", "Drop"];

  return (
    <div className="relative inline-block m-4" ref={menuRef}>
      {/* 
        The strict tailwind CSS filter pipeline for Grimdark Unification.
        Applies sepia, contrast, brightness, grayscale, etc.
        Removes filters on hover to create a tactile "awaken" micro-interaction.
       */}
      <div 
        className="relative w-16 h-16 cursor-pointer filter grayscale-[30%] sepia-[40%] contrast-125 brightness-90 saturate-50 drop-shadow-lg transition-all duration-300 hover:filter-none hover:drop-shadow-2xl hover:-translate-y-1"
        onClick={() => setContextMenuOpen(!contextMenuOpen)}
        onContextMenu={(e) => { 
          e.preventDefault(); 
          setContextMenuOpen(!contextMenuOpen); 
        }}
      >
        <Image 
          src={imageUrl} 
          alt={name} 
          fill
          className="object-contain"
          sizes="(max-width: 768px) 64px, 64px"
        />
      </div>

      {/* Context Menu Overlay */}
      {contextMenuOpen && (
        <div className="absolute top-16 left-0 z-50 w-32 bg-stone-900 border border-stone-700 shadow-xl rounded-md overflow-hidden">
          {actions.map((act) => (
            <button
              key={act}
              onClick={() => handleAction(act.toUpperCase())}
              className="block w-full text-left px-4 py-2 text-sm text-stone-200 hover:bg-stone-800 transition-colors"
            >
              {act}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
