import { QueryClient } from "@tanstack/react-query";

const SRD_STALE_TIME_MS = 1000 * 60 * 60;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: SRD_STALE_TIME_MS,
      },
    },
  });
}

export const createTestQueryClient = createQueryClient;
