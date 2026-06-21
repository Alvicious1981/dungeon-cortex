/**
 * @vitest-environment jsdom
 */
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "@/lib/query/query-client";
import { useSrdMonster } from "@/lib/srd/dnd5eapi/query-hooks";

let queryClient: QueryClient | undefined;

function wrapper({ children }: { children: ReactNode }) {
  if (!queryClient) {
    queryClient = createTestQueryClient();
  }
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  queryClient?.clear();
  queryClient = undefined;
});

describe("useSrdMonster", () => {
  it("reads a goblin monster from the SRD API through MSW", async () => {
    const { result, unmount } = renderHook(() => useSrdMonster("goblin"), {
      wrapper,
    });

    await waitFor(() => {
      if (result.current.error) {
        throw result.current.error;
      }
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toMatchObject({
      index: "goblin",
      name: "Goblin",
      hitPoints: 7,
    });

    unmount();
  });
});
