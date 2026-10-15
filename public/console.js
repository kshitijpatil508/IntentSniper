import { subscribe } from "./stream.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  config: null,
  jev: null,
  decisions: [],
  selected: null,
  showRaw: false,
};

const ROUTE_META = {
  auto: { label: "Auto-route", pill: "pill-good" },
  review: { label: "Review", pill: "pill-warn" },
  quarantine: { label: "Quarantine", pill: "pill-bad" },
  nurture: { label: "Nurture", pill: "pill-neutral" },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

async function api(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

const two = (value) => (Number(value) || 0).toFixed(2);
const three = (value) => (Number(value) || 0).toFixed(3);
const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
const ms = (value) => `${Math.round(Number(value) || 0)}ms`;
const money = (value) => `$${(Number(value) || 0).toFixed(6)}`;

function shortModel(model) {
  if (!model) return "—";
  if (model.startsWith("typesafe/jev")) {
    const match = model.match(/(\d+\.\d+)/);
    return `jev ${match ? match[1] : ""}`.trim();
  }
  return model;
}

function toDecision(lead) {
  return {
    id: lead.id,
    at: lead.ingestedAt,
    source: lead.source,
    community: lead.community,
    author: lead.author,
    title: lead.title,
    url: lead.url,
    provider: lead.score?.provider ?? null,
    model: lead.score?.model ?? null,
    latencyMs: lead.score?.latencyMs ?? null,
    cost: lead.score?.usage?.cost ?? null,
    confidence: lead.score?.overallConfidence ?? null,
    answers: lead.score?.answers ?? null,
    route: lead.routing?.route ?? null,
    priority: lead.routing?.priority ?? null,
    fallbackReason: lead.score?.fallbackReason ?? null,
  };
}

function renderScorecard() {
  const box = $("#jev-scorecard");
  box.textContent = "";
  const stats = state.jev?.stats;
  const provider = state.jev?.provider;
  if (!stats) return;

  const items = [
    { label: "Model", value: shortModel(provider?.model), small: true, sub: provider?.baseUrl || "" },
    { label: "Decisions", value: stats.decisions },
    { label: "Median confidence", value: two(stats.medianConfidence) },
    { label: "p50 latency", value: ms(stats.p50LatencyMs) },
    { label: "p95 latency", value: ms(stats.p95LatencyMs) },
    { label: "Avg latency", value: ms(stats.avgLatencyMs) },
    { label: "Spend so far", value: money(stats.totalCostUsd), small: true },
    { label: "Tokens in / out", value: `${stats.inputTokens} / ${stats.outputTokens}`, small: true },
    { label: "Quarantine rate", value: pct(stats.quarantineRate) },
    { label: "Fallbacks", value: stats.fallbacks },
  ];

  for (const item of items) {
    const card = el("div", "stat");
    card.append(el("span", "stat-label", item.label));
    card.append(el("span", `stat-value${item.small ? " stat-value-sm" : ""}`, item.value));
    if (item.sub) card.append(el("span", "stat-sub", item.sub));
    box.append(card);
  }
}

function renderLog() {
  const box = $("#jev-log");
  box.textContent = "";
  $("#jev-log-count").textContent = state.decisions.length ? `${state.decisions.length} decisions` : "";

  if (!state.decisions.length) {
    box.append(el("p", "text-slate-500 text-sm", "Waiting for Jev's first decision…"));
    return;
  }

  for (const decision of state.decisions.slice(0, 100)) {
    const row = el("button", `log-row${state.selected?.id === decision.id ? " selected" : ""}`);
    row.type = "button";
    row.addEventListener("click", () => selectLead(decision.id));

    const top = el("div", "log-top");
    top.append(el("span", "log-time", new Date(decision.at).toLocaleTimeString()));
    top.append(el("span", "log-model", shortModel(decision.model)));
    top.append(
      el("span", `pill ${ROUTE_META[decision.route]?.pill || "pill-neutral"}`, ROUTE_META[decision.route]?.label || decision.route)
    );
    row.append(top);

    row.append(el("div", "log-title", decision.title || "(untitled)"));

    const answers = decision.answers || {};
    const chips = el("div", "log-chips");
    chips.append(el("span", "chip", `intent ${two(answers.intent?.probability)}`));
    chips.append(el("span", "chip", `inj ${two(answers.injection?.probability)}`));
    chips.append(el("span", "chip", `urg ${answers.urgency?.value ?? "-"}`));
    chips.append(el("span", "chip chip-industry", answers.industry?.value || "?"));
    chips.append(el("span", "chip chip-pain", answers.painPoint?.value || "?"));
    row.append(chips);

    const meta = el("div", "log-meta");
    meta.append(el("span", null, ms(decision.latencyMs)));
    if (decision.cost != null) meta.append(el("span", null, money(decision.cost)));
    if (decision.fallbackReason) meta.append(el("span", "text-amber-400", "fallback"));
    row.append(meta);

    box.append(row);
  }
}

function provenance(lead) {
  const score = lead.score || {};
  const row = el("div", "prov");
  const cell = (label, value) => {
    const box = el("div", "prov-cell");
    box.append(el("span", "prov-label", label), el("span", "prov-value", value));
    row.append(box);
  };
  cell("model", score.model || "—");
  cell("provider", score.provider || "—");
  cell("latency", ms(score.latencyMs));
  cell("overall confidence", two(score.overallConfidence));
  cell("tokens", score.usage ? `${score.usage.input_tokens} in / ${score.usage.output_tokens} out` : "—");
  cell("cost", score.usage ? money(score.usage.cost) : "—");
  if (score.fallbackReason) cell("fallback", score.fallbackReason);
  return row;
}

function noulCard(criterion, raw, canonical) {
  const probability = Number(raw?.noul ?? canonical?.probability ?? 0);
  const wrap = el("div", "gauge-wrap");

  const gauge = el("div", `gauge ${probability >= 0.5 ? "pos" : "neg"}`);
  const fill = el("div", "gauge-fill");
  fill.style.width = `${Math.round(probability * 100)}%`;
  gauge.append(fill);
  const mark = el("div", "gauge-mark");
  mark.style.left = `${Math.round(probability * 100)}%`;
  gauge.append(mark);
  wrap.append(gauge);

  const verdict = el("div", "gauge-verdict");
  verdict.append(document.createTextNode("Jev says "));
  verdict.append(el("b", null, probability >= 0.5 ? "true" : "false"));
  verdict.append(document.createTextNode(` · p = ${three(probability)}`));
  wrap.append(verdict);

  for (const key of ["false", "true"]) {
    const active = (probability >= 0.5) === (key === "true");
    const row = el("div", `noul-opt${active ? " active" : ""}`);
    row.append(el("span", "noul-key", key));
    row.append(el("span", "noul-text", criterion.criteria?.[key] || ""));
    wrap.append(row);
  }
  return wrap;
}

function choiceCard(criterion, raw, canonical) {
  const probabilities = raw?.probabilities || {};
  const keys = Object.keys(probabilities).length ? Object.keys(probabilities) : criterion.options || [];
  const picked = raw?.choice ?? canonical?.value;
  const sorted = [...keys].sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0));

  const wrap = el("div");
  const rows = el("div", "choice-rows");
  for (const option of sorted) {
    const probability = probabilities[option] ?? (option === picked ? 1 : 0);
    const row = el("div", `choice-row${option === picked ? " picked" : ""}`);
    row.append(el("span", "choice-label", option));
    const bar = el("div", "choice-bar");
    const fill = el("div", "choice-fill");
    fill.style.width = `${Math.round(probability * 100)}%`;
    bar.append(fill);
    row.append(bar);
    row.append(el("span", "choice-prob", three(probability)));
    rows.append(row);
  }
  wrap.append(rows);

  const description = criterion.criteria?.[picked];
  if (description) wrap.append(el("div", "choice-desc", `${picked} — ${description}`));
  return wrap;
}

function scoreCard(criterion, raw, canonical) {
  const probabilities = raw?.probabilities || {};
  const legend = raw?.legend;
  const labels = legend && Object.keys(legend).length ? legend : criterion.criteria || [];
  const count = Array.isArray(labels) ? labels.length : Object.keys(labels).length;
  const labelAt = (index) => (Array.isArray(labels) ? labels[index] : labels[String(index)]);

  const wrap = el("div");
  if (!Object.keys(probabilities).length) {
    wrap.append(el("p", "text-slate-500 text-sm", "No distribution available for this scorer."));
    return wrap;
  }

  const chosen = canonical?.value ?? null;
  const chosenIndex = chosen != null ? chosen - 1 : null;

  const histogram = el("div", "hist");
  for (let index = 0; index < count; index += 1) {
    const probability = probabilities[String(index)] ?? 0;
    const column = el("div", `hist-col${index === chosenIndex ? " picked" : ""}`);
    column.title = `${index + 1} · ${labelAt(index) ?? ""} — ${three(probability)}`;
    const barWrap = el("div", "hist-bar-wrap");
    const bar = el("div", "hist-bar");
    bar.style.height = `${Math.max(3, Math.round(probability * 100))}%`;
    barWrap.append(bar);
    column.append(barWrap);
    column.append(el("span", "hist-label", String(index + 1)));
    histogram.append(column);
  }
  wrap.append(histogram);
  wrap.append(
    el(
      "div",
      "hist-caption",
      chosen != null ? `Jev says ${chosen} · "${labelAt(chosenIndex) ?? ""}"` : "No single rung selected"
    )
  );
  return wrap;
}

function criterionCard(criterion, raw, canonical) {
  const card = el("div", "criterion");
  const head = el("div", "crit-head");
  head.append(el("span", "crit-name", criterion.label));
  head.append(el("span", "crit-kind", criterion.kind));
  head.append(el("span", "pill pill-neutral", `conf ${two(canonical?.confidence)}`));
  card.append(head);
  card.append(el("p", "crit-q", criterion.question));

  if (criterion.kind === "noul") card.append(noulCard(criterion, raw, canonical));
  else if (criterion.kind === "choice") card.append(choiceCard(criterion, raw, canonical));
  else card.append(scoreCard(criterion, raw, canonical));

  return card;
}

function gateTrace(lead) {
  const routing = state.config?.routing || {};
  const answers = lead.score?.answers || {};
  const intent = Number(answers.intent?.probability) || 0;
  const confidence = Number(answers.intent?.confidence) || 0;
  const urgency = Number(answers.urgency?.value) || 0;
  const injection = Number(answers.injection?.probability) || 0;

  const panel = el("div", "panel inset");
  panel.append(el("h4", "section-title", "Why Jev's numbers routed it here"));

  const guardFired = injection >= (routing.injectionThreshold ?? 0.5);
  const guard = el("div", `trace-row guard${guardFired ? " triggered" : ""}`);
  guard.append(el("span", "trace-mark", guardFired ? "⛔" : "·"));
  guard.append(
    el(
      "span",
      "trace-text",
      guardFired
        ? `quarantine guard fired — injection ${three(injection)} ≥ ${routing.injectionThreshold}`
        : `quarantine guard clear — injection ${three(injection)} < ${routing.injectionThreshold}`
    )
  );
  panel.append(guard);

  const bars = [
    ["intent", intent, routing.autoIntent, "auto bar"],
    ["intent confidence", confidence, routing.autoConfidence, "auto bar"],
    ["urgency", urgency, routing.autoUrgency, "auto bar"],
    ["intent", intent, routing.reviewIntent, "review bar"],
  ];
  for (const [name, value, threshold, note] of bars) {
    const pass = value >= threshold;
    const row = el("div", `trace-row ${pass ? "pass" : "fail"}`);
    row.append(el("span", "trace-mark", pass ? "✓" : "✗"));
    row.append(
      el("span", "trace-text", `${name} ${number(value)} ≥ ${threshold} (${note})`)
    );
    panel.append(row);
  }

  const outcome = el("div", `trace-outcome route-${lead.routing?.route}`);
  outcome.append(
    el("span", null, `→ ${ROUTE_META[lead.routing?.route]?.label || lead.routing?.route}`),
    el("span", null, `priority ${lead.routing?.priority ?? 0}`)
  );
  panel.append(outcome);
  return panel;
}

function number(value) {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function renderInspector() {
  const box = $("#jev-inspector");
  box.textContent = "";
  const lead = state.selected;
  if (!lead) {
    box.append(el("p", "text-slate-500 text-sm", "Pick a decision on the left to watch Jev work through it."));
    return;
  }

  box.append(el("h3", "ins-title", lead.title || "(untitled)"));

  const meta = el("div", "ins-meta");
  meta.append(
    el("span", null, lead.source),
    el("span", null, lead.community || "unknown"),
    el("span", null, `@${lead.author || "unknown"}`)
  );
  if (lead.url) {
    const link = el("a", "text-indigo-400 underline", "source link");
    link.href = lead.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    meta.append(link);
  }
  box.append(meta);

  box.append(provenance(lead));

  const stateBlock = el("div", "panel inset");
  stateBlock.append(el("h4", "section-title", "State Jev evaluated"));
  stateBlock.append(el("p", "ins-state", [lead.title, lead.body].filter(Boolean).join("\n\n") || "(empty)"));
  box.append(stateBlock);

  const questions = el("div", "space-y-3");
  questions.append(el("h4", "section-title", "Jev's answers, criterion by criterion"));
  const criteria = state.config?.criteria || [];
  for (const criterion of criteria) {
    questions.append(
      criterionCard(
        criterion,
        lead.score?.raw?.[criterion.id] || null,
        lead.score?.answers?.[criterion.id] || null
      )
    );
  }
  box.append(questions);

  box.append(gateTrace(lead));

  const toggle = el("button", "btn", state.showRaw ? "Hide raw response" : "Show raw Jev response");
  toggle.addEventListener("click", () => {
    state.showRaw = !state.showRaw;
    renderInspector();
  });
  box.append(toggle);

  if (state.showRaw) {
    box.append(
      el(
        "pre",
        "raw-json",
        JSON.stringify(lead.score?.raw ?? { note: "no raw payload — this lead used the local fallback scorer" }, null, 2)
      )
    );
  }
}

async function selectLead(id) {
  try {
    state.selected = await api(`/api/leads/${encodeURIComponent(id)}`);
    renderLog();
    renderInspector();
  } catch (error) {
    /* keep the previous selection */
  }
}

async function loadJev() {
  try {
    state.jev = await api("/api/jev");
    renderScorecard();
  } catch (error) {
    /* scorecard stays empty until the stream is up */
  }
}

async function loadDecisions() {
  try {
    const data = await api("/api/decisions?limit=80");
    state.decisions = data.decisions || [];
    renderLog();
    if (!state.selected && state.decisions.length) await selectLead(state.decisions[0].id);
  } catch (error) {
    /* log stays empty */
  }
}

let scorecardTimer = null;
function scheduleScorecardRefresh() {
  if (scorecardTimer) return;
  scorecardTimer = setTimeout(() => {
    scorecardTimer = null;
    loadJev();
  }, 2500);
}

export async function initConsole() {
  try {
    const config = await api("/api/config");
    state.config = config;
  } catch {
    state.config = null;
  }

  await Promise.all([loadJev(), loadDecisions()]);

  subscribe("lead", (lead) => {
    state.decisions.unshift(toDecision(lead));
    if (state.decisions.length > 200) state.decisions.length = 200;
    renderLog();
    scheduleScorecardRefresh();
    if (!state.selected) selectLead(lead.id);
  });

  subscribe("hello", (data) => {
    if (data?.provider) {
      state.jev = { ...(state.jev || {}), provider: data.provider };
      renderScorecard();
    }
  });

  renderInspector();
}
