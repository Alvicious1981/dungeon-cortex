import { FALLBACK_RACES, FALLBACK_CLASSES } from "./constants";

const BASE_URL = "https://www.dnd5eapi.co/api";

export interface ApiListItem {
  index: string;
  name: string;
}

interface ApiListResponse {
  count: number;
  results: ApiListItem[];
}

async function fetchList(path: string): Promise<ApiListItem[]> {
  const res = await fetch(`${BASE_URL}${path}`, {
    next: { revalidate: 86400 }, // Cache for 24 hours via Next.js
  });
  if (!res.ok) {
    throw new Error(`D&D 5e API error: ${res.status} ${res.statusText}`);
  }
  const data: ApiListResponse = await res.json();
  return data.results;
}

export async function getRaces(): Promise<ApiListItem[]> {
  try {
    return await fetchList("/races");
  } catch {
    console.warn("D&D 5e API unavailable for races, using fallback list.");
    return FALLBACK_RACES;
  }
}

export async function getClasses(): Promise<ApiListItem[]> {
  try {
    return await fetchList("/classes");
  } catch {
    console.warn("D&D 5e API unavailable for classes, using fallback list.");
    return FALLBACK_CLASSES;
  }
}
