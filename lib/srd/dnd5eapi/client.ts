import { ZodError, type ZodSchema } from "zod";

import {
  Dnd5eApiIndexSchema,
  Dnd5eApiResourceSchema,
  type Dnd5eApiIndex,
  type Dnd5eApiResource,
} from "./schemas";

export const DEFAULT_DND5E_API_BASE_URL = "https://www.dnd5eapi.co/api/2014";
export const DEFAULT_DND5E_API_TIMEOUT_MS = 10_000;

export type Dnd5eApiFetch = typeof fetch;

export interface Dnd5eApiClientOptions {
  baseUrl?: string;
  fetch?: Dnd5eApiFetch;
  timeoutMs?: number;
}

export type Dnd5eApiClientErrorKind =
  | "http"
  | "invalid-json"
  | "invalid-shape"
  | "timeout";

export class Dnd5eApiClientError extends Error {
  readonly kind: Dnd5eApiClientErrorKind;
  readonly status?: number;
  readonly statusText?: string;
  readonly url: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      kind: Dnd5eApiClientErrorKind;
      url: string;
      status?: number;
      statusText?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "Dnd5eApiClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.cause = options.cause;
  }
}

export interface Dnd5eApiClient {
  getIndex(endpoint: string): Promise<Dnd5eApiIndex>;
  getResource<TResource = Dnd5eApiResource>(
    pathOrUrl: string,
    schema?: ZodSchema<TResource>,
  ): Promise<TResource>;
}

export function createDnd5eApiClient(
  options: Dnd5eApiClientOptions = {},
): Dnd5eApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_DND5E_API_BASE_URL);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DND5E_API_TIMEOUT_MS;

  if (!fetchImpl) {
    throw new Error("D&D 5e API client requires a fetch implementation.");
  }

  async function request<T>(pathOrUrl: string, schema: ZodSchema<T>): Promise<T> {
    const url = toRequestUrl(pathOrUrl, baseUrl);
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Dnd5eApiClientError(
          `D&D 5e API request failed: ${response.status} ${response.statusText}`,
          {
            kind: "http",
            url,
            status: response.status,
            statusText: response.statusText,
          },
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (didTimeout || isAbortError(error)) {
          throw new Dnd5eApiClientError(`D&D 5e API request timed out: ${url}`, {
            kind: "timeout",
            url,
            cause: error,
          });
        }

        throw new Dnd5eApiClientError(`D&D 5e API returned invalid JSON: ${url}`, {
          kind: "invalid-json",
          url,
          cause: error,
        });
      }

      try {
        return schema.parse(payload);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new Dnd5eApiClientError(
            `D&D 5e API returned an unexpected response shape: ${url}`,
            { kind: "invalid-shape", url, cause: error },
          );
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof Dnd5eApiClientError) {
        throw error;
      }

      if (didTimeout || isAbortError(error)) {
        throw new Dnd5eApiClientError(`D&D 5e API request timed out: ${url}`, {
          kind: "timeout",
          url,
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    getIndex(endpoint) {
      return request(endpoint, Dnd5eApiIndexSchema);
    },
    getResource<TResource = Dnd5eApiResource>(
      pathOrUrl: string,
      schema?: ZodSchema<TResource>,
    ) {
      return request(
        pathOrUrl,
        schema ?? (Dnd5eApiResourceSchema as ZodSchema<TResource>),
      );
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toRequestUrl(pathOrUrl: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const base = new URL(baseUrl);
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;

  if (path.startsWith("/api/2014") || path.startsWith("/api")) {
    return `${base.origin}${path}`;
  }

  return `${baseUrl}${path}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
