"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Crosshair, Minus, Plus } from "lucide-react";
import { cubeToPixel } from "../../../lib/rules/hex-grid";
import { HexTile } from "./HexTile";

export interface WildernessHex {
  q: number;
  r: number;
  terrain: string;
  feature?: string | null;
  discovered: boolean;
  scouted: boolean;
}

export interface WildernessMapVTTProps {
  hexes: WildernessHex[];
  currentQ: number;
  currentR: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

export const WildernessMapVTT: React.FC<WildernessMapVTTProps> = ({ hexes, currentQ, currentR }) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const { x: partyX, y: partyY } = cubeToPixel(currentQ, currentR, 50);

  const centerOnParty = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setOffset({
      x: rect.width / 2 - partyX * zoomRef.current,
      y: rect.height / 2 - partyY * zoomRef.current,
    });
  }, [partyX, partyY]);

  useEffect(() => {
    centerOnParty();
  }, [centerOnParty]);

  const adjustZoom = useCallback((factor: number) => {
    setZoom((previous) => {
      const next = Math.min(Math.max(previous * factor, MIN_ZOOM), MAX_ZOOM);
      zoomRef.current = next;
      return next;
    });
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = true;
    dragStart.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging.current) return;
    setOffset({ x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    isDragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const pan = event.shiftKey ? 80 : 32;
    const movement: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: pan, y: 0 }, ArrowRight: { x: -pan, y: 0 }, ArrowUp: { x: 0, y: pan }, ArrowDown: { x: 0, y: -pan },
    };
    if (movement[event.key]) {
      event.preventDefault();
      const delta = movement[event.key];
      setOffset((previous) => ({ x: previous.x + delta.x, y: previous.y + delta.y }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault(); adjustZoom(1.15);
    } else if (event.key === "-") {
      event.preventDefault(); adjustZoom(0.85);
    } else if (event.key === "Home") {
      event.preventDefault(); centerOnParty();
    }
  }

  const discoveredCount = hexes.filter((hex) => hex.discovered).length;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Wilderness map. Party at hex ${currentQ}, ${currentR}. ${discoveredCount} discovered hexes.`}
      tabIndex={0}
      className="relative h-full w-full cursor-grab overflow-hidden bg-[#101018] active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={(event) => adjustZoom(event.deltaY > 0 ? 0.9 : 1.1)}
      onKeyDown={handleKeyDown}
    >
      <p className="sr-only">Use arrow keys to pan, plus and minus to zoom, and Home to center the party.</p>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(#fff_1px,transparent_1px)] opacity-5 [background-size:20px_20px]" />
      <svg aria-hidden="true" width="100%" height="100%" className="block">
        <defs><filter id="hex-glow"><feGaussianBlur stdDeviation="2" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter></defs>
        <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`} className="vtt-viewport">
          {hexes.map((hex) => <HexTile key={`${hex.q},${hex.r}`} {...hex} size={50} />)}
          <g transform={`translate(${partyX}, ${partyY})`} className="party-marker">
            <circle r="12" fill="rgba(99, 102, 241, 0.55)" style={{ filter: "url(#hex-glow)" }} />
            <Compass className="h-6 w-6 -translate-x-3 -translate-y-3 text-violet-200 drop-shadow-lg" />
          </g>
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 flex gap-2" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => adjustZoom(0.85)} className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/20 bg-black/70 text-white hover:bg-white/10" aria-label="Zoom out"><Minus aria-hidden="true" size={18} /></button>
        <button type="button" onClick={() => adjustZoom(1.15)} className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/20 bg-black/70 text-white hover:bg-white/10" aria-label="Zoom in"><Plus aria-hidden="true" size={18} /></button>
        <button type="button" onClick={centerOnParty} className="flex h-11 w-11 items-center justify-center rounded-sm border border-white/20 bg-black/70 text-white hover:bg-white/10" aria-label="Center on party"><Crosshair aria-hidden="true" size={18} /></button>
      </div>

      <div className="pointer-events-none absolute left-4 top-4 rounded-sm border border-white/10 bg-black/70 p-3 backdrop-blur-xl">
        <h3 className="text-xs font-bold uppercase tracking-widest text-white/60">Wilderness Map</h3>
        <p className="mt-1 text-sm text-white/90">Party location ({currentQ}, {currentR})</p>
      </div>
    </div>
  );
};
