# Milestone Q: Haven & Downtime Engine

## 1. Vision & OSR/AD&D 1e Principles
The "Return to Town" loop is the final crucial step of the classic progression cycle (Combat -> Dungeon Time -> Wilderness -> Haven). This milestone focuses on the core economic and time-passage mechanics that define old-school roleplaying.

### Design Pillars
1. **Gold-for-XP:** The primary driver for character advancement. Monsters grant minimal XP; extracting treasure and bringing it back to a Haven is how characters progress.
2. **Living Expenses:** Remaining in town drains resources. Characters must pay daily upkeep to survive and recover, forcing them back into the dungeon when funds run low.
3. **Retainer & Hireling Loyalty:** NPC companions are not mind-controlled assets. They require regular wages and their morale/loyalty shifts based on treatment, danger, and fair treasure distribution.

## 2. State Layer Architecture (Prisma Models)

### `Haven` Model
Tracks the state and economy of safe zones.
- `id`, `campaignId`: Identification.
- `name`: The name of the town/safe zone.
- `prosperityLevel`: Determines available goods, cost of living, and mercenary availability.
- `baseUpkeepCost`: The daily gold cost for a character to rest here safely (**default 10 gp/day**).

### `Retainer` Model
Tracks hired NPC companions.
- `id`, `campaignId`: Identification.
- `name`, `class`, `level`: Basic stats.
- `wage`: The agreed-upon daily pay in gold.
- `loyaltyScore`: A baseline score affected by Charisma and past treatment (**default 7 on a 2d6 scale**).
- `moraleState`: Current morale (e.g., confident, wavering, routed). 

## 3. Rules Layer (Pure Functions)

- `convertGoldToXP(goldDeposited: number)`: A pure function that calculates XP yielded from successfully bringing treasure back to a `Haven`. It leverages a **strictly 1:1 Gold-to-XP ratio**.
- `payLivingExpenses(partyWealth, havenUpkeepCost, daysSpent, partySize)`: Deducts the mandatory town tax/living cost from the party's wealth based on the time they spend recuperating or carousing.
- `rollRetainerMorale(roll2d6, baseLoyalty, unpaidWages, charismaMod, recentTrauma)`: Triggers a 2d6 morale check. Modifiers apply if they haven't been paid (`unpaidWages`), suffered major trauma, or the party leader has high/low Charisma. Failure dictates they leave the party or demand a renegotiation.

## 4. Integration Layer (Vercel AI SDK Tool) - *FUTURE SLICE*

### `executeDowntimeActivity`
The gateway tool for the AI narrator to process operations occurring within a Haven over an elapsed period. 

**Parameters:**
- `activityType`: e.g., "carouse", "rest", "train", "recruit".
- `daysElapsed`: The number of days the party is staying.
- `goldDeposited`: Gold converted directly to XP.

**Execution Flow:**
1. Triggers `convertGoldToXP()` for any deposited wealth.
2. Applies `payLivingExpenses()` multiplying the elapsed days by the Haven's cost.
3. Deducts wages for all active Retainers. If funds fall short, significantly dings Loyalty.
4. Executes `rollRetainerMorale()` for any Retainer with a low score or poor recent treatment.
5. Returns the updated wealth, XP gains, elapsed world-time, and retainer status changes to the AI narrator.
