import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  // Find a user or create one
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({ data: { name: "Test User", email: "test@example.com" } });
  }

  // Create character
  const character = await prisma.character.create({
    data: {
      userId: user.id,
      name: "Test Wizard",
      race: "human",
      class: "wizard",
      hp: 20,
      maxHp: 20,
      level: 5,
      xp: 0,
      stats: { STR: 10, DEX: 14, CON: 14, INT: 18, WIS: 12, CHA: 10 },
      spellSlots: { "1": { total: 4, used: 0 }, "2": { total: 3, used: 0 }, "3": { total: 2, used: 0 } }
    }
  });

  // Create campaign
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      characterId: character.id,
      title: "Test Fireball Campaign",
      status: "active"
    }
  });

  // Create combat encounter
  await prisma.encounter.create({
    data: {
      campaignId: campaign.id,
      status: "active",
      currentTurnIndex: 0,
      round: 1,
      combatants: {
        create: [
          {
            id: character.id,
            name: character.name,
            hp: character.hp,
            maxHp: character.maxHp,
            initiativeTotal: 15,
            conditions: []
          },
          {
            id: "goblin-1",
            name: "Goblin",
            hp: 7,
            maxHp: 7,
            initiativeTotal: 10,
            conditions: []
          }
        ]
      }
    }
  });

  return NextResponse.redirect(`http://localhost:3000/campaign/${campaign.id}`);
}
