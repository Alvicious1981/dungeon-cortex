import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 5;

interface SerializableRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  retryCodes?: readonly string[];
}

export function getPrismaErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Runs a Prisma interactive transaction at SERIALIZABLE isolation and retries
 * only explicitly approved transient conflict codes.
 *
 * P2034 is Prisma's transaction write-conflict/deadlock code. Callers that use
 * a unique constraint as a concurrency guard may additionally opt into P2002;
 * the whole transaction is then retried so it can re-read the winning row.
 */
export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const retryCodes = new Set(options.retryCodes ?? ["P2034"]);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code = getPrismaErrorCode(error);
      const shouldRetry =
        code !== undefined && retryCodes.has(code) && attempt < maxAttempts;

      if (!shouldRetry) throw error;

      await wait(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new Error("Serializable transaction retry loop exhausted unexpectedly.");
}
