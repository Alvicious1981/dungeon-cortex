"use client";

import React from "react";
import { cubeToPixel } from "../../../lib/rules/hex-grid";
import { 
  TowerControl as Tower, 
  Home, 
  Castle, 
  Sun, 
  Trees, 
  Mountain, 
  Waves, 
  Skull 
} from "lucide-react";

export type HexTerrainType = 
  | "plains" 
  | "forest" 
  | "hills" 
  | "mountain" 
  | "swamp" 
  | "desert" 
  | "coast" 
  | "tundra" 
  | "taiga";

export interface HexTileProps {
  q: number;
  r: number;
  terrain: string;
  feature?: string | null;
  discovered: boolean;
  scouted: boolean;
  size?: number;
}

const HEX_POINTS = "43.3,-25 43.3,25 0,50 -43.3,25 -43.3,-25 0,-50";

/**
 * Returns a color for the given terrain type.
 */
function getTerrainColor(terrain: string): string {
  switch (terrain.toLowerCase()) {
    case "plains":   return "#9dc08b";
    case "forest":   return "#2d5a27";
    case "hills":    return "#8b9d77";
    case "mountain": return "#4a5d66";
    case "swamp":    return "#3a4d3f";
    case "desert":   return "#d9b38c";
    case "coast":    return "#2e5d82";
    case "tundra":   return "#aebcc4";
    case "taiga":    return "#1a3d2e";
    default:         return "#7f8c8d";
  }
}

/**
 * Maps feature strings to Lucide icons.
 */
function getFeatureIcon(feature: string) {
  switch (feature) {
    case "dungeon_entrance": return <Tower className="w-5 h-5 text-red-500" />;
    case "village":          return <Home className="w-5 h-5 text-amber-500" />;
    case "ruins":            return <Castle className="w-5 h-5 text-gray-400" />;
    case "shrine":           return <Sun className="w-5 h-5 text-yellow-300" />;
    default:                 return <Skull className="w-5 h-5 text-white/50" />;
  }
}

export const HexTile: React.FC<HexTileProps> = ({
  q,
  r,
  terrain,
  feature,
  discovered,
  scouted,
  size = 50,
}) => {
  const { x, y } = cubeToPixel(q, r, size);
  const color = getTerrainColor(terrain);

  // Visibility logic
  const isDiscovered = discovered;
  const isScouted = scouted && !discovered;
  
  // Style and filter
  const filter = isScouted ? "grayscale(80%) brightness(50%)" : "none";
  const opacity = isDiscovered ? 1 : isScouted ? 0.7 : 0;

  if (!discovered && !scouted) return null;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      className={`hex-tile ${isDiscovered ? "is-discovered" : ""} ${isScouted ? "is-scouted" : ""}`}
      data-q={q}
      data-r={r}
      style={{ filter, opacity, transition: "all 0.4s ease-out" }}
    >
      {/* Background Polygon */}
      <polygon
        points={HEX_POINTS}
        fill={color}
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="1"
      />

      {/* Feature Icon - Only if discovered */}
      {isDiscovered && feature && (
        <foreignObject x="-10" y="-10" width="20" height="20" className="hex-feature-icon">
          <div className="flex items-center justify-center w-full h-full pointer-events-none">
            {getFeatureIcon(feature)}
          </div>
        </foreignObject>
      )}

      {/* Optional Debug Coordinates */}
      {/* <text y="5" fontSize="8" textAnchor="middle" fill="white" opacity="0.3">
        {q},{r}
      </text> */}
    </g>
  );
};
