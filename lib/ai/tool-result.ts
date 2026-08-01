/**
 * lib/ai/tool-result.ts
 *
 * Common internal result contract for every narrator tool.
 *
 * Threat model: a tool result is model-visible text. Raw exception messages,
 * stack traces, service `detail` payloads, SQL fragments, prompts and query
 * echoes are internal information; once they reach the model they can be
 * narrated back to the player or used to steer later turns. So a tool result
 * may only carry:
 *
 *   - a stable discriminant (`status`),
 *   - an enumerable failure reason (`reason`),
 *   - an optional stable domain code emitted by a backend rules service,
 *   - typed data, and only on success.
 *
 * Every result is validated before it leaves the tool. Anything that fails
 * validation, and every exception that cannot be classified, collapses into a
 * safe internal error.
 *
 * This module is pure: no I/O, no state.
 */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Stable discriminant shared by every narrator tool result. */
export const TOOL_RESULT_STATUS = ["ok", "error"] as const;

/**
 * Enumerable failure reasons. Deliberately coarse — a reason describes what
 * the narrator should do, not what went wrong internally.
 *
 *  - `not_found`      — the lookup completed and nothing matched.
 *  - `rejected`       — a backend rules service refused the request and
 *                       reported a stable domain code.
 *  - `internal_error` — anything else, including unclassifiable exceptions and
 *                       results that fail validation.
 */
export const TOOL_FAILURE_REASONS = ["not_found", "rejected", "internal_error"] as const;

export type ToolFailureReason = (typeof TOOL_FAILURE_REASONS)[number];

/** Successful result. `data` exists only here. */
export interface ToolSuccess<T> {
  status: "ok";
  data: T;
}

/** Failed result. Never carries data, messages, stacks or details. */
export interface ToolFailure {
  status: "error";
  reason: ToolFailureReason;
  /**
   * Stable domain code from a backend rules service (e.g. `ITEM_NOT_FOUND`).
   * Present only when `reason` is `rejected` and the code passes the strict
   * enumerable-shape check below.
   */
  code?: string;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

// ─── Domain-code sanitisation ─────────────────────────────────────────────────

/**
 * Backend rules services expose `code` as a closed union of SCREAMING_SNAKE
 * identifiers. Only strings matching that shape may cross to the model; a
 * free-form message can never satisfy it.
 */
const DOMAIN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function readDomainCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!error.name.endsWith("ServiceError")) return null;

  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== "string") return null;
  if (!DOMAIN_CODE_PATTERN.test(code)) return null;

  return code;
}

// ─── Constructors ─────────────────────────────────────────────────────────────

/** A safe internal error. The terminal fallback for anything unclassifiable. */
export function toolInternalError(): ToolFailure {
  return { status: "error", reason: "internal_error" };
}

/** The lookup ran and matched nothing. Not an error condition. */
export function toolNotFound(): ToolFailure {
  return { status: "error", reason: "not_found" };
}

/** A backend service refused the request under a stable domain code. */
export function toolRejected(code?: string): ToolFailure {
  return code !== undefined && DOMAIN_CODE_PATTERN.test(code)
    ? { status: "error", reason: "rejected", code }
    : { status: "error", reason: "rejected" };
}

/**
 * Wraps backend-resolved data. Returns a safe internal error instead when the
 * value cannot be represented as a valid result (undefined or non-serialisable).
 */
export function toolSuccess<T>(data: T): ToolResult<T> {
  const candidate: ToolSuccess<T> = { status: "ok", data };
  return isToolResult(candidate) ? candidate : toolInternalError();
}

/**
 * Classifies an exception without propagating any of its content.
 * Recognised backend service errors keep their stable domain code; everything
 * else — including plain `Error`, thrown strings and non-Error values —
 * collapses into a safe internal error.
 */
export function classifyToolError(error: unknown): ToolFailure {
  const code = readDomainCode(error);
  return code !== null ? toolRejected(code) : toolInternalError();
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * A value is serialisable only if `JSON.stringify` produces actual text.
 *
 * Functions and symbols do not throw — they serialise to `undefined`, which
 * would silently drop `data` from the envelope and leave the model with a bare
 * `{"status":"ok"}`. Circular structures and BigInt throw instead.
 */
function isSerialisable(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/**
 * The complete set of top-level keys each envelope variant may carry.
 *
 * Validation compares the real `Object.keys` against these sets, so a result
 * cannot smuggle an extra `message`, `detail`, `stack`, `error`, `query`,
 * `prompt` or any other unknown property past the boundary.
 */
const SUCCESS_KEYS = ["status", "data"] as const;
const FAILURE_KEYS = ["status", "reason"] as const;
const FAILURE_WITH_CODE_KEYS = ["status", "reason", "code"] as const;

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every((key) => keys.includes(key));
}

/**
 * Validates that a value satisfies the common contract. Used before a result
 * leaves a tool, so a malformed shape can never reach the model.
 */
export function isToolResult(value: unknown): value is ToolResult<unknown> {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as { status?: unknown; data?: unknown; reason?: unknown; code?: unknown };

  if (candidate.status === "ok") {
    if (!hasExactKeys(candidate, SUCCESS_KEYS)) return false;
    return isSerialisable(candidate.data);
  }

  if (candidate.status === "error") {
    if (!TOOL_FAILURE_REASONS.includes(candidate.reason as ToolFailureReason)) return false;

    if (hasExactKeys(candidate, FAILURE_KEYS)) return true;

    return (
      hasExactKeys(candidate, FAILURE_WITH_CODE_KEYS) &&
      candidate.reason === "rejected" &&
      typeof candidate.code === "string" &&
      DOMAIN_CODE_PATTERN.test(candidate.code)
    );
  }

  return false;
}

// ─── Execution wrapper ────────────────────────────────────────────────────────

/**
 * Runs a tool body under the common contract.
 *
 * Catches every exception, wraps the resolved value as typed success data, and
 * validates the result before returning it. Anything that cannot be classified
 * becomes a safe internal error.
 *
 * The resolved value is always treated as data — never re-interpreted as a
 * result envelope — so a backend payload can never impersonate a failure.
 */
export async function runTool<T>(resolve: () => Promise<T> | T): Promise<ToolResult<T>> {
  try {
    return toolSuccess(await resolve());
  } catch (error) {
    return classifyToolError(error);
  }
}

/**
 * Same contract as {@link runTool}, for lookups whose "no match" answer is a
 * nullish value rather than an exception. A nullish result becomes `not_found`.
 */
export async function runLookup<T>(
  resolve: () => Promise<T | null | undefined> | T | null | undefined,
): Promise<ToolResult<T>> {
  try {
    const data = await resolve();
    return data === null || data === undefined ? toolNotFound() : toolSuccess(data);
  } catch (error) {
    return classifyToolError(error);
  }
}
