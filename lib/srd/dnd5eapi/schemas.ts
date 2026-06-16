import { z } from "zod";

export const Dnd5eApiIndexItemSchema = z.object({
  index: z.string(),
  name: z.string(),
  url: z.string(),
});

export const Dnd5eApiIndexSchema = z.object({
  count: z.number(),
  results: z.array(Dnd5eApiIndexItemSchema),
});

export const Dnd5eApiResourceSchema = z.record(z.string(), z.unknown());

export type Dnd5eApiIndexItem = z.infer<typeof Dnd5eApiIndexItemSchema>;
export type Dnd5eApiIndex = z.infer<typeof Dnd5eApiIndexSchema>;
export type Dnd5eApiResource = z.infer<typeof Dnd5eApiResourceSchema>;
