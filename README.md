# LLM-UI

A lightweight browser dashboard for the X2 local LLM server (llama-swap on
`192.168.3.165:8080`, OpenAI-compatible API).

Plain HTML/CSS/JS on purpose: no build step, no dependencies, runs forever.

## Quick start

```bash
# from this directory
python -m http.server 8000
# open http://localhost:8000
```

The dashboard talks to the llama-swap API. If you open it from a browser on
another machine (or use `file://`), the server must allow cross-origin
requests. See [AGENTS.md](AGENTS.md) → "Server" for the CORS note.

## What it does

- Shows every model llama-swap knows about, with load state (loaded / unloaded / loading).
- Live health + VRAM status for the active backend.
- A chat box that sends prompts to the loaded model (OpenAI-compatible `/v1/chat/completions`).
- Log panel that mirrors the active model's server output.

## Layout

```
AGENTS.md        project + design-system conventions (READ FIRST)
index.html       single page shell
styles.css       design-system styles (dark cockpit theme)
app.js           state, polling, fetch, rendering
```

## Roadmap (see AGENTS.md for details)

- [x] Scaffold: model list + health + chat box
- [ ] VRAM/GPU metric cards (rocm-smi via server)
- [ ] Model swap buttons (request a different model through llama-swap)
- [ ] Streaming chat (SSE)
