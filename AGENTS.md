# AGENTS.md — LLM-UI

## What this project is

Browser dashboard for the X2 local LLM server. The server is **llama-swap**
running on `192.168.3.165:8080` (X2), exposing an OpenAI-compatible API:
`/v1/models`, `/v1/chat/completions`, `/health`. Models are GGUF files served
by llama-server children spawned by llama-swap (one exclusive model at a time).

## Design system (MANDATORY)

This project MUST follow the shared design system and dashboard guidelines:

- `D:\_Agents\Design\UI_DESIGN_SYSTEM.md` — palette, typography, spacing, motion.
- `D:\_Agents\Design\DASHBOARDS.md` — status-first layout, metric cards, log panels, color rules.

Load both files before writing any UI code. Key rules:

- Dark "local AI lab cockpit" theme, no AI-purple defaults, no glassmorphism.
- Status clarity before decoration. Current state first, metrics second, evidence third.
- Colors: green = healthy/live, amber = stale/waiting/warning, red = error/stopped, cyan = neutral accent.
- Monospace for logs and machine data (`Cascadia Mono` / `JetBrains Mono` / `Consolas`).
- Cards 14–18px radius, buttons/pills 999px, 12/16/24px rhythm.

## Stack decision (do not add a build step without asking)

Plain HTML/CSS/JS, one page, no framework. Rationale: the dashboard is small,
state is "poll server → render cards", and a zero-dependency static page runs
forever with no maintenance. Keep it that way. If the UI genuinely outgrows
this (multiple complex views, heavy state), that is a conversation with the
user, not a unilateral upgrade.

## Server contract

- Base URL: `http://192.168.3.165:8080` (X2 llama-swap).
- `GET /v1/models` → `{ "data": [ { "id": "...", "status": { "value": "loaded"|"unloaded"|"loading" } } ] }`
- `GET /health` → `{ "status": "ok" }` (llama-swap itself is always OK when up).
- `POST /v1/chat/completions` → OpenAI format. Model id is the llama-swap member id
  (e.g. `heretic-27b`, `qwen36-35b-iq3`, `gemma4-31b`). Sending a request for an
  unloaded model triggers llama-swap to swap to it (cold load can take minutes —
  reflect that in the UI).
- The active backend listens on `127.0.0.1:1000X` inside X2 — NOT reachable
  from browsers; always go through port 8080.

## CORS note

Browsers block cross-origin `fetch()` from `file://` pages and from other
origins. During dev, serve this folder over HTTP (`python -m http.server`)
and ensure llama-swap allows the origin. If CORS is not configured on the
server yet, the app should fail gracefully with a visible "server unreachable
(CORS)" state instead of a silent error.

Verified 2026-08-18 against llama-swap v250: `/v1/models`, `/v1/chat/completions`
and `/upstream/<model>/` already send CORS headers, but `/health`, `/metrics`
and `/logs` do not. The dashboard shows a banner for those blocked endpoints;
the exact fix is documented in README.md → "CORS status". The included
`server.py` proxies those three endpoints locally so the dashboard works fully
without patching llama-swap.

## File layout

- `index.html` — page shell: status header, metric cards, model grid, chat box, log panel.
- `styles.css` — all styling, from the shared design system.
- `app.js` — state + polling + fetch + rendering. Keep render functions pure:
  `render(state)` replaces the DOM from state; no scattered DOM writes.

## Development loop

- Edit → refresh browser (no build).
- Keep the server reachable: `curl http://192.168.3.165:8080/health` should say OK.
- Verify against the real API before assuming behavior (llama-swap responses are the source of truth).

## Git

- Repo: `lordwedggie/LLM-UI` (public).
- HTTPS push is broken on this machine (schannel error) — use SSH remote
  (`git@github.com:lordwedggie/LLM-UI.git`) or `gh`.
