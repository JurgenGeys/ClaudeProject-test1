# Projectregels

Dit project bouwt maatsoftware voor kleine KMO's (0–20 werknemers).
Lees bij elke taak ook de technologiekeuzes:

@docs/tech-stack.md

## Werkwijze

- Werk op een eigen branch, nooit rechtstreeks op `main`. Lever op via een pull request.
- Houd wijzigingen klein en afgebakend: één onderwerp per pull request.
- Schrijf tests bij elke functionele wijziging.
- Een taak is pas klaar als lint, typecheck en tests slagen
  (`pnpm lint`, `pnpm typecheck`, `pnpm test`). Vermeld het resultaat in je eindrapport.
- Twijfel je over een vereiste of ontbreekt er iets (toegang, secret, info)?
  Stop en stel een vraag. Gok niet, en vervang niets door een mock of workaround.

## Rollen en volgorde

Werk wordt door gespecialiseerde agents (`.claude/agents/`) in deze volgorde gedaan:

1. **analyst**: ruwe input (`docs/input/`) → functionele analyse (`docs/analysis/`)
2. *Jurgen keurt de analyse goed en beantwoordt open vragen (met de klant)*
3. **designer**: analyse → ontwerp en klikbare schermmockups (`docs/design/`)
4. *Jurgen keurt het ontwerp goed (eventueel samen met de klant)*
5. **developer**: bouwt per bouwtaak uit het ontwerp, met tests
6. **tester**: test vanuit de gebruiker en vult tests aan
7. **reviewer**: beoordeelt de pull request; Jurgen merget

Sla geen stap over. Begint een taak zonder goedgekeurde analyse of ontwerp, meld dat eerst.

## Wat eerst goedkeuring van Jurgen vraagt

- Een nieuwe dependency toevoegen.
- Een keuze maken die in `docs/tech-stack.md` als **Open** staat.
- Afwijken van een beslissing in `docs/adr/`.
- CI-configuratie of beveiligingsinstellingen wijzigen.
- Databasemigraties die data verwijderen of hernoemen.
- Mergen naar `main` (dat doet Jurgen altijd zelf).

## Conventies

- Code, namen, commentaar en commitberichten in het Engels; commits volgens Conventional Commits.
- Teksten die eindgebruikers zien in het Nederlands.
- Nooit secrets in code of in de repository. Gebruik environment variables; `.env`-bestanden worden nooit gecommit.

## Beslissingen

Architectuurbeslissingen staan in `docs/adr/`. Vereist een taak een nieuwe structurele
keuze, stel dan een nieuwe ADR voor (volgens `docs/adr/template.md`) in plaats van zelf te beslissen.
