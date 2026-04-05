import { prisma } from "./prisma";

// Returns the DevUser, creating it if it doesn't exist.
// This is a development-only mechanism. Replace with real auth before production.
export async function ensureDevUser() {
  const id = process.env.DEV_USER_ID;
  if (!id) {
    throw new Error("DEV_USER_ID is not set in environment variables.");
  }

  return prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      email: "dev@dungeon-cortex.local",
      name: "Dev User",
    },
  });
}
