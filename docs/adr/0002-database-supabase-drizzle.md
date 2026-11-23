# ADR-0002: Supabase als dataplatform, Drizzle als database-laag

- **Status**: Aanvaard
- **Datum**: 2026-11-23
- **Beslist door**: Jurgen

## Context

Elk project heeft een database, authenticatie en vaak bestandsopslag nodig.
Elmija is een eenpersoonsbedrijf: Jurgen schrijft zelf geen code en kan geen
eigen infrastructuur beheren of bewaken. Code wordt grotendeels door agents geschreven.
Randvoorwaarden:

- data van klanten blijft in de EU (GDPR);
- zo weinig mogelijk zelfgebouwde beveiliging, vooral rond inloggen;
- wijzigingen aan de database moeten reviewbaar zijn en door de CI-pipeline gecontroleerd;
- beperkte afhankelijkheid van één leverancier.

## Beslissing

- **Supabase** (EU-regio, Frankfurt) levert de PostgreSQL-database, de authenticatie
  (Supabase Auth) en de bestandsopslag (Supabase Storage).
- **Drizzle ORM** is de enige manier waarop applicatiecode de database leest en schrijft.
  Het schema en alle migraties staan als code in de repository.
- Elke klant krijgt een eigen Supabase-project (aparte database, aparte gebruikers).

## Overwogen alternatieven

- **Enkel Drizzle met een eigen PostgreSQL-hosting**: meeste controle, maar authenticatie
  en opslag moeten zelf gebouwd of apart gekozen worden. Te veel beveiligingsrisico
  en beheer voor één persoon die niet zelf codeert.
- **Enkel Supabase met de Supabase-client (`supabase-js`)**: snelst opgezet, maar het
  datamodel en de toegangsregels leven grotendeels in de Supabase-omgeving in plaats
  van in de code, en de lock-in is groter.
- **Neon of andere beheerde PostgreSQL**: goede database, maar geen ingebouwde authenticatie of opslag.

## Gevolgen

- Positief: authenticatie en opslag zijn beheerd en getest; datamodel is reviewbare code;
  getypeerde queries vangen fouten via de typecheck; overstappen kan, omdat enkel de
  authenticatie aan Supabase gebonden is.
- Negatief / risico's:
  - kosten per klantproject (Pro-plan plus compute per project), door te rekenen in de prijs;
  - Supabase stelt tabellen standaard open via een publieke API: Row Level Security is
    verplicht op elke tabel (zie regels hieronder);
  - gratis projecten worden gepauzeerd bij inactiviteit: enkel geschikt om te oefenen.

## Regels voor agents

1. Lees en schrijf data enkel via Drizzle, vanuit server-code (Server Components,
   Server Actions, route handlers). Gebruik `supabase-js` in de browser **enkel** voor
   inloggen, uitloggen en sessiebeheer.
2. **Row Level Security staat aan op elke tabel**, ook op tabellen die enkel via Drizzle
   gebruikt worden. Zonder expliciete policy is alle toegang via de publieke API geweigerd.
   Elke migratie die een tabel aanmaakt, zet RLS aan in dezelfde migratie.
3. **Autorisatie zit in de code**: elke Server Action controleert wie de gebruiker is en
   of die deze actie op deze gegevens mag doen, en heeft daar tests voor.
   RLS is een tweede vangnet, geen vervanging.
4. Schemawijzigingen enkel via Drizzle-migraties in de repository, nooit manueel in het
   Supabase-dashboard.
5. De service role key wordt enkel server-side gebruikt, nooit in client-code of in een
   variabele met prefix `NEXT_PUBLIC_`.
6. Gebruikers, rollen en wachtwoordbeheer via Supabase Auth; geen eigen loginsysteem bouwen.
