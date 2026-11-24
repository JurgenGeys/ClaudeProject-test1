# ClaudeProject-test1

Oefenproject voor een agentic ontwikkelomgeving met Claude Code.
Projectregels voor de agents: [`CLAUDE.md`](CLAUDE.md). Technologiekeuzes: [`docs/tech-stack.md`](docs/tech-stack.md).

## Lokaal opstarten

Eenmalig nodig: [Node.js](https://nodejs.org) (LTS, versie 22 of hoger) en pnpm (`corepack enable`).

```bash
pnpm install      # dependencies installeren
pnpm dev          # applicatie starten op http://localhost:3000
```

## Controles

| Commando         | Wat het doet                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| `pnpm lint`      | ESLint en Prettier (formatting)                                                       |
| `pnpm format`    | Formatting automatisch rechtzetten                                                    |
| `pnpm typecheck` | TypeScript-controle                                                                   |
| `pnpm test`      | Unit- en componenttests (Vitest)                                                      |
| `pnpm test:db`   | Databasetests (Vitest) tegen de lokale Supabase; zie [Database](#database)            |
| `pnpm test:e2e`  | End-to-end-tests (Playwright); eenmalig eerst `pnpm exec playwright install chromium` |

Dezelfde controles draaien automatisch bij elke pull request (`.github/workflows/`).

## Database

De database is PostgreSQL via Supabase; de applicatie leest en schrijft enkel via Drizzle (zie
[ADR-0002](docs/adr/0002-database-supabase-drizzle.md)). Schema en migraties staan in `src/db/schema/` en `drizzle/`.

Lokaal werken met een eigen Supabase vraagt [Docker](https://docs.docker.com/get-docker/) en de
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (geen npm-dependency):

```bash
cp .env.example .env.local   # vul DATABASE_URL in; lokaal: postgresql://postgres:postgres@127.0.0.1:54322/postgres
supabase start               # lokale database, auth en testmailbox (configuratie: supabase/config.toml)
pnpm db:generate             # na een schemawijziging: migratie genereren in drizzle/
pnpm db:migrate              # migraties toepassen
pnpm test:db                 # databasetests, o.a. "elke tabel in public heeft Row Level Security aan"
supabase stop                # lokale Supabase stoppen
```

`pnpm test` draait zonder database; databasetests (`*.db.test.ts`) lopen enkel via `pnpm test:db`.

## CI

Elke pull request draait drie jobs: `Lint, typecheck, unit tests, audit`, `End-to-end tests` en
`Database tests`. De laatste start een lokale Supabase op de runner, past de Drizzle-migraties toe en draait
`pnpm test:db`. Acties staan vastgezet op een commit-SHA (vereiste van de Semgrep-scan).
