# Photo Arcade 🎞️✨

A playful, neon online photobooth. Take a photo strip or a single shot **solo**,
or make **one strip together** with someone on another laptop — live, with a
synced countdown, as if you were in the same booth.

Everything happens in the browser. In Together mode your photos travel **directly
between the two browsers, end-to-end encrypted, and are never stored on any
server**. No accounts, no backend, no tracking.

- **Solo** — photo strip (3–6 frames) or single shot, with 6 filters, download as PNG.
- **Together (couple mode)** — one person creates a room, shares the code/link, the
  other joins. You see each other's live camera, a shared 3-2-1 countdown fires for
  both, and your frames combine into one strip (**side by side** or **alternating**).

## Tech

- **Vite + TypeScript**, no UI framework — a small hand-rolled app.
- **Capture**: `getUserMedia` + `<canvas>`. Filters are baked into the saved image
  via **pixel manipulation** (not `ctx.filter`, which is disabled-by-default in
  Safari), so downloads look identical on every browser.
- **Together mode**: [Trystero](https://github.com/dmotz/trystero) — serverless
  WebRTC peer-to-peer. Peers find each other over the public Nostr signaling network
  (keyless), then exchange video + photo frames directly, end-to-end encrypted.
- **Hosting**: fully static — deploys to GitHub Pages.

## Run it locally

```bash
npm install
npm run dev        # → http://localhost:5180
```

Then open the URL in a real browser and allow camera access (localhost counts as a
secure context, so the camera works without HTTPS).

**Try Together mode on one machine**: open the app in two browser windows (or two
different browsers). Create a room in one, copy the code, join with it in the other.

Handy dev query params:
- `?selftest` — drives the booth with a synthetic video pattern (no webcam needed).
- `?duosim` — Together mode with a simulated partner, so the couple-strip layout is
  testable on a single machine with no second device.

## Build

```bash
npm run build      # type-checks, then outputs static files to dist/
npm run preview    # serve the production build locally
```

## Deploy (GitHub Pages)

Pushing to `main` builds and publishes automatically via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). One-time setup:

1. Create the repo and push.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. The next push publishes to `https://<user>.github.io/<repo>/`.

The Vite `base` is `./` (relative), so it works at any repo sub-path with no config.

## Reliability note (Together mode)

Pure peer-to-peer connects for the large majority of network pairs. A small share of
strict corporate/campus networks (symmetric NAT) can't establish a direct connection
without a **TURN relay**. If you ever hit "can't connect," add a free TURN server:

```ts
// src/collab.ts → joinRoom({ appId, password: code, turnConfig: [...] }, code)
turnConfig: [{ urls: 'turn:YOUR_TURN_HOST:3478', username: '…', credential: '…' }]
```

Free TURN credentials are available from [Open Relay](https://www.metered.ca/tools/openrelay/)
or [ExpressTURN](https://www.expressturn.com/). Not required for most users.
