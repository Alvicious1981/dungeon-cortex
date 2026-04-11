---
name: prisma-migrate
description: Run a Prisma migration with pre-flight validation and post-migration type check
disable-model-invocation: true
---

1. Run `pnpm prisma migrate dev --name <args>` (use the user-supplied migration name as `<args>`)
2. Immediately run `pnpm exec tsc --noEmit` to confirm the regenerated Prisma client types are valid
3. Report: migration name, tables/columns affected, and any TypeScript errors found
4. If type errors appear, surface them verbatim — do not proceed or mark complete until they are resolved
