# ADR-0001: TypeScript en Next.js als basis voor alle projecten

- **Status**: Aanvaard
- **Datum**: 2026-11-23
- **Beslist door**: Jurgen

## Context
Elmija bouwt betaalbare maatsoftware voor kleine KMO's, grotendeels met AI-agents.
De stack moet daarom:
- breed gedragen zijn, zodat AI-modellen er veel kwaliteitsvolle voorbeelden van kennen;
- één taal gebruiken voor frontend en backend, zodat één persoon alles kan overzien;
- fouten vroeg vangen, omdat Jurgen niet elke regel code zelf naleest;
- volstaan voor typische KMO-toepassingen: formulieren, overzichten, workflows, rapporten.

## Beslissing
Alle projecten gebruiken **TypeScript in strict mode** en **Next.js met de App Router**.

## Overwogen alternatieven
- **Python (Django/FastAPI) + aparte frontend**: sterk voor data, maar twee talen en twee codebases.
- **PHP (Laravel)**: populair bij KMO-webbouwers, maar minder sterk getypeerd en minder geschikt voor rijke interfaces.
- **Low-code platformen**: snel, maar vendor lock-in en beperkt maatwerk.
- **Plain JavaScript**: geen compiler die fouten vangt; te risicovol bij code die door agents geschreven wordt.

## Gevolgen
- Positief: één taal over het hele project; de typecheck vangt veel fouten van agents automatisch; grote community en hostingkeuze.
- Negatief / risico's: Next.js evolueert snel, dus versies moeten bewust opgevolgd worden; het framework is relatief complex voor zeer kleine toepassingen.
- Voor agents: geen andere taal of ander framework voorstellen voor applicatiecode. Scripts voor tooling mogen uitzonderlijk anders, maar enkel na goedkeuring.
