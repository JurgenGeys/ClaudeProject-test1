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
| `pnpm test:e2e`  | End-to-end-tests (Playwright); eenmalig eerst `pnpm exec playwright install chromium` |

Dezelfde controles draaien automatisch bij elke pull request (`.github/workflows/`).
