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

### Omgevingsvariabelen

Zie `.env.example`; de waarden komen in `.env.local` (nooit committen). Lokaal toont `supabase status -o env` de sleutels.

| Variabele                              | Waarvoor                                                                    | Waar zichtbaar |
| -------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| `DATABASE_URL`                         | Verbinding voor Drizzle en `pnpm db:migrate`                                | Enkel server   |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL van het Supabase-project                                                | Ook browser    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publieke sleutel, enkel voor aanmelden en sessies                           | Ook browser    |
| `SUPABASE_SECRET_KEY`                  | Geheime sleutel (omzeilt alle beveiliging per rij): enkel server en scripts | Enkel server   |
| `SEED_BACKOFFICE_PASSWORD`             | Optioneel: wachtwoord voor de eerste backoffice-gebruiker (min. 12 tekens)  | Enkel script   |

### Gebruikers en rollen

Elke gebruiker bestaat in Supabase Auth (login) en heeft een rij in `profiles` (rol `backoffice` of
`technician`, naam, actief of uitgeschakeld). Er is geen scherm om backoffice-gebruikers toe te voegen;
de eerste (zaakvoerder of backoffice-medewerker) maak je eenmalig aan na `pnpm db:migrate`:

```bash
pnpm seed:backoffice "Voornaam Achternaam" naam@bedrijf.be
```

Het script maakt de gebruiker in Supabase Auth en het profiel met rol `backoffice`. Het wachtwoord komt uit
`SEED_BACKOFFICE_PASSWORD`; is dat leeg, dan wordt er een gegenereerd en één keer getoond. Opnieuw uitvoeren
is veilig: een bestaande gebruiker of een bestaand profiel blijft ongemoeid, en een half afgewerkte eerdere
poging wordt aangevuld. Het script heeft `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` en `DATABASE_URL` nodig.

`pnpm test` draait zonder database; databasetests (`*.db.test.ts`) lopen enkel via `pnpm test:db`.

## CI

Elke pull request draait drie jobs: `Lint, typecheck, unit tests, audit`, `End-to-end tests` en
`Database tests`. De laatste start een lokale Supabase op de runner, past de Drizzle-migraties toe en draait
`pnpm test:db`. Acties staan vastgezet op een commit-SHA (vereiste van de Semgrep-scan).
