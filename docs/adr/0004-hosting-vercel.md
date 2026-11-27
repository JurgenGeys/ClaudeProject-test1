# ADR-0004: Hosting van de applicatie op Vercel (regio Frankfurt)

- **Status**: Aanvaard
- **Datum**: 2026-11-26
- **Beslist door**: Jurgen

## Context

De applicatie (Next.js, zie ADR-0001) moet ergens draaien, zowel voor een online testomgeving als later
voor klanten. Jurgen kan zelf geen servers beheren of bewaken (zie ADR-0002); de hosting moet dus
beheerd zijn en weinig opzetwerk vragen. Randvoorwaarden:

- applicatie en data in de EU (GDPR), dicht bij de Supabase-regio Frankfurt (ADR-0002);
- een voorbeeldomgeving per pull request, zodat Jurgen een wijziging kan aanklikken voor hij merget;
- geen eigen serverbeheer.

Aandachtspunt uit issue #48: zoektermen en filters staan in de URL (bv. `/customers?q=Peeters`).
Zulke URL's kunnen in toegangslogs van de host terechtkomen.

## Beslissing

De applicatie draait op **Vercel**, met de functies vastgezet op de regio **Frankfurt (`fra1`)**
(`vercel.json`). Vercel is native voor Next.js, koppelt rechtstreeks aan GitHub en maakt
automatisch een preview per pull request.

## Overwogen alternatieven

- **Clever Cloud** (Frans): Europees bedrijf, geen Amerikaanse moeder. Meer opzetwerk: previews per
  pull request en de koppeling met GitHub moeten zelf ingericht worden.
- **Scaleway** (Frans): Europees en soeverein. Meer opzetwerk (containers of eigen build- en
  deploystraat), meer beheer voor één persoon.
- **Eigen server of VPS**: meeste controle, maar onderhoud, updates en beveiliging komen bij Jurgen terecht.

## Gevolgen

- Positief: snelle opzet; Next.js 16 (App Router, `cacheComponents`, `src/proxy.ts`) wordt
  herkend zonder extra configuratie; preview per pull request; functies in Frankfurt, dus
  korte afstand tot de Supabase-database.
- Negatief / risico's:
  - Vercel is een Amerikaans bedrijf. Er is een verwerkersovereenkomst (DPA) en Vercel valt onder het
    EU-US Data Privacy Framework (DPF). Supabase (ook een Amerikaans bedrijf, data in Frankfurt) heeft
    een DPA en een doorgiftemechanisme (DPF of standaardcontractbepalingen; te controleren in #88).
    Wie volledige Europese soevereiniteit eist, kiest een van de alternatieven.
  - De regio `fra1` geldt voor de uitvoering van de functies. Statische bestanden (assets) worden via
    het wereldwijde netwerk geserveerd en logging kan buiten de EU passeren.
  - Vercel-builds draaien standaard in de VS. Daar komen broncode en build-variabelen terecht, geen
    persoonsgegevens.
  - Voor commercieel gebruik is het betalende Pro-plan nodig; het gratis Hobby-plan is enkel voor
    niet-commercieel gebruik (testen en oefenen). Ook een demo voor een betalende klant kan al
    commercieel gebruik zijn. Kosten doorrekenen in de prijs per klant.
  - URL's met zoektermen kunnen in Vercel-logs belanden (zie issue #48).
  - Opvolg-issue #88 houdt de nog te controleren punten bij: logs en bewaartermijn, data buiten de EU,
    builds in de VS, het gedrag van de Proxy, de doorgifte door Supabase en het Pro-plan. Af te ronden
    vóór er persoonsgegevens van een echte klant in komen.
  - `SITE_URL` staat vast per omgeving: uitnodigings- en herstellinks wijzen altijd naar dat adres,
    ook als de mail vanuit een preview-deployment verstuurd wordt (zie README).
- Wat agents hierdoor wel en niet mogen doen: Vercel-specifieke configuratie blijft beperkt tot
  `vercel.json`; geen Vercel-specifieke pakketten (bv. `@vercel/*`) toevoegen zonder goedkeuring.
  Databasemigraties lopen niet via Vercel maar via de handmatige workflow `deploy-db.yml`
  (Drizzle-migraties, zie ADR-0002). Geen secrets in code of repository: ze staan in Vercel en in
  de GitHub-environment `test`.
