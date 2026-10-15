import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadDotEnv(file = process.env.ENV_FILE || ".env") {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // no .env file — rely on the ambient environment
  }
}

loadDotEnv();

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const list = (value, fallback) => {
  const source = value === undefined || value === "" ? fallback : value;
  return String(source)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

export const config = {
  version: "1.0.0",
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || "0.0.0.0",

  ingest: {
    intervalMs: num(process.env.INGEST_INTERVAL_MS, 20000),
    limitPerSource: num(process.env.INGEST_LIMIT, 25),
    autoStart: bool(process.env.INGEST_AUTOSTART, true),
    concurrency: num(process.env.INGEST_CONCURRENCY, 6),
    maxCycles: num(process.env.INGEST_MAX_CYCLES, 0),
  },

  sources: {
    hackernews: bool(process.env.SOURCE_HACKERNEWS, true),
    github: bool(process.env.SOURCE_GITHUB, true),
    reddit: bool(process.env.SOURCE_REDDIT, true),
    synthetic: bool(process.env.SOURCE_SYNTHETIC, true),
  },

  hackernews: {
    queries: list(
      process.env.HN_QUERIES,
      [
        "looking for a tool",
        "recommend a tool",
        "alternative to",
        "which platform should I use",
        "need a solution for",
      ].join(",")
    ),
    tags: list(process.env.HN_TAGS, ["story", "comment"].join(",")),
    hitsPerQuery: num(process.env.HN_HITS_PER_QUERY, 12),
    minPoints: num(process.env.HN_MIN_POINTS, 0),
  },

  reddit: {
    subreddits: list(
      process.env.REDDIT_SUBREDDITS,
      ["SaaS", "startups", "devops", "webdev", "smallbusiness", "Entrepreneur"].join(",")
    ),
    userAgent:
      process.env.REDDIT_USER_AGENT ||
      "intent-sniper/1.0 (hackathon demo; contact: demo@example.com)",
    listing: process.env.REDDIT_LISTING || "new",
  },

  github: {
    token: process.env.GITHUB_TOKEN || "",
    queries: list(
      process.env.GITHUB_QUERIES,
      [
        '"looking for a tool" in:title type:issue',
        '"is there a tool that" in:title type:issue',
        '"recommend a" in:title type:issue',
      ].join(",")
    ),
    perQuery: num(process.env.GITHUB_PER_QUERY, 12),
    userAgent: process.env.GITHUB_USER_AGENT || "intent-sniper",
  },

  synthetic: {
    batchSize: num(process.env.SYNTHETIC_BATCH, 12),
    seed: num(process.env.SYNTHETIC_SEED, 1337),
  },

  jev: {
    provider: (process.env.JEV_PROVIDER || "auto").toLowerCase(),
    typesafeApiKey: process.env.TYPESAFE_API_KEY || "",
    typesafeBaseUrl: process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1",
    gatewayApiKey:
      process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY || "",
    gatewayBaseUrl: process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1",
    model: process.env.JEV_MODEL || "typesafe-ai/jev",
    maxTokens: num(process.env.JEV_MAX_TOKENS, 700),
    timeoutMs: num(process.env.JEV_TIMEOUT_MS, 12000),
  },

  jevDecision: {
    apiKey: process.env.JEV_API_KEY || process.env.OPENROUTER_API_KEY || "",
    baseUrl: process.env.JEV_DECISION_BASE_URL || "https://openrouter.ai/api/alpha",
    model: process.env.JEV_DECISION_MODEL || "typesafe/jev-1.14",
    referer: process.env.OPENROUTER_REFERER || "http://localhost:8787",
    title: process.env.OPENROUTER_TITLE || "IntentSniper",
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    referer: process.env.OPENROUTER_REFERER || "http://localhost:8787",
    title: process.env.OPENROUTER_TITLE || "IntentSniper",
  },

  routing: {
    autoIntent: num(process.env.ROUTE_AUTO_INTENT, 0.85),
    autoConfidence: num(process.env.ROUTE_AUTO_CONFIDENCE, 0.8),
    autoUrgency: num(process.env.ROUTE_AUTO_URGENCY, 6),
    reviewIntent: num(process.env.ROUTE_REVIEW_INTENT, 0.45),
    injectionThreshold: num(process.env.ROUTE_INJECTION_THRESHOLD, 0.5),
  },

  webhook: {
    url: process.env.SDR_WEBHOOK_URL || "",
  },

  store: {
    dataDir: process.env.DATA_DIR || "data",
    persist: bool(process.env.PERSIST, true),
    max: num(process.env.STORE_MAX, 3000),
  },
};

export default config;
