"use client";

import React, { useState, useRef, useEffect } from "react";
import { HexTile } from "./HexTile";
import { Move, Map as MapIcon, Compass } from "lucide-react";
import { cubeToPixel } from "../../../lib/rules/hex-grid";

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

export const WildernessMapVTT: React.FC<WildernessMapVTTProps> = ({
  hexes,
  currentQ,
  currentR,
}) => {
  // Viewport state
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize view to party position
  useEffect(() => {
    if (containerRef.current) {
      const { x, y } = cubeToPixel(currentQ, currentR, 50);
      const rect = containerRef.current.getBoundingClientRect();
      setOffset({
        x: rect.width / 2 - x * zoom,
        y: rect.height / 2 - y * zoom,
      });
    }
  }, [currentQ, currentR]);

  // Event Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.min(Math.max(prev * delta, 0.2), 3));
  };

  const { x: partyX, y: partyY } = cubeToPixel(currentQ, currentR, 50);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#1a1c1e] overflow-hidden cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Background Grid Pattern (Optional flourish) */}
      <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]" />

      <svg width="100%" height="100%" className="block">
        <defs>
          <filter id="hex-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`} className="vtt-viewport">
          {/* Render Hexes */}
          {hexes.map((hex) => (
            <HexTile
              key={`${hex.q},${hex.r}`}
              {...hex}
              size={50}
            />
          ))}

          {/* Party Marker */}
          <g transform={`translate(${partyX}, ${partyY})`} className="party-marker">
            <circle
              r="12"
              fill="rgba(59, 130, 246, 0.5)"
              className="animate-pulse"
              style={{ filter: "url(#hex-glow)" }}
            />
            <Compass className="w-6 h-6 text-blue-400 -translate-x-3 -translate-y-3 drop-shadow-lg" />
          </g>
        </g>
      </svg>

      {/* Mini Controls overlay */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button 
          onClick={() => setZoom(1)}
          className="p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors"
          title="Reset Zoom"
        >
          <MapIcon className="w-5 h-5" />
        </button>
        <button 
          onClick={() => {
            if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              setOffset({
                x: rect.width / 2 - partyX * zoom,
                y: rect.height / 2 - partyY * zoom,
              });
            }
          }}
          className="p-2 bg-black/50 backdrop-blur-md rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors"
          title="Center on Party"
        >
          <Move className="w-5 h-5" />
        </button>
      </div>

      {/* Legend / Info */}
      <div className="absolute top-4 left-4 p-3 bg-black/60 backdrop-blur-xl rounded-lg border border-white/10 pointer-events-none">
        <h3 className="text-xs font-bold uppercase tracking-widest text-white/60 mb-2">Wilderness Map</h3>
        <div className="flex items-center gap-3 text-sm text-white/90">
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
            Party Location ({currentQ}, {currentR})
          </span>
        </div>
      </div>
    </div>
  );
};
