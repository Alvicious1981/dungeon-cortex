# End-to-end tests

Playwright covers the deployment smoke path and UI sanity checks.

## Commands

```bash
pnpm test:e2e:list
pnpm test:e2e:smoke
pnpm test:e2e:headed
```

The data-backed critical-path test requires an isolated PostgreSQL database
whose name contains `e2e` or `test`, plus these environment variables:

```text
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/dungeon_cortex_e2e
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/dungeon_cortex_e2e
PRIVATE_MODE_ENABLED=true
E2E_TEST_MODE=true
```

Apply the repository migrations only to that disposable database before
running the suite. The cleanup helper refuses to access an ordinary development
or production database and deletes only records captured from its own journey.

`OPENAI_API_KEY` is deliberately unnecessary: without it, the application uses
its built-in mock narration path. The smoke action itself uses `/roll 1d20`, so
it does not depend on an external model or SRD seed data.
