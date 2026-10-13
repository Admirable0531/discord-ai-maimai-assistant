# Atri: a Discord assistant for maimai DX

A Discord bot for a maimai DX community. It answers in chat with tools (DeepSeek, with Gemini or Groq as fallback), looks up scores and ratings, draws image cards, researches the web, keeps per-user memory, and analyses charts.

## What it does

- **Chat with tools.** Ask in a channel or with `/ask`. The model calls tools for scores, ratings, songs, plates, play history and web pages. See `src/ai/toolDefinitions.js`.
- **Slash commands.** `/b50`, `/rating`, `/target`, `/recommend`, `/compare`, `/history`, `/song`, `/preview`, `/circles`, `/leaderboard`, `/remember`, `/memories`, `/forget`, `/knowledge`, `/chartcheck`, `/help`.
- **Image cards.** B50 and rating history cards rendered with Playwright (`src/render`).
- **Memory.** Per-user memories and a shared knowledge base, both in SQLite.
- **Chart analysis.** See below.

## Chart analysis

`/chartcheck song difficulty` (and the `analyze_maimai_chart` chat tool) reads a chart from the simai wiki and lists, in plain language:

- **Splash risks**: places where a sensor can trigger the wrong note (rules A1, A2, A4, A5, A6, A9, A13 to A16).
- **Rhythm and speed changes**: rhythm change, BPM change, bursts and jacks (B1, B2, B4, B5).

Touches and slide ends have wide Perfect windows, so findings that involve only them are softened. Chart text is analysed but never reposted in Discord.

### Chart viewer

The bot also serves a web viewer, modelled on mai-notes and majdata:

- Timeline with the findings, scrub and play on a sensor ring, notes drawn like the game.
- Settings for speeds and sizes, hitsounds, mirror, rhythm colours, BPM and note counts.
- The chart text following the timeline (local network only), a glossary with tap-to-explain terms.
- Song search (plain letters work: "rondo" finds RONDØ) and custom charts (paste or upload simai or maidata).

| Port | What | Exposure |
|---|---|---|
| `HTTP_PORT` (3002) | `/health`, `/api/ai-usage` and the viewer with chart text | Local network only |
| `CHART_PORT` (3003) | Chart pages only: rate limited, not indexed, no wiki chart text | Safe to publish |

To share the viewer outside your network, see [docs/sharing-the-chart-viewer.md](docs/sharing-the-chart-viewer.md). The rules, thresholds and the checks against the game are in [docs/chart-analysis-plan.md](docs/chart-analysis-plan.md).

## Setup

Requires Node 18 or newer (the Docker image has everything else, including Chromium).

1. Copy `.env.example` to `.env` and fill it in. Required: `DISCORD_TOKEN`, `OWNER_USER_ID`, a key for the primary AI provider. Every option is commented in the file.
2. Enable "Message Content Intent" for the bot in the Discord Developer Portal.
3. Register the slash commands: `node deploy-commands.js` (needs `CLIENT_ID` and `GUILD_ID`).
4. Run it: `docker compose up -d --build`, or `npm install && npm start`.

### Permissions

`OWNER_USER_ID` always has access and is the only one who can grant or revoke access for others (admin commands in `src/discord/adminCommands.js`).

## Development

```
npm test        # node --test
npm run lint    # eslint src/
npm run format  # prettier
```

Layout:

| Path | Contents |
|---|---|
| `src/ai` | agent loop, providers, system prompt, tool definitions |
| `src/tools` | one file per model tool |
| `src/discord` | client, message handling, slash commands |
| `src/chart` | simai wiki lookup, chart model, geometry, rules, report, viewer page and client |
| `src/web` | Express servers (health, usage, chart routes) |
| `src/render` | image cards |
| `src/database` | SQLite schema and repositories |
| `test` | tests (chart parsing, rules, search) |

## Play simulation

The viewer has a "Play simulation" panel: virtual hands (full buttons, fingertips, dragging fingers, palm slides, big-hand touch, mixed) play the chart through a copy of the game's judging many times with small aiming and timing errors, and the spots where one input hits or blocks another are listed with a chance per style and drawn as hands on the sensor ring. It runs in a worker thread (`src/sim`), is also available as `simulate: true` on the chart tool, and is explained in [docs/play-simulation-plan.md](docs/play-simulation-plan.md) and [docs/judge-facts.md](docs/judge-facts.md).

Which hand takes a note is learned from "L. R. Breakdown" videos ([docs/hand-model.md](docs/hand-model.md)); the players' timing, how they set slides off, and how crowded music affects them are calibrated against the Great labels in 21 SSS external-output videos ([docs/external-output-notes.md](docs/external-output-notes.md)); player levels are in [docs/player-skill.md](docs/player-skill.md). Scripts that read the videos are in `scripts/lr/` and `scripts/ext/` (they need Chromium, so run them in a container).

## Deployment

A push to `main` runs `.github/workflows/deploy.yml` on a self-hosted runner: `git pull`, `docker compose down`, `docker compose up -d --build`. The container is `atri_bot`.
