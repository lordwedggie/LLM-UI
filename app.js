/* LLM-UI app.js — plain JS, no deps.
   State → render: all DOM writes go through render(state).
   See AGENTS.md for the server contract and design-system rules. */

"use strict";

const API_BASE = "http://192.168.3.165:8080";
const POLL_MS = 3000;

const state = {
  serverOk: null,       // null = unknown, true/false
  lastError: null,
  models: [],           // [{id, name, status}]
  activeModel: null,    // id of loaded model
  lastPollAt: null,
  busy: false,          // chat request in flight
};

/* ---------- fetch helpers ---------- */

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function poll() {
  try {
    const [models, health] = await Promise.all([
      fetchJson(`${API_BASE}/v1/models`),
      fetchJson(`${API_BASE}/health`),
    ]);
    state.serverOk = true;
    state.lastError = null;
    state.models = (models.data || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      status: (m.status && m.status.value) || "unloaded",
    }));
    state.activeModel = state.models.find((m) => m.status === "loaded")?.id || null;
    state.lastPollAt = new Date();
  } catch (err) {
    state.serverOk = false;
    state.lastError = err.message;
  }
  render(state);
}

/* ---------- chat ---------- */

async function sendPrompt() {
  const input = document.getElementById("prompt-input");
  const text = input.value.trim();
  if (!text || state.busy) return;
  state.busy = true;
  const target = state.activeModel || state.models[0]?.id;
  const responseEl = document.getElementById("response");
  responseEl.textContent = `sending to "${target}"… (cold load may take minutes)`;
  render(state);
  try {
    const data = await fetchJson(`${API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: target,
        messages: [{ role: "user", content: text }],
        max_tokens: 1024,
      }),
    });
    responseEl.textContent =
      data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
  } catch (err) {
    responseEl.textContent = `ERROR: ${err.message}`;
  } finally {
    state.busy = false;
    render(state);
  }
}

/* ---------- render ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStateAttr(id, attr, value) {
  document.getElementById(id).setAttribute(attr, value);
}

function render(s) {
  // header status dot + pill
  const dot = document.getElementById("server-dot");
  dot.dataset.state = s.serverOk === null ? "unknown" : s.serverOk ? "ok" : "error";

  const pill = document.getElementById("active-model-pill");
  pill.textContent = s.activeModel || (s.serverOk ? "no model loaded" : "server down");
  pill.dataset.state = s.serverOk === null ? "unknown" : s.serverOk ? "ok" : "error";

  document.getElementById("server-url").textContent = API_BASE;

  // metric cards
  setMetric("metric-server", s.serverOk === null ? "—" : s.serverOk ? "OK" : "DOWN",
    s.serverOk === null ? "unknown" : s.serverOk ? "ok" : "error",
    s.lastPollAt ? `last poll ${s.lastPollAt.toLocaleTimeString()}` : (s.lastError || "not checked"));
  setMetric("metric-model", s.activeModel || "—",
    s.activeModel ? "ok" : "unknown",
    s.activeModel ? "loaded" : "none loaded");
  setMetric("metric-status", s.activeModel ? "ready" : "idle",
    s.activeModel ? "ok" : "unknown", "llama-swap /health");

  // model grid
  const grid = document.getElementById("model-grid");
  grid.replaceChildren();
  if (!s.models.length) {
    grid.appendChild(el("div", "model-card", s.serverOk === false ? `unreachable: ${s.lastError}` : "no models"));
  }
  for (const m of s.models) {
    const card = el("div", "model-card");
    card.appendChild(el("div", "model-card__name", m.id));
    card.appendChild(el("div", "model-card__desc", m.name));
    const st = el("div", "model-card__status", m.status);
    st.dataset.state = m.status === "loaded" ? "ok" : m.status === "loading" ? "loading" : "unknown";
    card.appendChild(st);
    grid.appendChild(card);
  }

  // chat controls
  document.getElementById("send-btn").disabled = s.busy || !s.serverOk;
  document.getElementById("chat-hint").textContent = s.busy
    ? "request in flight…"
    : s.activeModel
      ? `target: ${s.activeModel}`
      : "no model loaded — sending will trigger a swap";
}

function setMetric(id, value, stateName, sub) {
  const v = document.getElementById(id);
  v.textContent = value;
  v.dataset.state = stateName;
  document.getElementById(id + "-sub").textContent = sub;
}

/* ---------- init ---------- */

document.getElementById("send-btn").addEventListener("click", sendPrompt);

poll();
setInterval(poll, POLL_MS);
render(state);
