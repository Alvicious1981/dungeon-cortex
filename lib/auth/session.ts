import { prisma } from "@/lib/db/prisma";

// Private user ID used for all data in private mode
const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Resolves the private user for the current request.
 * Since authentication is eliminated, this always returns the same private user.
 */
export async function getAuthUser() {
  return prisma.user.upsert({
    where: { id: PRIVATE_USER_ID },
    update: {},
    create: {
      id: PRIVATE_USER_ID,
      email: "user@private.local",
      name: "Private User",
    },
  });
}

/**
 * Kept for type compatibility during transition.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

