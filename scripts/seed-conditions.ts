/**
 * scripts/seed-conditions.ts
 *
 * Fetches all 15 D&D 5e 2014 SRD conditions from dnd5eapi and upserts them
 * into the SrdCondition table.
 *
 * Source: https://www.dnd5eapi.co/api/2014/conditions
 * Canon:  D&D 5e 2014 SRD / Basic Rules ONLY — never mix 2024 content.
 *
 * Run: npx tsx scripts/seed-conditions.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../app/generated/prisma/client';

const prisma = new PrismaClient();

const BASE_URL = 'https://www.dnd5eapi.co/api/2014';
const ORIGIN   = 'https://www.dnd5eapi.co';

interface ApiListItem {
  index: string;
  name: string;
  url: string;
}

interface ApiConditionDetail {
  index: string;
  name: string;
  desc: string[];
  url: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status} for ${url}`);
  }
  return res.json() as Promise<T>;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SRD Conditions Seed — Dungeon Cortex (Code is Law)      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log('\n► Fetching condition list from dnd5eapi /api/2014/conditions ...');

  let list: ApiListItem[];
  try {
    const res = await fetchJson<{ count: number; results: ApiListItem[] }>(`${BASE_URL}/conditions`);
    list = res.results;
    console.log(`  Found ${list.length} conditions.`);
  } catch (err) {
    console.error('  [FATAL] Could not reach dnd5eapi:', (err as Error).message);
    process.exit(1);
  }

  let upserted = 0;
  let errors = 0;

  for (const item of list) {
    try {
      // item.url is a root-relative path like "/api/2014/conditions/blinded"
      const detail = await fetchJson<ApiConditionDetail>(`${ORIGIN}${item.url}`);

      const id = `srd-condition-${detail.index}`;
      const desc = detail.desc.join('\n') || null;

      const payload = {
        name: detail.name,
        indexSlug: detail.index,
        desc,
        data: detail as object,
      };

      await prisma.srdCondition.upsert({
        where: { id },
        update: payload,
        create: { id, ...payload },
      });

      console.log(`  [OK]    ${detail.name}`);
      upserted++;
    } catch (err) {
      console.error(`  [ERROR] ${item.index}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  CONDITIONS SEED COMPLETE                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  SrdCondition rows upserted: ${String(upserted).padEnd(31)}║`);
  console.log(`║  Errors:                     ${String(errors).padEnd(31)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (errors > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
