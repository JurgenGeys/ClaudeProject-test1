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

| Variabele                              | Waarvoor                                                                                  | Waar zichtbaar |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| `DATABASE_URL`                         | Verbinding voor Drizzle en `pnpm db:migrate`                                              | Enkel server   |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL van het Supabase-project                                                              | Ook browser    |
| `SITE_URL`                             | Publiek adres van de toepassing; de link in de uitnodigingsmail wordt hieruit gebouwd     | Enkel server   |
| `NEXT_PUBLIC_COMPANY_NAME`             | Naam van het bedrijf van de klant, boven de titel op het aanmeldscherm (leeg = geen naam) | Ook browser    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publieke sleutel, enkel voor aanmelden en sessies                                         | Ook browser    |
| `SUPABASE_SECRET_KEY`                  | Geheime sleutel (omzeilt alle beveiliging per rij): enkel server en scripts               | Enkel server   |
| `SEED_BACKOFFICE_PASSWORD`             | Optioneel: wachtwoord voor de eerste backoffice-gebruiker (min. 12 tekens)                | Enkel script   |

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
(zie de tabel hierboven) en voer je dezelfde `db:migrate`- en `seed:backoffice`-stappen uit. Techniekers voeg je toe
via het scherm Techniekers (zie [Techniekers uitnodigen](#techniekers-uitnodigen)). Een uitgeschakelde gebruiker kan
niet aanmelden; is hij al aangemeld, dan wordt hij bij het volgende verzoek afgemeld en naar `/login` gestuurd.

### Techniekers uitnodigen

Een backoffice-gebruiker voegt een technieker toe op `/technicians` (menu Techniekers, knop **Technieker toevoegen**).
De applicatie laat Supabase Auth een uitnodigingsmail sturen (`inviteUserByEmail` met de geheime sleutel, server-side)
en maakt een profiel met rol `technician` aan. Tot de technieker een wachtwoord koos staat hij als **Uitgenodigd** in
de lijst, met de knop **Uitnodiging opnieuw versturen**.

### Techniekers uitschakelen

Bij een **actieve** technieker staat op `/technicians` de knop **Uitschakelen** (met bevestigingsdialoog). Dat kan enkel
als hij geen open taken heeft (Toegewezen of Opgepikt); anders weigert de applicatie en toont ze het aantal, met een
link naar zijn taken. Uitschakelen zet in één transactie `is_active = false` en `deactivated_at` én blokkeert zijn
Auth-account (`ban_duration` van tien jaar, in dezelfde transactie, zodat het één geheel is). Zijn afgewerkte taken
en uren blijven bewaard. Een aangemelde technieker wordt bij zijn volgende verzoek afgemeld ("Je account is
uitgeschakeld"); aanmelden geeft hem de algemene melding. Een uitgenodigde technieker die nog geen wachtwoord koos kan
niet uitgeschakeld worden. Details: ontwerp, hoofdstuk 6.

### Techniekers opnieuw activeren

Bij een **uitgeschakelde** technieker staat op `/technicians` de knop **Opnieuw activeren** (met bevestigingsdialoog).
Dat zet in één transactie `is_active = true` en `deactivated_at = null` én heft de blokkering van zijn Auth-account op
(`ban_duration: "none"`). Lukt het opheffen niet, dan gebeurt er niets; lukt de commit niet, dan wordt de blokkering
opnieuw gezet. Hij meldt zich daarna aan met zijn bestaande wachtwoord (vergeten: "Wachtwoord vergeten"); er wordt
geen uitnodiging verstuurd. Zijn taken worden niet automatisch teruggegeven. Een actieve, uitgenodigde of onbestaande
technieker, of een backoffice-gebruiker, wordt geweigerd.

De stroom:

1. De mail bevat een link `<SITE_URL>/auth/confirm?token_hash=…&type=invite`.
2. `/auth/confirm` toont enkel een uitleg en de knop **Wachtwoord instellen**. Het openen van de link (ook door een
   mailscanner of linkvoorbeeld) verbruikt het token niet. Pas de klik controleert het token en maakt een tijdelijke
   sessie; daarna gaat de technieker naar `/set-password?mode=invite` (scherm "Wachtwoord instellen").
3. Zolang `profiles.invite_pending` waar is, geldt die sessie nergens anders: elke pagina en elke Server Action
   behandelt de gebruiker als "nog zonder wachtwoord" en stuurt hem naar `/set-password`. Aanmelden met een
   wachtwoord kan dan ook niet. De knop **Annuleren** op dat scherm meldt de sessie af. De sessie telt 24 uur vanaf de
   klik (`profiles.invite_verified_at`, databaseklok); daarna wordt ze afgemeld met "De link is verlopen. Vraag kantoor
   om een nieuwe uitnodiging." Na het kiezen van een wachtwoord (minstens 8 tekens) is hij aangemeld en gaat hij
   naar `/my-tasks`.
4. Een ongeldige, verlopen of al gebruikte link toont "Deze link is niet meer geldig. Vraag kantoor om een nieuwe
   uitnodiging."

`SITE_URL` (bv. `http://localhost:3000`, zonder pad) bepaalt het adres in de mail. Het komt nooit uit de
`Host`-header van een verzoek (anders kan iemand een mail met een link naar een andere site uitlokken). Zonder
`SITE_URL` (of met een ongeldige waarde) lukt het uitnodigen niet, met een duidelijke fout in de serverlog. Gewone
`http` wordt enkel voor `localhost` aanvaard.

**Lokaal**: `supabase start` (zie boven), `SITE_URL=http://localhost:3000` in `.env.local`, `pnpm dev`, meld aan als
backoffice-gebruiker en voeg een technieker toe. De mail komt niet in een echte mailbox maar in de testmailbox
(Mailpit) van de lokale Supabase op <http://127.0.0.1:54324>; open daar de mail en klik op de link.
`supabase/config.toml` bevat daarvoor het sjabloon (`supabase/templates/invite.html`), de toegelaten redirect-URL's
(`http://localhost:3000/auth/confirm` en dezelfde met `127.0.0.1`) `enable_signup = false` en hogere limieten voor het aantal
mails per uur en het aantal tokencontroles (`email_sent`, `token_verifications`, enkel lokaal). Draai je de app op een andere poort of host, pas dan `SITE_URL` en
`additional_redirect_urls` aan.

**Een echt Supabase-project** leest `supabase/config.toml` niet. Stel dit in het dashboard in
(per klantproject, zie ADR-0002):

1. _Authentication, URL Configuration_: **Site URL** = de waarde van `SITE_URL`; bij **Redirect URLs** komt
   `<SITE_URL>/auth/confirm` (exact dat adres). Staat het adres niet in de lijst, dan valt Supabase terug op de Site
   URL en werkt de link niet.
2. _Authentication, Email Templates_: bij **Invite user** onderwerp "Je uitnodiging voor de planning" en als inhoud de
   tekst uit `supabase/templates/invite.html`; bij **Reset password** onderwerp "Kies een nieuw wachtwoord voor
   de planning" en de tekst uit `supabase/templates/recovery.html` (die mail dient voor "Wachtwoord vergeten" en voor het
   opnieuw versturen aan een technieker die de eerste link al opende, zie hieronder). De sjablonen gebruiken `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`; het
   standaardsjabloon met `{{ .ConfirmationURL }}` werkt niet met deze stroom.
3. _Authentication, Sign In / Providers_: laat de e-mailprovider aan, en zet **Allow new users to sign up** uit
   (beslist door Jurgen, 25/11/2026). Gebruikers komen enkel via een uitnodiging (of het seed-script); de admin-API
   (uitnodigen) blijft werken. Als extra veiligheid hergebruikt de applicatie een Auth-account zonder profiel enkel als
   ze het zelf aanmaakte (`invited_by_app` in `app_metadata`); een ander account geeft "Er bestaat al een gebruiker met
   dit e-mailadres."
4. _Authentication, Sign In / Providers, Email_: de geldigheid van de link is de **Email OTP Expiration** (standaard
   1 uur, maximaal 24 uur). Een technieker die te laat is, krijgt via **Uitnodiging opnieuw versturen** een nieuwe mail.
   Zorg dat de optie die het huidige wachtwoord vraagt bij een wachtwoordwijziging ("Secure password change" of
   "Require current password when updating") uit staat: de technieker heeft nog geen wachtwoord.
5. _Mail versturen_: de ingebouwde mailserver van Supabase is enkel om te testen (zeer weinig mails per uur, en enkel
   naar teamleden van het project). Voor echt gebruik is een eigen SMTP-dienst nodig (keuze K6, nog open).
6. De omgevingsvariabele `SITE_URL` op de hosting van de applicatie, met hetzelfde adres als de Site URL.
7. _Databaserol_: de rol in `DATABASE_URL` moet `auth.users` kunnen lezen (`SELECT`); het uitnodigen zoekt daar het
   adres op (`findAuthUserByEmail`). Controleer het met dezelfde verbinding:
   `select id from auth.users limit 1;`. Krijg je "permission denied for table users", gebruik dan een verbinding met de
   rol `postgres` (de connection string van het project, ook via de pooler), of geef de gebruikte rol leesrecht met
   `grant usage on schema auth to <rol>; grant select on auth.users to <rol>;` (eenmalig, in de SQL-editor van het
   project; geen schemawijziging van de applicatie). Zonder leesrecht mislukt het opzoeken en geeft uitnodigen de
   technische foutmelding.

**Opnieuw versturen na openen.** Supabase stuurt geen uitnodiging meer naar een adres dat het al bevestigd heeft (na de
klik op de knop). Heeft de technieker toen geen wachtwoord gekozen, dan stuurt **Uitnodiging opnieuw versturen** de mail
"Reset password" (type `recovery`, via `resetPasswordForEmail`) met een nieuwe link naar dezelfde tussenpagina. Daarom
moet dat sjabloon ook ingesteld zijn. Voor een technieker die nog geen wachtwoord koos (`invite_pending`) geeft zo'n link de
uitnodigingssessie; voor iedere andere actieve gebruiker is het de herstelsessie van "Wachtwoord vergeten" (hieronder).

### Wachtwoord vergeten

Op de aanmeldpagina staat naast het veld Wachtwoord de link **Wachtwoord vergeten?** naar `/forgot-password`. Daar vult
iemand zijn e-mailadres in en krijgt hij **altijd** dezelfde melding ("Als dit e-mailadres bij ons gekend is, krijg je
binnen enkele minuten een mail ..."), ook voor een onbekend of uitgeschakeld adres en ook als Supabase geen nieuwe mail
meer wil sturen (limiet). Het scherm verraadt dus niet welke adressen bestaan. De mail wordt pas na het antwoord
verstuurd (`after`), zodat ook het tijdsverschil niets verraadt; mislukt het versturen, dan staat dat enkel in de
serverlog. Alleen een bestaand, actief profiel krijgt een mail.

De stroom daarna:

1. De mail (Supabase "Reset password", sjabloon `supabase/templates/recovery.html`) bevat een link
   `<SITE_URL>/auth/confirm?token_hash=…&type=recovery`. Zoals bij een uitnodiging toont die pagina eerst een knop;
   pas de klik verbruikt het token.
2. De klik maakt een **herstelsessie**: de server bewaart het id van die ene sessie en het tijdstip in
   `profiles.recovery_session_id` en `profiles.recovery_verified_at`. Die sessie mag enkel `/set-password?mode=reset`
   gebruiken (pagina's, Server Actions en `/` sturen ernaartoe; aanmelden met die sessie opent niets). Ze duurt 24 uur
   (daarna: afgemeld met "De link is verlopen. Vraag een nieuwe link aan.") en heeft een knop **Annuleren**. Andere
   sessies van dezelfde gebruiker (bv. een gsm die al aangemeld is) blijven gewoon werken tot het wachtwoord gekozen is.
3. Na het kiezen van een nieuw wachtwoord worden **alle andere sessies** van die gebruiker beëindigd
   (`signOut` met scope `others`) en gaat hij naar het startscherm van zijn rol. Het oude wachtwoord werkt niet meer.
4. Een uitgeschakelde gebruiker, een gebruiker zonder profiel en een ongeldige, verlopen of gebruikte link krijgen
   dezelfde melding: "Deze link is niet meer geldig. Vraag een nieuwe link aan." met een knop naar `/forgot-password`.

Instellingen voor een echt Supabase-project (naast de punten hierboven):

- _Authentication, Email Templates, Reset password_: het sjabloon uit `supabase/templates/recovery.html` (het gebruikt
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`; `{{ .ConfirmationURL }}` werkt niet met deze stroom).
- _Authentication, URL Configuration, Redirect URLs_: `<SITE_URL>/auth/confirm`. Dat is dezelfde URL als voor de
  uitnodiging; er komt geen extra adres bij. Staat hij er niet in, dan valt Supabase terug op de Site URL en werkt de
  link niet.
- De geldigheid van de link is de **Email OTP Expiration** (standaard 1 uur); de herstelsessie zelf duurt daarna nog 24
  uur. Supabase laat per adres maximaal één mail per minuut toe en kent een limiet per uur voor het hele project (zie K6
  voor een eigen SMTP-dienst); de gebruiker merkt dat niet aan het scherm.

**Auth-account zonder profiel (uitnodigen zegt "Er bestaat al een gebruiker met dit e-mailadres.").** Dit gebeurt als
er een account in Supabase Auth staat dat de applicatie niet zelf aanmaakte (geen `invited_by_app` in `app_metadata`) en
er geen profiel bij hoort, bv. een handmatig aangemaakte gebruiker of een mislukte eerdere poging. Oplossing:

1. Zoek het adres op in _Authentication, Users_ van het Supabase-dashboard en bepaal of het account bedoeld is.
2. Ongewenst of een restant: verwijder het account in het dashboard (_Delete user_) en nodig de technieker opnieuw uit.
3. Wel bedoeld: laat de applicatie het hergebruiken door het merkteken te zetten met de admin-API (server-side, met de
   geheime sleutel; die komt nooit in de browser of in de repository):
   `PUT <project-url>/auth/v1/admin/users/<id>` met header `apikey` en `Authorization: Bearer <geheime sleutel>` en body
   `{"app_metadata": {"invited_by_app": true}}`. Nodig daarna opnieuw uit; de applicatie maakt dan het profiel aan en
   stuurt de mail.

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

De tests voor het uitnodigen (`e2e/invite.spec.ts`) en voor wachtwoord vergeten (`e2e/forgot-password.spec.ts`) lezen de mail uit de testmailbox van de lokale Supabase
(Mailpit, standaard `http://127.0.0.1:54324`, aan te passen met `E2E_MAIL_URL`; enkel een adres op deze machine wordt
aanvaard) en openen de link daaruit. Daarvoor moet `SITE_URL` het adres zijn waarop de tests de app openen
(`http://localhost:3000`; `playwright.config.ts` zet die waarde als hij niet ingesteld is).

Een Playwright global setup (`e2e/global-setup.ts`) maakt vóór de tests de testgebruikers aan (backoffice,
technieker, een uitgeschakelde en een geblokkeerde technieker); de tests van `e2e/deactivate.spec.ts` en `e2e/reactivate.spec.ts` maken een eigen technieker aan en ruimen hem (en zijn taken) op: in Supabase Auth via de admin-API en hun profiel
via Drizzle. Het testwachtwoord staat in `e2e/support/test-users.ts` (of in `E2E_TEST_PASSWORD`); het is enkel een
testwaarde voor de lokale Supabase, geen geheim. Gebruik de tests nooit tegen een echt Supabase-project: ze maken
gebruikers aan.

In CI doet de job `End-to-end tests` hetzelfde op de runner: Supabase CLI via de officiële action, `supabase start`,
`pnpm db:migrate`, de lokale URL en sleutels uit `supabase status -o env` als omgeving voor build en tests, en
daarna `pnpm test:e2e`. Die sleutels bestaan enkel op de runner. `supabase/config.toml` verhoogt de rate limit voor aanmeldingen van de lokale Auth-server naar 300 per 5 minuten (de tests melden vaak aan vanaf één IP-adres); dat geldt enkel lokaal en in CI, niet voor echte Supabase-projecten. CI zet `NEXT_PUBLIC_COMPANY_NAME` op een testwaarde die een test op het aanmeldscherm controleert, en `SITE_URL` op
`http://localhost:3000` voor de link in de uitnodigingsmail.

`pnpm test` draait zonder database; databasetests (`*.db.test.ts`) lopen enkel via `pnpm test:db`.

## CI

Elke pull request draait drie jobs: `Lint, typecheck, unit tests, audit`, `End-to-end tests` en
`Database tests`. De laatste twee starten een lokale Supabase op de runner en passen de Drizzle-migraties toe;
`Database tests` draait daarna `pnpm test:db`, `End-to-end tests` draait `pnpm test:e2e`. Acties staan vastgezet op een commit-SHA (vereiste van de Semgrep-scan).
