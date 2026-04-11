import { seededFloat } from '../generators';

/**
 * Deterministically generates a loot array based on a Challenge Rating (CR)
 * and an entity seed. 
 */
export function generateLootForCR(cr: number, entityId: string): string[] {
  const loot: string[] = [];
  // Generate a d100 roll
  const roll = Math.floor(seededFloat(`${entityId}:lootRoll`) * 100) + 1;
  
  if (cr <= 4) {
    if (roll <= 30) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 10) + 1;
      loot.push(`${amount} cp`);
    } else if (roll <= 60) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 10) + 1;
      loot.push(`${amount} sp`);
    } else if (roll <= 95) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 10) + 1;
      loot.push(`${amount} gp`);
    } else {
      loot.push("1 Potion of Healing");
    }
  } else if (cr <= 10) {
    if (roll <= 30) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 100) + 10;
      loot.push(`${amount} sp`);
    } else if (roll <= 60) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 100) + 10;
      loot.push(`${amount} gp`);
    } else if (roll <= 90) {
      const amount = Math.floor(seededFloat(`${entityId}:gold`) * 10) + 1;
      loot.push(`${amount} pp`);
    } else {
      loot.push("1 Magic Weapon +1");
    }
  } else {
    const amount = Math.floor(seededFloat(`${entityId}:gold`) * 1000) + 100;
    loot.push(`${amount} gp`);
    if (roll > 70) {
      loot.push("1 Magic Item (Rare)");
    }
  }
  
  return loot;
}
