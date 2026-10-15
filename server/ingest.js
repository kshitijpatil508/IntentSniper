import { EventEmitter } from "node:events";
import config from "./config.js";
import { scoreLead } from "./jev/client.js";
import { routeLead } from "./router.js";
import { dispatch } from "./webhook.js";

const SOURCE_TIMEOUT_MS = 15000;

async function mapLimit(items, limit, fn) {
  const size = Math.max(1, Math.min(limit || 1, items.length || 1));
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const current = next++;
      if (current >= items.length) return;
      try {
        out[current] = await fn(items[current], current);
      } catch {
        out[current] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

const LOADERS = {
  hackernews: () => import("./sources/hackernews.js"),
  reddit: () => import("./sources/reddit.js"),
  github: () => import("./sources/github.js"),
  synthetic: () => import("./sources/synthetic.js"),
};

export class Ingestor extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
    this.sources = [];
    this.timer = null;
    this.running = false;
    this.cycles = 0;
    this.lastRunAt = null;
    this.lastResults = [];
    this.totals = {
      ingested: 0,
      added: 0,
      duplicates: 0,
      errors: 0,
      autoRouted: 0,
      reviewed: 0,
      quarantined: 0,
      webhooksDelivered: 0,
    };
  }

  async loadSources() {
    const entries = [];
    for (const [key, load] of Object.entries(LOADERS)) {
      try {
        const mod = await load();
        entries.push({
          name: mod.name || key,
          description: mod.description || "",
          fetchLeads: mod.fetchLeads,
          enabledByDefault: mod.enabledByDefault !== false,
          error: null,
        });
      } catch (error) {
        entries.push({
          name: key,
          description: "",
          fetchLeads: null,
          enabledByDefault: false,
          error: error.message,
        });
      }
    }
    this.sources = entries;
    return entries;
  }

  sourceStatus() {
    return this.sources.map((source) => {
      const last = this.lastResults.find((result) => result.source === source.name);
      return {
        name: source.name,
        description: source.description,
        enabled: Boolean(config.sources[source.name] && source.fetchLeads),
        available: Boolean(source.fetchLeads),
        error: source.error,
        lastError: last?.error || null,
        lastRun: last
          ? {
              fetched: last.fetched ?? 0,
              added: last.added ?? 0,
              latencyMs: last.latencyMs ?? null,
            }
          : null,
      };
    });
  }

  async fetchSource(source, limit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    try {
      return await source.fetchLeads({ limit, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async runOnce({ limit } = {}) {
    if (this.running) return { skipped: true, reason: "cycle already running" };
    if (!this.sources.length) await this.loadSources();

    this.running = true;
    this.emit("status", { running: true });

    const cap = limit ?? config.ingest.limitPerSource;
    const results = [];

    try {
      for (const source of this.sources) {
        if (!config.sources[source.name]) {
          results.push({ source: source.name, skipped: "disabled" });
          continue;
        }
        if (!source.fetchLeads) {
          results.push({ source: source.name, error: source.error || "unavailable" });
          this.totals.errors += 1;
          continue;
        }

        const started = Date.now();
        try {
          const raw = await this.fetchSource(source, cap);

          const fresh = [];
          for (const lead of raw) {
            this.totals.ingested += 1;
            if (this.store.has(lead.id)) {
              this.totals.duplicates += 1;
              continue;
            }
            fresh.push(lead);
          }

          const scores = await mapLimit(fresh, config.ingest.concurrency, (lead) => scoreLead(lead));

          let added = 0;
          let duplicates = 0;
          let autoRouted = 0;
          let quarantined = 0;

          for (let index = 0; index < fresh.length; index += 1) {
            const lead = fresh[index];
            const score = scores[index];
            if (!score) {
              duplicates += 1;
              this.totals.duplicates += 1;
              continue;
            }

            const routing = routeLead(score);
            const scoredLead = { ...lead, score, routing, ingestedAt: new Date().toISOString() };

            if (!this.store.add(scoredLead)) {
              duplicates += 1;
              this.totals.duplicates += 1;
              continue;
            }

            added += 1;
            this.totals.added += 1;

            if (routing.route === "auto") {
              autoRouted += 1;
              this.totals.autoRouted += 1;
              scoredLead.webhook = await dispatch(scoredLead);
              if (scoredLead.webhook.delivered) this.totals.webhooksDelivered += 1;
            } else if (routing.route === "review") {
              this.totals.reviewed += 1;
            } else if (routing.route === "quarantine") {
              quarantined += 1;
              this.totals.quarantined += 1;
            }

            this.emit("lead", scoredLead);
          }

          results.push({
            source: source.name,
            fetched: raw.length,
            added,
            duplicates,
            autoRouted,
            quarantined,
            latencyMs: Date.now() - started,
          });
        } catch (error) {
          this.totals.errors += 1;
          results.push({ source: source.name, error: error.message });
        }
      }

      this.cycles += 1;
      this.lastRunAt = new Date().toISOString();
      this.lastResults = results;
      this.store.save();

      const stats = this.store.stats();
      this.emit("stats", stats);
      this.emit("cycle", { results, cycles: this.cycles, at: this.lastRunAt });

      return { cycles: this.cycles, results, totals: this.totals, stats };
    } finally {
      this.running = false;
      this.emit("status", { running: false });
    }
  }

  start() {
    if (this.timer) return false;
    const tick = () => {
      this.runOnce().catch((error) => this.emit("error", error));
    };
    tick();
    this.timer = setInterval(tick, config.ingest.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    return true;
  }

  stop() {
    if (!this.timer) return false;
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  status() {
    return {
      active: Boolean(this.timer),
      running: this.running,
      intervalMs: config.ingest.intervalMs,
      cycles: this.cycles,
      lastRunAt: this.lastRunAt,
      totals: this.totals,
      lastResults: this.lastResults,
    };
  }
}

export default Ingestor;
