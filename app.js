/* LLM-UI app.js — plain JS, no deps.
   State → render: all DOM writes go through render(state).
   See AGENTS.md for the server contract and design-system rules. */

"use strict";

const API_BASE = "http://192.168.3.165:8080";
const POLL_MS = 3000;
const LOG_TAIL_LINES = 120;

const state = {
  serverOk: null,          // null = unknown, true/false
  lastError: null,
  cors: { health: false, metrics: false, logs: false },
  models: [],              // [{id, name, status}]
  activeModel: null,       // id of loaded model
  lastPollAt: null,
  pendingLoads: new Set(), // model ids with a load request in flight
  chat: {
    busy: false,
    target: null,
    response: "Response will appear here.",
    reasoning: "",
    error: null,
  },
  metrics: {
    vramUsedBytes: null,
    vramTotalBytes: null,
    gpuUtil: null,
    gpuTemp: null,
    gpuPower: null,
    error: null,
  },
  logs: { text: "", error: null },
};

/* ---------- fetch helpers ---------- */

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function isCorsFailure(err) {
  return err instanceof TypeError && /fetch/i.test(err.message || "");
}

function describeError(err, fallback) {
  if (!err) return fallback || "unknown error";
  if (isCorsFailure(err)) return "CORS blocked or network unreachable";
  return err.message || String(err);
}

/* ---------- polling ---------- */

function parseMetrics(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+(-?[\d.eE+]+)/);
    if (!m) continue;
    const value = parseFloat(m[3]);
    switch (m[1]) {
      case "llamaswap_gpu_memory_used_bytes": out.vramUsedBytes = value; break;
      case "llamaswap_gpu_memory_total_bytes": out.vramTotalBytes = value; break;
      case "llamaswap_gpu_util_percent": out.gpuUtil = value; break;
      case "llamaswap_gpu_temperature_celsius": out.gpuTemp = value; break;
      case "llamaswap_gpu_power_draw_watts": out.gpuPower = value; break;
    }
  }
  return out;
}

function tail(text, lines) {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

async function poll() {
  const [modelsR, healthR, metricsR, logsR] = await Promise.allSettled([
    fetchJson(`${API_BASE}/v1/models`),
    fetchText(`${API_BASE}/health`),
    fetchText(`${API_BASE}/metrics`),
    fetchText(`${API_BASE}/logs`),
  ]);

  const serverReachable = modelsR.status === "fulfilled";

  if (serverReachable) {
    const data = modelsR.value.data || [];
    state.models = data.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      status: (m.status && m.status.value) || "unloaded",
    }));
    state.activeModel = state.models.find((m) => m.status === "loaded")?.id || null;
    state.serverOk = true;
    state.lastError = null;
    state.lastPollAt = new Date();
  } else {
    state.serverOk = false;
    state.lastError = describeError(modelsR.reason, "server unreachable");
    state.cors.health = false;
    state.cors.metrics = false;
    state.cors.logs = false;
  }

  if (serverReachable) {
    state.cors.health = healthR.status !== "fulfilled" && isCorsFailure(healthR.reason);

    if (metricsR.status === "fulfilled") {
      Object.assign(state.metrics, parseMetrics(metricsR.value), { error: null });
      state.cors.metrics = false;
    } else {
      state.cors.metrics = isCorsFailure(metricsR.reason);
      state.metrics.error = describeError(metricsR.reason, "metrics unavailable");
    }

    if (logsR.status === "fulfilled") {
      state.logs = { text: tail(logsR.value, LOG_TAIL_LINES), error: null };
      state.cors.logs = false;
    } else {
      state.cors.logs = isCorsFailure(logsR.reason);
      state.logs.error = describeError(logsR.reason, "logs unavailable");
    }
  }

  render(state);
}

/* ---------- model load ---------- */

async function loadModel(id) {
  if (state.pendingLoads.has(id) || state.chat.busy || !state.serverOk) return;
  state.pendingLoads.add(id);
  state.lastError = null;
  render(state);
  try {
    const res = await fetch(`${API_BASE}/upstream/${encodeURIComponent(id)}/?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    state.lastError = `load ${id}: ${describeError(err, "request failed")}`;
  } finally {
    state.pendingLoads.delete(id);
    render(state);
  }
}

function handleGridClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.model;
  if (btn.dataset.action === "load") void loadModel(id);
}

/* ---------- chat ---------- */

async function sendPrompt() {
  const input = document.getElementById("prompt-input");
  const text = input.value.trim();
  if (!text || state.chat.busy || !state.serverOk) return;

  const target = state.activeModel || state.models[0]?.id;
  if (!target) {
    state.chat = { ...state.chat, busy: false, response: "ERROR: no models available", error: "no models" };
    render(state);
    return;
  }

  state.chat = { busy: true, target, response: "", reasoning: "", error: null };
  render(state);

  try {
    const res = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target,
        messages: [{ role: "user", content: text }],
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
    }

    if (!res.body) {
      // Very old browsers without ReadableStream support: fall back to JSON.
      const data = await res.json();
      state.chat.response = data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
    } else {
      await readStream(res.body);
    }
  } catch (err) {
    state.chat.error = describeError(err, "request failed");
    state.chat.response = `ERROR: ${state.chat.error}`;
  } finally {
    state.chat.busy = false;
    render(state);
  }
}

async function readStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      state.chat.reasoning += delta.reasoning_content;
      render(state);
    }
    if (delta?.content) {
      state.chat.response += delta.content;
      render(state);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);
}

/* ---------- render ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setMetric(id, value, stateName, sub) {
  const v = document.getElementById(id);
  v.textContent = value;
  v.dataset.state = stateName;
  document.getElementById(id + "-sub").textContent = sub;
}

function setStateAttr(id, attr, value) {
  document.getElementById(id).setAttribute(attr, value);
}

function render(s) {
  renderHeader(s);
  renderMetrics(s);
  renderModels(s);
  renderChat(s);
  renderLogs(s);
  renderBanner(s);
}

function renderHeader(s) {
  let dotState = "unknown";
  let pillText = "no model";
  let pillState = "unknown";

  if (s.serverOk === false) {
    dotState = "error";
    pillText = "server down";
    pillState = "error";
  } else if (s.serverOk === true) {
    if (s.chat.busy) {
      dotState = "loading";
      pillText = `loading ${s.chat.target}`;
      pillState = "loading";
    } else if (s.pendingLoads.size > 0) {
      dotState = "loading";
      pillText = `loading ${[...s.pendingLoads][0]}`;
      pillState = "loading";
    } else if (s.activeModel) {
      dotState = "ok";
      pillText = s.activeModel;
      pillState = "ok";
    } else {
      dotState = "ok";
      pillText = "no model loaded";
      pillState = "unknown";
    }
  }

  setStateAttr("server-dot", "data-state", dotState);
  setStateAttr("active-model-pill", "data-state", pillState);
  document.getElementById("active-model-pill").textContent = pillText;
  document.getElementById("server-url").textContent = API_BASE;
}

function renderMetrics(s) {
  let serverSub = s.lastPollAt
    ? `last poll ${s.lastPollAt.toLocaleTimeString()}`
    : s.lastError || "not checked";
  if (s.serverOk && s.cors.health) serverSub += " · /health CORS-blocked";

  setMetric("metric-server",
    s.serverOk === null ? "—" : s.serverOk ? "OK" : "DOWN",
    s.serverOk === null ? "unknown" : s.serverOk ? "ok" : "error",
    serverSub);

  setMetric("metric-model",
    s.activeModel || "—",
    s.activeModel ? "ok" : "unknown",
    s.activeModel ? "loaded" : "none loaded");

  const statusValue = s.chat.busy || s.pendingLoads.size > 0 ? "loading"
    : s.activeModel ? "ready" : "idle";
  const statusState = s.chat.busy || s.pendingLoads.size > 0 ? "loading"
    : s.activeModel ? "ok" : "unknown";
  const statusSub = s.chat.busy
    ? `target ${s.chat.target}`
    : s.pendingLoads.size > 0
      ? `swapping to ${[...s.pendingLoads][0]}`
      : s.activeModel ? "llama-swap /v1/models" : "no model loaded";
  setMetric("metric-status", statusValue, statusState, statusSub);

  renderGpuMetrics(s);
}

function renderGpuMetrics(s) {
  const m = s.metrics;
  const corsBlocked = s.cors.metrics;
  const unavailableSub = corsBlocked
    ? "CORS blocked — patch llama-swap"
    : m.error || "waiting for /metrics";

  // VRAM
  if (m.vramUsedBytes != null && m.vramTotalBytes != null) {
    const usedPct = (m.vramUsedBytes / m.vramTotalBytes) * 100;
    const stateName = usedPct >= 90 ? "error" : usedPct >= 75 ? "loading" : "ok";
    setMetric("metric-vram",
      `${(m.vramUsedBytes / 1024 ** 3).toFixed(1)} / ${(m.vramTotalBytes / 1024 ** 3).toFixed(0)} GB`,
      stateName,
      `${usedPct.toFixed(0)}% used · rocm-smi via /metrics`);
  } else {
    setMetric("metric-vram", "—", "unknown", unavailableSub);
  }

  // GPU util
  if (m.gpuUtil != null) {
    setMetric("metric-gpu", `${m.gpuUtil.toFixed(0)}%`, "ok", "GPU util · /metrics");
  } else {
    setMetric("metric-gpu", "—", "unknown", unavailableSub);
  }

  // Temp
  if (m.gpuTemp != null) {
    const stateName = m.gpuTemp >= 90 ? "error" : m.gpuTemp >= 80 ? "loading" : "ok";
    setMetric("metric-temp", `${m.gpuTemp.toFixed(0)}°C`, stateName, "GPU temp · /metrics");
  } else {
    setMetric("metric-temp", "—", "unknown", unavailableSub);
  }

  // Power
  if (m.gpuPower != null) {
    setMetric("metric-power", `${m.gpuPower.toFixed(0)} W`, "ok", "GPU power draw · /metrics");
  } else {
    setMetric("metric-power", "—", "unknown", unavailableSub);
  }
}

function renderModels(s) {
  const grid = document.getElementById("model-grid");
  grid.replaceChildren();

  if (!s.models.length) {
    grid.appendChild(el("div", "model-card",
      s.serverOk === false ? `unreachable: ${s.lastError}` : "no models"));
    return;
  }

  for (const m of s.models) {
    const card = el("div", "model-card");
    card.dataset.state = m.status === "loaded" ? "ok"
      : m.status === "loading" ? "loading" : "unknown";

    card.appendChild(el("div", "model-card__name", m.id));
    card.appendChild(el("div", "model-card__desc", m.name));

    const st = el("div", "model-card__status", m.status === "loaded" ? "loaded" : m.status);
    st.dataset.state = m.status === "loaded" ? "ok"
      : m.status === "loading" ? "loading" : "unknown";
    card.appendChild(st);

    const actions = el("div", "model-card__actions");
    if (m.id === s.activeModel) {
      actions.appendChild(el("span", "pill model-card__active", "Active"));
    } else {
      const isPending = s.pendingLoads.has(m.id) || m.status === "loading";
      const btn = el("button", "btn btn-sm" + (isPending ? " is-loading" : ""),
        isPending ? "Loading…" : "Load");
      btn.type = "button";
      btn.dataset.action = "load";
      btn.dataset.model = m.id;
      btn.disabled = isPending || s.chat.busy || !s.serverOk;
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  }
}

function renderChat(s) {
  const sendBtn = document.getElementById("send-btn");
  sendBtn.disabled = s.chat.busy || !s.serverOk || s.models.length === 0;

  const hint = document.getElementById("chat-hint");
  if (s.chat.busy) {
    hint.textContent = `request in flight — target ${s.chat.target}`;
  } else if (s.activeModel) {
    hint.textContent = `target: ${s.activeModel} (streaming)`;
  } else if (s.models.length) {
    hint.textContent = "no model loaded — send will trigger a swap";
  } else {
    hint.textContent = s.serverOk === false ? "server unreachable" : "no models";
  }

  const responseEl = document.getElementById("response");
  let display = s.chat.response;
  if (!display && s.chat.busy) {
    display = "waiting for first token — cold load may take minutes…";
  }
  if (s.chat.reasoning) {
    display = `[thinking]\n${s.chat.reasoning}\n[/thinking]\n\n${display}`;
  }
  responseEl.textContent = display;
  responseEl.dataset.state = s.chat.busy ? "busy" : s.chat.error ? "error" : "idle";
}

function renderLogs(s) {
  const pre = document.getElementById("log-panel");
  if (s.logs.text) {
    pre.textContent = s.logs.text;
  } else if (s.cors.logs) {
    pre.textContent = "CORS blocked — GET /logs needs Access-Control-Allow-Origin on non-OPTIONS responses (patch llama-swap or proxy).";
  } else if (s.logs.error) {
    pre.textContent = `logs unavailable: ${s.logs.error}`;
  } else {
    pre.textContent = "—";
  }
}

function renderBanner(s) {
  const banner = document.getElementById("cors-banner");
  if (!banner) return;
  const notices = [];
  const blocked = [];
  if (s.cors.health) blocked.push("/health");
  if (s.cors.metrics) blocked.push("/metrics");
  if (s.cors.logs) blocked.push("/logs");
  if (s.serverOk && blocked.length) {
    notices.push(
      `CORS: ${blocked.join(", ")} blocked by llama-swap — add Access-Control-Allow-Origin to ` +
      `non-OPTIONS responses (patch CreateCORSMiddleware in internal/server/auth.go) or put a proxy in front.`);
  }
  if (s.serverOk && s.lastError) notices.push(`error: ${s.lastError}`);
  if (notices.length) {
    banner.hidden = false;
    banner.textContent = notices.join(" · ");
  } else {
    banner.hidden = true;
  }
}

/* ---------- init ---------- */

document.getElementById("send-btn").addEventListener("click", sendPrompt);
document.getElementById("model-grid").addEventListener("click", handleGridClick);

const promptInput = document.getElementById("prompt-input");
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void sendPrompt();
  }
});

poll();
setInterval(poll, POLL_MS);
render(state);
