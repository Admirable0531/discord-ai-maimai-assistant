# Sharing the chart viewer outside your network

The bot serves two things:

| Port | What | Safe to put on the internet? |
|---|---|---|
| 3002 | `/health`, `/api/ai-usage` (your AI spending) and the chart viewer | **No.** Keep it on the local network. |
| 3003 | Chart pages only (`/chart`, search, custom charts) | Yes. Rate limited, no search-engine indexing, no wiki chart text. |

Always publish **3003**, never 3002.

## Easiest: a Cloudflare quick tunnel (no account, temporary link)

On the Pi:

```
docker run --rm --network host cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://localhost:3003
```

It prints a link like `https://something-random.trycloudflare.com`. Send that link to anyone. It stops
working when you stop the command and the address changes next time.

## Permanent link: a named Cloudflare tunnel, or Tailscale Funnel

- **Cloudflare named tunnel** (free account and a domain you own): create a tunnel in the Cloudflare
  dashboard, point a hostname such as `charts.yourdomain.com` at `http://localhost:3003`, and run
  `cloudflared` as a service (it can be added to `docker-compose.yml`).
- **Tailscale Funnel** (free): install Tailscale on the Pi, then `tailscale funnel 3003`. You get a public
  `https://<machine>.<tailnet>.ts.net` address that stays the same.

## Not recommended

- Port-forwarding on your router: it exposes your home address and needs HTTPS set up by hand.
- A cloud host (Fly.io, Render): the simai wiki challenges data-centre addresses, so wiki charts may fail to load.

## Things to know before sharing

- Visitors share your home address towards the simai wiki, which cached pages soften (a song page is kept
  for 7 days); heavy use could get the address challenged again.
- On the public copy the chart text of wiki charts is not shown beside the timeline. A chart a visitor
  pastes themselves does show their own text back to them, and is not stored.
- The charts are fan transcriptions of official charts. Showing the analysis is one thing; check you are
  comfortable with how widely you share it.

## How it is set up on this machine

A Cloudflare quick tunnel runs as its own container, outside the bot's compose project, so a deploy
does not change the link:

```
docker run -d --name atri_chart_tunnel --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --metrics 0.0.0.0:20250 --url http://localhost:3003
```

- It starts again by itself after a reboot (`--restart unless-stopped`, and Docker is enabled at boot).
- The address (`https://….trycloudflare.com`) is random and **changes whenever that container restarts**
  (for example after a reboot). The local page `http://<pi>:3002/chart` shows the current public link at
  the top, with a Copy button; or run `curl http://localhost:20250/quicktunnel`.
- For an address that never changes, switch on Tailscale Funnel once (it needs a click in your Tailscale
  admin page: `tailscale funnel --bg 3003` prints the link to enable it) and share the `*.ts.net` address.
