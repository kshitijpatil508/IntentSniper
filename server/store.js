import fs from "node:fs";
import path from "node:path";
import config from "./config.js";

export class Store {
  constructor(options = {}) {
    this.dataDir = options.dataDir ?? config.store.dataDir;
    this.persist = options.persist ?? config.store.persist;
    this.max = options.max ?? config.store.max;
    this.leads = new Map();
    this.lastIngestAt = null;
    this.load();
  }

  get size() {
    return this.leads.size;
  }

  has(id) {
    return this.leads.has(id);
  }

  get(id) {
    return this.leads.get(id) || null;
  }

  add(lead) {
    if (!lead || !lead.id) return false;
    if (this.leads.has(lead.id)) return false;
    this.lastIngestAt = lead.ingestedAt || new Date().toISOString();
    this.leads.set(lead.id, lead);
    if (this.leads.size > this.max) {
      const oldest = this.leads.keys().next().value;
      this.leads.delete(oldest);
    }
    return true;
  }

  update(id, patch) {
    const current = this.leads.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.leads.set(id, next);
    return next;
  }

  list(filter = {}) {
    const {
      route,
      source,
      minIntent,
      minUrgency,
      q,
      limit = 100,
      offset = 0,
      sort = "recent",
    } = filter;

    const needle = q ? String(q).toLowerCase() : null;

    let rows = [...this.leads.values()];

    if (route) rows = rows.filter((l) => l.routing?.route === route);
    if (source) rows = rows.filter((l) => l.source === source);
    if (Number.isFinite(minIntent))
      rows = rows.filter((l) => (l.score?.answers?.intent?.probability ?? 0) >= minIntent);
    if (Number.isFinite(minUrgency))
      rows = rows.filter((l) => (l.score?.answers?.urgency?.value ?? 0) >= minUrgency);
    if (needle) {
      rows = rows.filter((l) =>
        `${l.title}\n${l.body}\n${l.author}\n${l.community}`.toLowerCase().includes(needle)
      );
    }

    if (sort === "priority") {
      rows.sort((a, b) => (b.routing?.priority ?? 0) - (a.routing?.priority ?? 0));
    } else {
      rows.sort((a, b) => new Date(b.ingestedAt) - new Date(a.ingestedAt));
    }

    const total = rows.length;
    return { total, leads: rows.slice(offset, offset + limit) };
  }

  stats() {
    const byRoute = { auto: 0, review: 0, quarantine: 0, nurture: 0 };
    const bySource = {};
    const providers = {};
    let latencySum = 0;
    let latencyCount = 0;
    let hotDeals = 0;

    for (const lead of this.leads.values()) {
      const route = lead.routing?.route || "nurture";
      byRoute[route] = (byRoute[route] || 0) + 1;
      bySource[lead.source] = (bySource[lead.source] || 0) + 1;
      const provider = lead.score?.provider || "unknown";
      providers[provider] = (providers[provider] || 0) + 1;
      if (Number.isFinite(lead.score?.latencyMs)) {
        latencySum += lead.score.latencyMs;
        latencyCount += 1;
      }
      if ((lead.score?.answers?.urgency?.value ?? 0) >= 8 && route !== "quarantine") hotDeals += 1;
    }

    return {
      total: this.leads.size,
      byRoute,
      bySource,
      providers,
      hotDeals,
      avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
      lastIngestAt: this.lastIngestAt,
      updatedAt: new Date().toISOString(),
    };
  }

  jevStats() {
    const latencies = [];
    const confidences = [];
    const byRoute = { auto: 0, review: 0, quarantine: 0, nurture: 0 };
    const byProvider = {};
    let totalCostUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let fallbacks = 0;

    for (const lead of this.leads.values()) {
      const score = lead.score || {};
      if (Number.isFinite(score.latencyMs)) latencies.push(score.latencyMs);
      if (Number.isFinite(score.overallConfidence)) confidences.push(score.overallConfidence);
      if (score.usage) {
        totalCostUsd += Number(score.usage.cost) || 0;
        inputTokens += Number(score.usage.input_tokens) || 0;
        outputTokens += Number(score.usage.output_tokens) || 0;
      }
      if (score.fallbackReason) fallbacks += 1;
      const provider = score.provider || "unknown";
      byProvider[provider] = (byProvider[provider] || 0) + 1;
      const route = lead.routing?.route || "nurture";
      byRoute[route] = (byRoute[route] || 0) + 1;
    }

    const percentile = (values, fraction) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    };
    const median = (values) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    };
    const mean = (values) =>
      values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000 : 0;

    const decisions = this.leads.size;
    return {
      decisions,
      byProvider,
      totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
      inputTokens,
      outputTokens,
      avgLatencyMs: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      avgConfidence: mean(confidences),
      medianConfidence: median(confidences.map((c) => Math.round(c * 1000)))/ 1000,
      fallbacks,
      byRoute,
      quarantineRate: decisions ? Math.round((byRoute.quarantine / decisions) * 1000) / 1000 : 0,
    };
  }

  file() {
    return path.join(this.dataDir, "leads.json");
  }

  load() {
    if (!this.persist) return;
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const parsed = JSON.parse(raw);
      for (const lead of parsed.leads || []) {
        if (!lead?.id) continue;
        this.leads.set(lead.id, lead);
        if (lead.ingestedAt && (!this.lastIngestAt || lead.ingestedAt > this.lastIngestAt)) {
          this.lastIngestAt = lead.ingestedAt;
        }
      }
    } catch {
      // no snapshot yet
    }
  }

  save() {
    if (!this.persist) return false;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        count: this.leads.size,
        leads: [...this.leads.values()],
      };
      const tmp = `${this.file()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.file());
      return true;
    } catch {
      return false;
    }
  }
}

export default Store;
