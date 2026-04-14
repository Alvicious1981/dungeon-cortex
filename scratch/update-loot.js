const fs = require('fs');

const data = JSON.parse(fs.readFileSync('d:/dungeon-cortex/data/loot-tables.json', 'utf8'));

// Add spells to uncommon
data.uncommon.push({
  "name": "Scroll of Minor Healing",
  "description": "A parchment bearing the word of mending. Crumbles to dust when read.",
  "type": "spell",
  "properties": { "effect": "heal_1d8_plus_2", "uses": 1 },
  "valueGP": 40
});
data.uncommon.push({
  "name": "Scroll of Sparks",
  "description": "Smells like ozone. Unleashes a small burst of electrical energy.",
  "type": "spell",
  "properties": { "effect": "lightning_damage_1d6", "uses": 1 },
  "valueGP": 50
});

// Add spells to rare
data.rare.push({
  "name": "Tome of the Unseen Step",
  "description": "A small booklet wrapped in velvet. Teaches a short-range teleportation incantation.",
  "type": "spell",
  "properties": { "effect": "teleport_30ft" },
  "valueGP": 400
});

data.rare.push({
  "name": "Alchemist's Fire (Batch)",
  "description": "Three vials of volatile orange liquid stored securely.",
  "type": "consumable",
  "properties": { "effect": "fire_damage_1d4_continuous", "uses": 3 },
  "valueGP": 150
});

// Add spells to very_rare
data.very_rare.push({
  "name": "Grimoire of the Black Sun",
  "description": "Heavy iron-bound tome containing devastating solar eclipse evocations.",
  "type": "spell",
  "properties": { "effect": "necrotic_radiant_blast_4d6" },
  "valueGP": 1500
});

// Ensure enough consumables
data.uncommon.push({
  "name": "Draught of Giant's Strength",
  "description": "A viscous blue fluid that briefly empowers the muscles.",
  "type": "consumable",
  "properties": { "effect": "strength_advantage_10m", "uses": 1 },
  "valueGP": 100
});
data.mundane.push({
  "name": "Bottle of Cheap Ink",
  "description": "Watery and smells of squid. Good enough for writing tallies.",
  "type": "misc",
  "valueGP": 2
});
data.mundane.push({
  "name": "Bandage Roll",
  "description": "Clean linen strips for binding wounds.",
  "type": "consumable",
  "valueGP": 2
});

fs.writeFileSync('d:/dungeon-cortex/data/loot-tables.json', JSON.stringify(data, null, 2), 'utf8');
console.log('Loot tables updated successfully!');
