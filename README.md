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

| Commando         | Wat het doet                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm lint`      | ESLint en Prettier (formatting)                                                                   |
| `pnpm format`    | Formatting automatisch rechtzetten                                                                |
| `pnpm typecheck` | TypeScript-controle                                                                               |
| `pnpm test`      | Unit- en componenttests (Vitest)                                                                  |
| `pnpm test:db`   | Databasetests (Vitest) tegen de lokale Supabase; zie [Database](#database)                        |
| `pnpm test:e2e`  | End-to-end-tests (Playwright) tegen de lokale Supabase; zie [End-to-end tests](#end-to-end-tests) |

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

Voer eerst `pnpm db:migrate` uit: het script controleert vooraf of de database bereikbaar is en `profiles`
bestaat, en maakt anders niets aan. Het script maakt de gebruiker in Supabase Auth en het profiel met rol
`backoffice`. Het wachtwoord komt uit `SEED_BACKOFFICE_PASSWORD`; is dat leeg, dan wordt er een gegenereerd en
meteen getoond zodra het account bestaat (één keer, bewaar het). Opnieuw uitvoeren
is veilig: een bestaande gebruiker of een bestaand profiel blijft ongemoeid, en een half afgewerkte eerdere
poging wordt aangevuld. Een bestaande Auth-gebruiker zonder profiel of een uitgeschakeld backoffice-profiel
levert een duidelijke waarschuwing op. Het script heeft `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` en `DATABASE_URL` nodig.

Een gebruiker met een profiel kan niet via het Supabase-dashboard verwijderd worden (`ON DELETE RESTRICT` op
`profiles.id`). Dat is bedoeld: zo blijven gewerkte uren traceerbaar. Gebruikers worden in de toepassing
uitgeschakeld, nooit verwijderd.

### Aanmelden in de toepassing

Aanmelden (`/login`) gaat met e-mail en wachtwoord via Supabase Auth. Na het aanmelden gaat een technieker
naar `/my-tasks` en een backoffice-gebruiker naar `/tasks`; `/` stuurt iedereen naar de juiste startpagina
(of naar `/login` zonder sessie). Lokaal aanmelden, met de lokale Supabase of met een eigen Supabase-project:

```bash
supabase start                                   # enkel voor de lokale Supabase; zie `.env.example` voor de waarden
pnpm db:migrate
SEED_BACKOFFICE_PASSWORD="kies-een-wachtwoord-van-12+" pnpm seed:backoffice "Voornaam Achternaam" naam@bedrijf.be
pnpm dev                                         # open http://localhost:3000 en meld aan met dat adres
```

Met een eigen Supabase-project vul je de URL, de sleutels en `DATABASE_URL` van dat project in `.env.local` in
(zie de tabel hierboven) en voer je dezelfde `db:migrate`- en `seed:backoffice`-stappen uit. Een technieker
kan je pas aanmaken zodra het uitnodigen is gebouwd (BT-06). Een uitgeschakelde gebruiker kan niet aanmelden;
is hij al aangemeld, dan wordt hij bij het volgende verzoek afgemeld en naar `/login` gestuurd.

### End-to-end tests

`pnpm test:e2e` bouwt de toepassing, start ze en draait Playwright (desktop en gsm). De tests melden echt aan,
dus ze hebben een draaiende Supabase nodig (Docker en de Supabase CLI), met gemigreerde database:

```bash
supabase start
pnpm db:migrate
supabase status -o env       # zet NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
                             # SUPABASE_SECRET_KEY en DATABASE_URL in .env.local (zie .env.example)
pnpm exec playwright install chromium   # eenmalig
pnpm test:e2e
```

Een Playwright global setup (`e2e/global-setup.ts`) maakt vóór de tests de testgebruikers aan (backoffice,
technieker, een uitgeschakelde en een geblokkeerde technieker): in Supabase Auth via de admin-API en hun profiel
via Drizzle. Het testwachtwoord staat in `e2e/support/test-users.ts` (of in `E2E_TEST_PASSWORD`); het is enkel een
testwaarde voor de lokale Supabase, geen geheim. Gebruik de tests nooit tegen een echt Supabase-project: ze maken
gebruikers aan.

In CI doet de job `End-to-end tests` hetzelfde op de runner: Supabase CLI via de officiële action, `supabase start`,
`pnpm db:migrate`, de lokale URL en sleutels uit `supabase status -o env` als omgeving voor build en tests, en
daarna `pnpm test:e2e`. Die sleutels bestaan enkel op de runner.

`pnpm test` draait zonder database; databasetests (`*.db.test.ts`) lopen enkel via `pnpm test:db`.

## CI

Elke pull request draait drie jobs: `Lint, typecheck, unit tests, audit`, `End-to-end tests` en
`Database tests`. De laatste twee starten een lokale Supabase op de runner en passen de Drizzle-migraties toe;
`Database tests` draait daarna `pnpm test:db`, `End-to-end tests` draait `pnpm test:e2e`. Acties staan vastgezet op een commit-SHA (vereiste van de Semgrep-scan).
