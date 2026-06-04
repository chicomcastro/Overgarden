# Overgarden — co-op server

Authoritative WebSocket server for online co-op. Each room holds one
authoritative `Sim` state (from `web/sim.js`), stepped at a fixed tick from the
intents clients send; snapshots are broadcast back. Because the **server** is
authoritative, a host leaving doesn't end the game, and players can drop in /
reconnect into a freed slot mid-round.

## Run locally

```bash
npm install
npm run server          # ws://0.0.0.0:8787  (PORT env to change)
```

Then open the web build pointing the client at it:

- Same machine/dev: the client defaults to `ws(s)://<page-host>:8787`.
- Explicit: add `?server=ws://HOST:PORT` to the page URL.

## Protocol (JSON over WebSocket)

- **C→S:** `{t:"create",count,difficulty}` · `{t:"join",room}` · `{t:"setup",count,difficulty}` (host) · `{t:"start"}` (host) · `{t:"intent",intent}` · `{t:"leave"}`
- **S→C:** `{t:"joined",room,slot,count,difficulty,host,started}` · `{t:"lobby",...}` · `{t:"snapshot",seq,s}` · `{t:"ended",result}` · `{t:"error",msg}` · `{t:"peer",left}`

Edge inputs (interact/drop/confirm/menu) fire once: the server clears them after
applying, so a single press isn't repeated across ticks.

## Deploy (portable)

It's a plain Node + `ws` process, so any host that runs a long-lived Node
service works (Fly.io, Render, Railway, a VM…). Expose the port (default 8787)
over `wss://` behind TLS and set the client's `?server=` (or bake a default).
A single small instance handles many rooms. The room logic is host-agnostic, so
it can later be ported to e.g. Cloudflare Workers + Durable Objects without
touching the simulation.

```bash
PORT=8787 node server/server.mjs
```

## Test

```bash
npm run test:net        # boots server + 2 headless clients, asserts sync/drop-in
```
