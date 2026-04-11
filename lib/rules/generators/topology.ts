import { seededFloat } from '../generators';

export type CellType = 'wall' | 'floor';
export type Grid = CellType[][];

/**
 * Procedurally generates a 2D topological matrix using a seeded cellular automata algorithm.
 * Guarantees the same map matrix for a given seed, width, and height.
 */
export function generateDungeonGrid(seed: string, width: number, height: number, iterations: number = 4): Grid {
  let grid: Grid = [];
  const fillProb = 0.45;

  // 1. Initial random fill based on deterministic seed
  for (let y = 0; y < height; y++) {
    let row: CellType[] = [];
    for (let x = 0; x < width; x++) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        row.push('wall'); // Boundaries are always walls
      } else {
        const val = seededFloat(`${seed}:init:${x}:${y}`);
        row.push(val < fillProb ? 'wall' : 'floor');
      }
    }
    grid.push(row);
  }

  // 2. Cellular Automata smoothing rules
  for (let i = 0; i < iterations; i++) {
    let newGrid: Grid = [];
    for (let y = 0; y < height; y++) {
      let newRow: CellType[] = [];
      for (let x = 0; x < width; x++) {
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          newRow.push('wall');
          continue;
        }
        
        let wallNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (grid[y + dy][x + dx] === 'wall') {
              wallNeighbors++;
            }
          }
        }
        
        if (grid[y][x] === 'wall') {
          newRow.push(wallNeighbors >= 4 ? 'wall' : 'floor');
        } else {
          newRow.push(wallNeighbors >= 5 ? 'wall' : 'floor');
        }
      }
      newGrid.push(newRow);
    }
    grid = newGrid;
  }
  
  return grid;
}
