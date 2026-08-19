# LLM-UI

A lightweight browser dashboard for the X2 local LLM server (llama-swap on
`192.168.3.165:8080`, OpenAI-compatible API).

Plain HTML/CSS/JS on purpose: no build step, no dependencies, runs forever.

## Quick start

```bash
# from this directory — recommended (adds a same-origin proxy for /health, /metrics, /logs)
python server.py
# open http://127.0.0.1:8000

# alternative: plain static server (models/chat/load still work; GPU cards + log show CORS-blocked)
python -m http.server 8000
```

The dashboard talks to the llama-swap API. If you open it from a browser on
another machine (or use `file://`), the server must allow cross-origin
requests. See [AGENTS.md](AGENTS.md) → "Server" for the CORS note.

## What it does

- Shows every model llama-swap knows about, with load state (loaded / unloaded / loading)
  and an **estimated VRAM requirement** per model (weights + KV, grounded in the actual
  GGUF sizes on X2; models over 64 GB are flagged red).
- Model grid is ordered: Qwen3.8 first, then Qwen3.6 uncensored, then the rest.
- One-click **Load** buttons per model — they hit llama-swap's `/upstream/<model>/`
  preload path, the same mechanism llama-swap's own web UI uses.
- Vision-capable models (Gemma4-31B, Qwen3.8-27B Q6) show a **Vision toggle** on their
  card: on loads the `-vision` variant (with `--mmproj`), off loads the plain variant.
- Live health + GPU metric cards (VRAM, GPU util, temp, power) parsed from `/metrics`.
- A **streaming** chat box (SSE) that sends prompts to the loaded model via
  OpenAI-compatible `/v1/chat/completions`, with a non-stream fallback for old browsers.
- Log panel that shows only actual prompt traffic (`POST /v1/chat/completions`),
  filtering out the dashboard's own health/metrics polling noise.

## CORS status (verified 2026-08-18)

- ✅ `/v1/models` (GET) — works from the browser (llama-swap echoes the Origin).
- ✅ `/v1/chat/completions` (POST, streaming) — works (preflight + response headers OK).
- ✅ `/upstream/<model>/` (GET) — works; llama.cpp adds the CORS header.
- ❌ `/health`, `/metrics`, `/logs` — **blocked**: llama-swap v250 only adds
  `Access-Control-Allow-Origin` to OPTIONS preflight responses, not to normal GETs.

The dashboard degrades gracefully: server/model/chat keep working, the GPU metric
cards and log panel show a visible "CORS blocked" state, and a banner names the
blocked endpoints.

**Local workaround (already in the repo):** `python server.py` serves the page and
proxies `/health`, `/metrics`, `/logs` through `http://127.0.0.1:8000/proxy/...`, so
the GPU cards and log panel go live without touching llama-swap. The dashboard
auto-detects the proxy via `GET /__proxy`.

**Exact server fix:** there is no llama-swap config flag for this. Patch
`internal/server/auth.go` → `CreateCORSMiddleware()` so non-OPTIONS responses also
set `Access-Control-Allow-Origin` (e.g. echo the request `Origin` when present) —
or put a tiny reverse proxy in front of `:8080` that adds the header. Then rebuild
and restart llama-swap (config is only read at startup).

## Model notes (X2 ROCm / gfx1151)

- **Qwen3.8 vision** (`qwen38-q6-vision`) requires `--ubatch-size 2048` in the
  llama-swap `cmd`. Without it, image requests hang and return empty — the Qwen3-VL
  vision encoder needs `n_ubatch >= n_tokens` for its non-causal attention
  (upstream llama.cpp issue [#18809](https://github.com/ggml-org/llama.cpp/issues/18809),
  fixed in llama.cpp b7721+). **Known limitation on this build:** image + tool
  calling together (DSH agent mode) still returns empty/garbage; use
  `gemma4-31b-vision` for agent vision tasks until llama.cpp is upgraded.
- **Gemma4 vision/text** (`gemma4-31b` / `gemma4-31b-vision`) needs
  `--chat-template-file google-gemma-4-31B-it.jinja` and 64K ctx + q8 KV.
  Without the template override it floods `<unused24>` tokens on system prompts.

## Layout

```
AGENTS.md        project + design-system conventions (READ FIRST)
index.html       single page shell
styles.css       design-system styles (dark cockpit theme)
app.js           state, polling, fetch, rendering
server.py        optional zero-dep dev server: static files + /health /metrics /logs proxy
```

## Roadmap (see AGENTS.md for details)

- [x] Scaffold: model list + health + chat box
- [x] VRAM/GPU metric cards (live via `server.py` proxy; direct browser use still needs llama-swap CORS patch)
- [x] Model swap buttons (Load via `/upstream/<model>/`)
- [x] Streaming chat (SSE)
- [x] Per-model estimated VRAM requirements
