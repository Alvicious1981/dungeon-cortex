import { prisma } from "@/lib/db/prisma";

// Private user ID used for all data in private mode
const PRIVATE_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Resolves the private user for the current request.
 *
 * There is still no real authentication: in private mode this always
 * returns the same private user. Private mode is not the default — it
 * requires an explicit PRIVATE_MODE_ENABLED=true, so a deployment that
 * never opted in fails closed instead of serving every request as the
 * same identity.
 */
export async function getAuthUser() {
  if (process.env.PRIVATE_MODE_ENABLED !== "true") {
    throw new AuthError("Not authenticated: private mode is not enabled.");
  }

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
 * Thrown when no usable identity exists for the current request.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

