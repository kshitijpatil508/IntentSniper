import { initConsole } from "./console.js";
import { onStatus, startStream, subscribe } from "./stream.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  config: null,
  stats: null,
  leads: [],
  stream: null,
  provider: null,
  filters: { q: "", source: "", route: "", minIntent: 0, minUrgency: 1, sort: "recent" },
  maxCache: 500,
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

async function api(path, options) {
  const response = await fetch(path, { headers: { accept: "application/json" }, ...options });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 2600);
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function matchesFilters(lead) {
  const f = state.filters;
  if (f.route && lead.routing?.route !== f.route) return false;
  if (f.source && lead.source !== f.source) return false;
  if ((lead.score?.answers?.intent?.probability ?? 0) < f.minIntent) return false;
  if ((lead.score?.answers?.urgency?.value ?? 0) < f.minUrgency) return false;
  if (f.q) {
    const haystack = `${lead.title} ${lead.body} ${lead.author} ${lead.community}`.toLowerCase();
    if (!haystack.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

function setLive(connected, ingesting) {
  const pill = $("#live-pill");
  pill.className = `pill ${connected ? "pill-good" : "pill-bad"}`;
  pill.textContent = "";
  pill.append(el("span", "dot"), document.createTextNode(ingesting ? "ingesting…" : connected ? "live" : "offline"));
}

function setProvider(provider) {
  if (!provider) return;
  state.provider = provider;
  const pill = $("#provider-pill");
  pill.className = `pill ${provider.live ? "pill-info" : "pill-neutral"}`;
  pill.textContent = `Jev: ${provider.active}`;
  pill.title = `model: ${provider.model}${provider.baseUrl ? ` @ ${provider.baseUrl}` : " (local fallback)"}`;
}

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  $("#s-total").textContent = stats.total ?? 0;
  $("#s-auto").textContent = stats.byRoute?.auto ?? 0;
  $("#s-review").textContent = stats.byRoute?.review ?? 0;
  $("#s-quarantine").textContent = stats.byRoute?.quarantine ?? 0;
  $("#s-hot").textContent = stats.hotDeals ?? 0;
  const latency = $("#s-latency");
  latency.textContent = `${stats.avgLatencyMs ?? 0}`;
  latency.append(el("small", null, "ms"));
  if (stats.ingest) {
    $("#ingest-info").textContent = `cycles ${stats.ingest.cycles} · ${stats.ingest.active ? "streaming" : "paused"}`;
  }
}

function renderSources() {
  const box = $("#sources");
  box.textContent = "";
  if (!state.sourceList) return;
  for (const source of state.sourceList) {
    const row = el("div", "flex items-center justify-between gap-2");
    row.append(el("span", null, source.name));
    if (!source.available) {
      row.append(el("span", "pill pill-bad", "unavailable"));
    } else if (source.lastError) {
      const pill = el("span", "pill pill-warn", "degraded");
      pill.title = source.lastError;
      row.append(pill);
    } else {
      row.append(el("span", `pill ${source.enabled ? "pill-good" : "pill-neutral"}`, source.enabled ? "on" : "off"));
    }
    box.append(row);
  }
}

function renderRouting() {
  const box = $("#routing");
  box.textContent = "";
  const routing = state.config?.routing;
  if (!routing) return;
  const rows = [
    ["Auto-route", `intent ≥ ${routing.autoIntent} · confidence ≥ ${routing.autoConfidence} · urgency ≥ ${routing.autoUrgency}`],
    ["Review", `intent ≥ ${routing.reviewIntent}`],
    ["Quarantine", `injection ≥ ${routing.injectionThreshold}`],
  ];
  for (const [label, detail] of rows) {
    const row = el("div", "flex flex-col");
    row.append(el("b", null, label), el("span", "text-slate-400 text-xs", detail));
    box.append(row);
  }
}

function intentBar(probability) {
  const wrapper = el("span", `bar ${probability >= 0.85 ? "high" : probability < 0.45 ? "low" : ""}`);
  const fill = el("span");
  fill.style.width = `${Math.round(probability * 100)}%`;
  wrapper.append(fill);
  return wrapper;
}

function leadCard(lead) {
  const route = lead.routing?.route || "nurture";
  const card = el("article", `card route-${route}`);
  card.dataset.id = lead.id;

  const head = el("div", "flex items-start gap-2");
  const title = el("h3", "grow", lead.title || "(untitled)");
  head.append(title, el("span", `pill ${ROUTE_META[route]?.pill || "pill-neutral"}`, ROUTE_META[route]?.label || route));
  card.append(head);

  const meta = el("div", "meta");
  meta.append(
    el("span", null, lead.source),
    el("span", null, lead.community || "unknown"),
    el("span", null, `@${lead.author || "unknown"}`),
    el("span", null, timeAgo(lead.ingestedAt || lead.createdAt)),
    el("span", null, `${lead.webhook?.delivered ? "webhook ✓" : ""}`)
  );
  card.append(meta);

  if (lead.body) card.append(el("p", "snippet", lead.body));

  const answers = lead.score?.answers || {};
  const metrics = el("div", "metrics");
  const intentP = answers.intent?.probability ?? 0;
  const intentChip = el("span", "chip", `intent ${intentP.toFixed(2)}`);
  metrics.append(intentBar(intentP), intentChip);
  metrics.append(el("span", "chip", `urgency ${answers.urgency?.value ?? "-"}/10`));
  metrics.append(el("span", "chip chip-industry", answers.industry?.value || "other"));
  metrics.append(el("span", "chip chip-pain", answers.painPoint?.value || "other"));
  metrics.append(el("span", "chip", `conf ${(lead.score?.overallConfidence ?? 0).toFixed(2)}`));
  if ((answers.injection?.probability ?? 0) >= 0.5) {
    metrics.append(el("span", "chip", `⚠ injection ${answers.injection.probability.toFixed(2)}`));
  }
  card.append(metrics);

  card.addEventListener("click", () => openDrawer(lead));
  return card;
}

function renderFeed() {
  const feed = $("#feed");
  feed.textContent = "";
  const rows = state.leads.filter(matchesFilters);
  if (state.filters.sort === "priority") rows.sort((a, b) => (b.routing?.priority ?? 0) - (a.routing?.priority ?? 0));
  for (const lead of rows.slice(0, 200)) feed.append(leadCard(lead));
  $("#feed-count").textContent = `(${rows.length})`;
  $("#feed-empty").hidden = rows.length > 0;
}

function renderHot() {
  const box = $("#hot");
  box.textContent = "";
  const hot = state.leads
    .filter((lead) => (lead.score?.answers?.urgency?.value ?? 0) >= 8 && lead.routing?.route !== "quarantine")
    .sort((a, b) => (b.routing?.priority ?? 0) - (a.routing?.priority ?? 0))
    .slice(0, 6);

  for (const lead of hot) {
    const item = el("div", "hot-item");
    item.append(el("span", "t", lead.title || "(untitled)"));
    item.append(
      el(
        "span",
        "m",
        `${lead.score.answers.industry.value} · urgency ${lead.score.answers.urgency.value} · intent ${lead.score.answers.intent.probability.toFixed(2)}`
      )
    );
    item.addEventListener("click", () => openDrawer(lead));
    box.append(item);
  }
  $("#hot-empty").hidden = hot.length > 0;
}

function upsertLead(lead, isNew) {
  const index = state.leads.findIndex((item) => item.id === lead.id);
  if (index >= 0) state.leads[index] = lead;
  else {
    state.leads.unshift(lead);
    if (state.leads.length > state.maxCache) state.leads.length = state.maxCache;
  }
  renderHot();
  if (matchesFilters(lead)) {
    if (isNew) {
      const card = leadCard(lead);
      card.classList.add("is-new");
      $("#feed").prepend(card);
      $("#feed-empty").hidden = true;
    } else {
      renderFeed();
    }
  }
}

function answerRow(name, criterion, summary, confidence) {
  const row = el("div", "answer-row");
  const left = el("div", "flex flex-col");
  left.append(el("span", "answer-name", `${name} · ${criterion}`), el("span", "answer-crit", summary));
  row.append(left, el("span", "chip", `conf ${Number(confidence ?? 0).toFixed(2)}`));
  return row;
}

function openDrawer(lead) {
  const body = $("#drawer-body");
  body.textContent = "";
  const answers = lead.score?.answers || {};

  body.append(el("h3", "text-base font-semibold", lead.title || "(untitled)"));

  const meta = el("div", "meta flex flex-wrap gap-2 text-xs text-slate-400");
  meta.append(el("span", null, `${lead.source} · ${lead.community || "unknown"}`), el("span", null, `@${lead.author || "unknown"}`));
  body.append(meta);

  if (lead.url) {
    const link = el("a", "text-indigo-400 text-sm underline break-all", lead.url);
    link.href = lead.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    body.append(link);
  }

  if (lead.body) body.append(el("p", "text-sm text-slate-300 whitespace-pre-wrap", lead.body));

  const route = lead.routing?.route || "nurture";
  const routingPanel = el("div", "panel");
  routingPanel.append(el("h4", "section-title", "Routing decision"));
  routingPanel.append(el("div", "mt-1", `${ROUTE_META[route]?.label || route} · priority ${lead.routing?.priority ?? 0}`));
  const reasons = el("ul", "text-xs text-slate-400 mt-1 list-disc pl-4");
  for (const reason of lead.routing?.reasons || []) reasons.append(el("li", null, reason));
  routingPanel.append(reasons);
  body.append(routingPanel);

  const answerPanel = el("div", "panel");
  answerPanel.append(el("h4", "section-title", `Jev answers · ${lead.score?.provider || "unknown"}`));
  answerPanel.append(
    answerRow("Commercial intent", "noul", `probability ${answers.intent?.probability ?? 0}`, answers.intent?.confidence)
  );
  answerPanel.append(
    answerRow("Injection / abuse", "noul", `probability ${answers.injection?.probability ?? 0}`, answers.injection?.confidence)
  );
  answerPanel.append(answerRow("Urgency", "score 1-10", `value ${answers.urgency?.value ?? "-"}`, answers.urgency?.confidence));
  answerPanel.append(answerRow("Industry", "choice", `${answers.industry?.value ?? "other"}`, answers.industry?.confidence));
  answerPanel.append(answerRow("Pain point", "choice", `${answers.painPoint?.value ?? "other"}`, answers.painPoint?.confidence));
  if (lead.score?.fallbackReason) {
    answerPanel.append(el("p", "text-xs text-amber-400 mt-2", `fallback: ${lead.score.fallbackReason}`));
  }
  body.append(answerPanel);

  const actions = el("div", "flex gap-2");
  const approve = el("button", "btn btn-primary", "Approve → auto-route");
  const reject = el("button", "btn btn-bad", "Reject → quarantine");
  const reset = el("button", "btn", "Re-score route");
  approve.addEventListener("click", () => routeAction(lead.id, "approve"));
  reject.addEventListener("click", () => routeAction(lead.id, "reject"));
  reset.addEventListener("click", () => routeAction(lead.id, "reset"));
  actions.append(approve, reject, reset);
  body.append(actions);

  $("#drawer").hidden = false;
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").hidden = false;
}

function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").hidden = true;
}

async function routeAction(id, action) {
  try {
    const updated = await api(`/api/leads/${encodeURIComponent(id)}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    upsertLead(updated, false);
    closeDrawer();
    toast(`${action} applied to ${updated.title?.slice(0, 40) || id}`);
  } catch (error) {
    toast(`failed: ${error.message}`);
  }
}

async function loadConfig() {
  try {
    state.config = await api("/api/config");
    setProvider(state.config.provider);
    renderRouting();
  } catch (error) {
    toast(`config: ${error.message}`);
  }
}

async function loadSources() {
  try {
    const data = await api("/api/sources");
    state.sourceList = data.sources;
    const select = $("#f-source");
    select.textContent = "";
    select.append(new Option("All sources", ""));
    for (const source of data.sources) select.append(new Option(source.name, source.name));
    renderSources();
  } catch (error) {
    toast(`sources: ${error.message}`);
  }
}

async function loadStats() {
  try {
    state.stats = await api("/api/stats");
    renderStats();
  } catch {
    /* stats event will follow */
  }
}

async function loadLeads() {
  const params = new URLSearchParams();
  const f = state.filters;
  if (f.route) params.set("route", f.route);
  if (f.source) params.set("source", f.source);
  if (f.q) params.set("q", f.q);
  if (f.minIntent > 0) params.set("minIntent", String(f.minIntent));
  if (f.minUrgency > 1) params.set("minUrgency", String(f.minUrgency));
  params.set("sort", f.sort);
  params.set("limit", "200");
  try {
    const data = await api(`/api/leads?${params.toString()}`);
    state.leads = data.leads;
    renderFeed();
    renderHot();
  } catch (error) {
    toast(`leads: ${error.message}`);
  }
}

function subscribeStream() {
  subscribe("hello", (data) => setProvider(data.provider));
  subscribe("stats", (stats) => {
    state.stats = stats;
    renderStats();
    refreshSources();
  });
  subscribe("lead", (lead) => upsertLead(lead, true));
  subscribe("error", (data) => toast(`stream error: ${data?.message ?? "unknown"}`));
  onStatus((connected, ingesting) => setLive(connected, ingesting));
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  };
}

const refreshSources = throttle(loadSources, 5000);

function showTab(name) {
  for (const view of document.querySelectorAll("[data-view]")) {
    view.hidden = view.dataset.view !== name;
  }
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
}

function wireTabs() {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  }
  showTab("console");
}

function wireControls() {
  $("#f-q").addEventListener("input", debounce((event) => {
    state.filters.q = event.target.value.trim();
    loadLeads();
  }, 250));

  $("#f-source").addEventListener("change", (event) => {
    state.filters.source = event.target.value;
    loadLeads();
  });

  $("#f-route").addEventListener("change", (event) => {
    state.filters.route = event.target.value;
    loadLeads();
  });

  $("#f-sort").addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    loadLeads();
  });

  $("#f-intent").addEventListener("input", (event) => {
    state.filters.minIntent = Number(event.target.value);
    $("#f-intent-out").textContent = state.filters.minIntent.toFixed(2);
    loadLeads();
  });

  $("#f-urgency").addEventListener("input", (event) => {
    state.filters.minUrgency = Number(event.target.value);
    $("#f-urgency-out").textContent = state.filters.minUrgency;
    loadLeads();
  });

  $("#btn-ingest").addEventListener("click", async () => {
    const button = $("#btn-ingest");
    button.disabled = true;
    button.textContent = "Ingesting…";
    try {
      const result = await api("/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const added = (result.results || []).reduce((sum, r) => sum + (r.added || 0), 0);
      toast(`ingest cycle complete · +${added} leads`);
      await loadLeads();
      await loadStats();
    } catch (error) {
      toast(`ingest failed: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "Run ingest now";
    }
  });

  $("#btn-toggle").addEventListener("click", async () => {
    const button = $("#btn-toggle");
    const active = state.stats?.ingest?.active;
    try {
      await api(`/api/ingest/${active ? "stop" : "start"}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      button.textContent = active ? "Resume stream" : "Pause stream";
      toast(active ? "ingest paused" : "ingest resumed");
      await loadStats();
    } catch (error) {
      toast(`failed: ${error.message}`);
    }
  });

  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

async function init() {
  wireTabs();
  wireControls();
  initConsole();
  subscribeStream();
  await Promise.all([loadConfig(), loadSources(), loadStats()]);
  await loadLeads();
  startStream();
}

init();
