"use client";

import { useQuery } from "@tanstack/react-query";

import { srdKeys } from "@/lib/query/query-keys";

import { getMonster } from "./monsters";

export function useSrdMonster(index: string) {
  return useQuery({
    queryKey: srdKeys.monster(index),
    queryFn: () => getMonster(index),
    enabled: Boolean(index),
  });
}
