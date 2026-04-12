import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const dataDir = path.join(__dirname, '../data/srd-es');

  // Seed Spells
  const spellsPath = path.join(dataDir, 'spells.json');
  if (fs.existsSync(spellsPath)) {
    console.log('Seeding spells...');
    const spellsData = JSON.parse(fs.readFileSync(spellsPath, 'utf8'));
    let count = 0;
    for (const spell of spellsData) {
      if (!spell) continue;
      const sid = String(spell.id || spell.slug || spell.index || spell.name);
      try {
        await prisma.srdSpell.upsert({
          where: { id: sid },
          update: { name: spell.name, data: spell },
          create: { id: sid, name: spell.name, data: spell },
        });
        count++;
      } catch(e) {
        console.error('Validation Error on Spell:', sid, spell.name, (e as Error).message);
        throw e;
      }
    }
    console.log(`Seeded ${count} spells.`);
  }

  // Seed Items
  const equipmentPath = path.join(dataDir, 'equipment.json');
  if (fs.existsSync(equipmentPath)) {
    console.log('Seeding equipment...');
    const equipmentData = JSON.parse(fs.readFileSync(equipmentPath, 'utf8'));
    let count = 0;
    for (const item of equipmentData) {
      if (!item) continue;
      const iid = String(item.id || item.slug || item.index || item.name);
      try {
        await prisma.srdItem.upsert({
          where: { id: iid },
          update: { name: item.name, data: item },
          create: { id: iid, name: item.name, data: item },
        });
        count++;
      } catch(e) {
        console.error('Validation Error on Item:', iid, item.name, (e as Error).message);
        throw e;
      }
    }
    console.log(`Seeded ${count} items.`);
  }

  // Seed Monsters
  const monstersPath = path.join(dataDir, 'monsters.json');
  if (fs.existsSync(monstersPath)) {
    console.log('Seeding monsters...');
    const monstersData = JSON.parse(fs.readFileSync(monstersPath, 'utf8'));
    let count = 0;
    for (const monster of monstersData) {
      if (!monster) continue;
      const mid = String(monster.id || monster.slug || monster.index || monster.name);

      // Extract strongly-typed searchable columns from the raw JSON blob.
      // challenge_rating is a float in the SRD (0.125, 0.25, 0.5, 1–30).
      const cr: number | null =
        typeof monster.challenge_rating === 'number' ? monster.challenge_rating : null;
      const monsterType: string | null =
        typeof monster.type === 'string' ? monster.type : null;
      const size: string | null =
        typeof monster.size === 'string' ? monster.size : null;
      const alignment: string | null =
        typeof monster.alignment === 'string' ? monster.alignment : null;

      try {
        await prisma.srdMonster.upsert({
          where: { id: mid },
          update: { name: monster.name, cr, type: monsterType, size, alignment, data: monster },
          create: { id: mid, name: monster.name, cr, type: monsterType, size, alignment, data: monster },
        });
        count++;
      } catch(e) {
        console.error('Validation Error on Monster:', mid, monster.name, (e as Error).message);
        throw e;
      }
    }
    console.log(`Seeded ${count} monsters.`);
  }
}

main()
  .catch((e) => {
    console.error('Fatal error during seeding:', (e as Error).message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
