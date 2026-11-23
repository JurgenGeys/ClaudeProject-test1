# Technologiekeuzes

Status per keuze:
- **Beslist**: altijd volgen.
- **Voorstel**: volgen, tenzij Jurgen anders beslist.
- **Open**: nog niet gekozen. Agents kiezen dit niet zelf; vraag het aan Jurgen.

## Overzicht

| Laag | Keuze | Status |
|---|---|---|
| Taal | TypeScript, `strict` mode | Beslist |
| Framework | Next.js met App Router | Beslist |
| Runtime | Node.js, huidige LTS-versie | Beslist |
| Package manager | pnpm | Beslist |
| Styling & UI-componenten | Tailwind CSS + shadcn/ui | Beslist |
| Validatie van input | Zod | Beslist |
| Database | PostgreSQL via Supabase, EU-regio (Frankfurt) | Beslist |
| Database-toegang | Drizzle ORM (schema en migraties in de repository) | Beslist |
| Authenticatie | Supabase Auth | Beslist |
| Bestandsopslag | Supabase Storage | Beslist |
| Hosting van de applicatie | Voorkeur voor hosting in de EU (GDPR) | **Open** |
| Unit- en componenttests | Vitest + Testing Library | Beslist |
| End-to-end tests | Playwright | Beslist |
| Linting & formatting | ESLint + Prettier | Beslist |
| CI/CD | GitHub Actions | Beslist |
| Beveiligingsscans | Dependabot, CodeQL, `pnpm audit` | Beslist |

## Richtlijnen per laag

### TypeScript
- `strict: true`, geen `any` tenzij gemotiveerd in commentaar.
- Gedeelde types op één plaats; geen gedupliceerde definities.

### Next.js
- Server Components standaard; Client Components alleen waar interactie het vereist.
- Gegevens wijzigen via Server Actions of route handlers, nooit rechtstreeks vanuit de browser naar de database.
- Valideer alle input aan de serverkant met Zod, ook als er al validatie in het formulier zit.

### Dependencies
- Zo weinig mogelijk. Bestaat het al in de stack of in de standaardbibliotheek, voeg dan niets toe.
- Een nieuwe dependency vraagt goedkeuring (zie `CLAUDE.md`).

### Testen
- Elke functionele wijziging krijgt tests.
- Bedrijfslogica: unit tests (Vitest). Belangrijke gebruikersstromen: end-to-end tests (Playwright).

### Database en authenticatie (zie ADR-0002)
- Data lezen en schrijven enkel via Drizzle, vanuit server-code. `supabase-js` in de browser enkel voor inloggen, uitloggen en sessiebeheer.
- **Row Level Security staat aan op elke tabel**, in dezelfde migratie die de tabel aanmaakt.
- Autorisatie (wie mag wat) wordt in elke Server Action gecontroleerd en getest; RLS is een tweede vangnet.
- Schemawijzigingen enkel via Drizzle-migraties in de repository, nooit manueel in het Supabase-dashboard.
- De service role key enkel server-side; nooit in client-code of in een `NEXT_PUBLIC_`-variabele.
- Geen eigen loginsysteem: gebruikers en wachtwoorden via Supabase Auth.
- Elke klant krijgt een eigen Supabase-project.

### Beveiliging
- Volg de OWASP Top 10 als minimumniveau.
- Geen secrets in code. Configuratie via environment variables.
- Persoonsgegevens van klanten van de KMO enkel opslaan als het nodig is, en in de EU.

### CI-pipeline (elke pull request)
1. Lint en formatting
2. Typecheck
3. Unit tests
4. End-to-end tests
5. Beveiligingsscan van dependencies en code

Een pull request met een falende stap wordt niet gemerged.

## Open beslissingen

### Hosting
Nog te kiezen. Vereiste: data en applicatie in de EU.
