# ADR-0003: `tasks.updated_at` wordt door een databasetrigger gezet

- **Status**: Aanvaard, beslist door Jurgen 25/11/2026
- **Datum**: 2026-11-25
- **Beslist door**: Jurgen

## Context

Het bewerkformulier van een taak (BT-10) beschermt tegen verloren updates: het formulier draagt de `updated_at` van de taak mee en `updateTask` bewaart enkel als die nog dezelfde is. Dat werkt alleen als **elke** schrijver van een taak `updated_at` verandert (oppikken, terugzetten, afmelden, annuleren, factureren, uren corrigeren, en alles wat later komt). Drizzle zet het via `$onUpdate`, maar een raw-SQL-update, een script of een migratie doet dat niet. Een vergeten schrijver zou een stille fout geven: een bewerking die een andere wijziging overschrijft (GitHub-issue #70).

## Beslissing

Een `BEFORE UPDATE`-trigger op `tasks` zet `updated_at` op `greatest(clock_timestamp(), oude updated_at + 1 microseconde)`. De waarde komt altijd van de databaseklok, een expliciet meegegeven `updated_at` wordt overschreven, en ze stijgt strikt per rij. Ingevoerd met een Drizzle-migratie (`0005_tasks_updated_at_trigger`) die enkel een functie en een trigger toevoegt.

## Overwogen alternatieven

- Elke Server Action laat `updated_at` zetten (Drizzle `$onUpdate`): niets dwingt het af voor raw SQL of een nieuwe schrijver.
- Een aparte versiekolom (teller): een extra kolom en dezelfde afhankelijkheid van schrijvers, zonder voordeel boven een trigger.
- `FOR UPDATE` zonder versie: beschermt enkel tijdens de transactie, niet tussen het openen van het formulier en het bewaren.

## Gevolgen

- Positief: de versiecontrole van BT-10 geldt voor elke schrijver, nu en later; geen vergeten `updated_at`.
- Negatief / risico's: logica in de database naast de code (eenvoudig en getest); ook een update die niets wijzigt verandert de versie.
- Wat agents hierdoor wel en niet mogen doen: `updated_at` hoeft in een update niet meer gezet te worden (en heeft geen effect). Een databasetest bewijst het gedrag. Het verwijderen of omzeilen van de trigger vraagt een nieuwe ADR.
