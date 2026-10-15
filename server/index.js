import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "./config.js";
import { Store } from "./store.js";
import { Ingestor } from "./ingest.js";
import { providerInfo } from "./jev/client.js";
import { CRITERIA } from "./jev/schema.js";
import { TIERS, routeLead } from "./router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const store = new Store();
const ingestor = new Ingestor({ store });
const clients = new Set();
const startedAt = Date.now();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("payload too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(data);
  });
}

function sse(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now(), provider: providerInfo() })}\n\n`);
  res.write(`event: stats\ndata: ${JSON.stringify(store.stats())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": keep-alive\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method || "GET";

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      version: config.version,
      uptimeMs: Date.now() - startedAt,
      leads: store.size,
    });
  }

  if (method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      version: config.version,
      provider: providerInfo(),
      criteria: CRITERIA,
      routing: config.routing,
      tiers: TIERS,
      ingest: { intervalMs: config.ingest.intervalMs, limitPerSource: config.ingest.limitPerSource },
      webhookConfigured: Boolean(config.webhook.url),
    });
  }

  if (method === "GET" && pathname === "/api/sources") {
    return sendJson(res, 200, { sources: ingestor.sourceStatus(), ingest: ingestor.status() });
  }

  if (method === "GET" && pathname === "/api/stats") {
    return sendJson(res, 200, { ...store.stats(), ingest: ingestor.status() });
  }

  if (method === "GET" && pathname === "/api/jev") {
    return sendJson(res, 200, { provider: providerInfo(), stats: store.jevStats() });
  }

  if (method === "GET" && pathname === "/api/decisions") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 60, 300);
    const { leads } = store.list({ limit, sort: "recent" });
    const decisions = leads.map((lead) => ({
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
      inputTokens: lead.score?.usage?.input_tokens ?? null,
      outputTokens: lead.score?.usage?.output_tokens ?? null,
      confidence: lead.score?.overallConfidence ?? null,
      answers: lead.score?.answers ?? null,
      route: lead.routing?.route ?? null,
      priority: lead.routing?.priority ?? null,
      fallbackReason: lead.score?.fallbackReason ?? null,
    }));
    return sendJson(res, 200, { count: decisions.length, decisions });
  }

  if (method === "GET" && pathname === "/api/leads") {
    const q = url.searchParams;
    const toNum = (key) => (q.get(key) === null ? undefined : Number(q.get(key)));
    const filter = {
      route: q.get("route") || undefined,
      source: q.get("source") || undefined,
      q: q.get("q") || undefined,
      minIntent: toNum("minIntent"),
      minUrgency: toNum("minUrgency"),
      limit: Math.min(toNum("limit") ?? 100, 500),
      offset: toNum("offset") ?? 0,
      sort: q.get("sort") || "recent",
    };
    const result = store.list(filter);
    return sendJson(res, 200, { ...result, filter });
  }

  const leadMatch = pathname.match(/^\/api\/leads\/(.+?)(\/route)?$/);
  if (leadMatch) {
    const id = decodeURIComponent(leadMatch[1]);
    const isRoute = Boolean(leadMatch[2]);
    const lead = store.get(id);
    if (!lead) return sendJson(res, 404, { error: "lead not found", id });

    if (method === "GET" && !isRoute) return sendJson(res, 200, lead);

    if (method === "POST" && isRoute) {
      const body = await readBody(req);
      const action = body.action;
      if (!["approve", "reject", "reset"].includes(action)) {
        return sendJson(res, 400, { error: "action must be approve, reject, or reset" });
      }
      const patch =
        action === "approve"
          ? {
              routing: {
                ...lead.routing,
                route: "auto",
                manual: true,
                priority: Math.max(lead.routing?.priority ?? 0, 80),
                reasons: ["manual override: approved by operator"],
              },
            }
          : action === "reject"
            ? {
                routing: {
                  ...lead.routing,
                  route: "quarantine",
                  manual: true,
                  priority: Math.min(lead.routing?.priority ?? 0, 20),
                  reasons: ["manual override: rejected by operator"],
                },
              }
            : { routing: routeLead(lead.score) };
      const updated = store.update(id, patch);
      store.save();
      broadcast("lead", updated);
      broadcast("stats", store.stats());
      return sendJson(res, 200, updated);
    }
    return sendJson(res, 405, { error: "method not allowed" });
  }

  if (method === "POST" && pathname === "/api/ingest") {
    const body = await readBody(req);
    const result = await ingestor.runOnce({ limit: body.limit });
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/ingest/start") {
    await ingestor.loadSources();
    const started = ingestor.start();
    return sendJson(res, 200, { started, status: ingestor.status() });
  }

  if (method === "POST" && pathname === "/api/ingest/stop") {
    return sendJson(res, 200, { stopped: ingestor.stop(), status: ingestor.status() });
  }

  return sendJson(res, 404, { error: "unknown endpoint", pathname });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  try {
    if (url.pathname === "/api/stream") return sse(req, res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

ingestor.on("lead", (lead) => broadcast("lead", lead));
ingestor.on("stats", (stats) => broadcast("stats", stats));
ingestor.on("status", (status) => broadcast("status", status));
ingestor.on("error", (error) => broadcast("error", { message: error.message }));

async function main() {
  await ingestor.loadSources();
  const unavailable = ingestor.sources.filter((s) => !s.fetchLeads).map((s) => s.name);
  if (unavailable.length) console.warn(`[intent-sniper] unavailable sources: ${unavailable.join(", ")}`);
  if (config.ingest.autoStart) ingestor.start();

  server.listen(config.port, config.host, () => {
    const provider = providerInfo();
    console.log(`[intent-sniper] listening on http://localhost:${config.port}`);
    console.log(`[intent-sniper] Jev provider: ${provider.active} (${provider.model})`);
    console.log(`[intent-sniper] sources: ${ingestor.sourceStatus().filter((s) => s.enabled).map((s) => s.name).join(", ") || "none"}`);
  });
}

const shutdown = () => {
  ingestor.stop();
  store.save();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();

export { server, store, ingestor };
