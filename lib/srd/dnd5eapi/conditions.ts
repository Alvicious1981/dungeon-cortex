import { z } from "zod";

import {
  createDnd5eApiClient,
  type Dnd5eApiClient,
  type Dnd5eApiClientOptions,
} from "./client";

export const Dnd5eApiConditionSchema = z.object({
  index: z.string(),
  name: z.string(),
  url: z.string(),
  updated_at: z.string().optional(),
  desc: z.array(z.string()),
});

export type Dnd5eApiCondition = z.infer<typeof Dnd5eApiConditionSchema>;

export interface SrdCondition {
  index: string;
  name: string;
  description: string;
  source: "dnd5eapi";
  sourceUrl: string;
  sourceVersion: "2014";
  updatedAt?: string;
}

export interface Dnd5eApiConditionsAdapterOptions extends Dnd5eApiClientOptions {
  client?: Dnd5eApiClient;
}

export function adaptCondition(apiCondition: Dnd5eApiCondition): SrdCondition {
  const parsedCondition = Dnd5eApiConditionSchema.parse(apiCondition);

  return {
    index: parsedCondition.index,
    name: parsedCondition.name,
    description: parsedCondition.desc.join("\n\n"),
    source: "dnd5eapi",
    sourceUrl: parsedCondition.url,
    sourceVersion: "2014",
    ...(parsedCondition.updated_at ? { updatedAt: parsedCondition.updated_at } : {}),
  };
}

export function createDnd5eApiConditionsAdapter(
  options: Dnd5eApiConditionsAdapterOptions = {},
) {
  const client = options.client ?? createDnd5eApiClient(options);

  return {
    async listConditions(): Promise<SrdCondition[]> {
      const index = await client.getIndex("/conditions");
      const conditions = await Promise.all(
        index.results.map((condition) => getCondition(condition.index)),
      );

      return conditions;
    },

    async getCondition(index: string): Promise<SrdCondition> {
      const apiCondition = await client.getResource(
        `/conditions/${index}`,
        Dnd5eApiConditionSchema,
      );

      return adaptCondition(apiCondition);
    },
  };

  async function getCondition(index: string): Promise<SrdCondition> {
    const apiCondition = await client.getResource(
      `/conditions/${index}`,
      Dnd5eApiConditionSchema,
    );

    return adaptCondition(apiCondition);
  }
}

export function listConditions(): Promise<SrdCondition[]> {
  return createDnd5eApiConditionsAdapter().listConditions();
}

export function getCondition(index: string): Promise<SrdCondition> {
  return createDnd5eApiConditionsAdapter().getCondition(index);
}
