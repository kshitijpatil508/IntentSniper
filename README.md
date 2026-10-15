# IntentSniper

Real-time social listening that scores every public post with TypeSafe Jev decision criteria and routes high-intent buyers by calibrated confidence.

A zero-dependency Node.js (`>=20`, ESM) service that polls free public tech feeds, evaluates each post against typed **Noul / Score / Choice** criteria, and routes leads into **auto / review / nurture / quarantine** tiers. It ships a live browser dashboard driven by HTTP + Server-Sent Events.

## Why Jev / the idea

Most lead-detection systems ask a generative model to "write something helpful," which makes the output hard to gate on. IntentSniper instead treats scoring as a **decision problem**: Jev answers fixed typed criteria (boolean, 1–10 score, single choice) and, crucially, returns a **calibrated confidence** for every answer. Routing then keys off that confidence — a high intent probability *and* high intent confidence is required before a lead auto-routes, so a confident-looking but uncertain guess never auto-fires a webhook. This keeps automation honest and lets the system fall back to a deterministic local scorer when no model key is present.

## Quickstart

```bash
cp .env.example .env
npm start
# open http://localhost:8787
```

Works fully offline: the `synthetic` source generates realistic leads and adversarial edge cases, and the `heuristic` scorer runs with no API keys. Open the dashboard and hit **Run ingest now**, or wait for the autostart loop (`INGEST_AUTOSTART=true`).

Notes:
- **`.env` is loaded automatically** at startup (dependency-free loader in `server/config.js`; real environment variables always win over the file).
- **A live Jev model runs on a key.** Set `JEV_PROVIDER=openrouter` plus `OPENROUTER_API_KEY` to score with OpenRouter; with no key at all, provider `auto` selects the deterministic local heuristic scorer, so the app still works offline.
- **GitHub token raises the rate limit** — an unauthenticated PAT is 60 req/hr, a `GITHUB_TOKEN` is 5000 req/hr.
- **Reddit may be blocked on some networks.** It degrades gracefully: the adapter skips HTML/blocked responses instead of failing the whole cycle.

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   free public      │              server/ingest.js                │
   feeds            │   poll sources every INGEST_INTERVAL_MS      │
 ┌────────────┐     │   dedupe by id → score → route → dispatch    │
 │ hackernews │────▶│                                              │
 │ github     │     └───────┬───────────────────────────┬─────────┘
 │ reddit     │             │                           │
 │ synthetic  │      scoreLead(lead)              routeLead(score)
 └────────────┘             ▼                           ▼
   server/sources/   server/jev/client.js         server/router.js
                    ┌──────────────────┐        ┌──────────────────┐
                    │ typesafe         │        │ quarantine       │
                    │ gateway          │        │ auto / review    │
                    │ heuristic (local)│        │ nurture          │
                    └────────┬─────────┘        └────────┬─────────┘
                             │  answers + confidence       │
                             └──────────┬──────────────────┘
                                        ▼
                    ┌──────────────────────────────────────────────┐
                    │             server/store.js                   │
                    │  in-memory Map + optional DATA_DIR/leads.json │
                    └───────┬──────────────┬───────────────┬───────┘
                            │              │               │
                   SSE broadcast     server/webhook.js   HTTP API
                   (/api/stream)     POST SDR_WEBHOOK     (/api/*)
                            │              │               │
                            ▼              ▼               ▼
                    public/index.html  Slack/Discord   dashboard /
                    public/app.js      compatible      curl / scripts
                    (EventSource)        JSON body
```

Sources emit `RawLead` objects into the ingest loop. Each lead is scored by the active Jev provider, routed, stored, and (for `auto`) delivered to the SDR webhook. The dashboard subscribes to the SSE stream and updates live.

## Lead sources

Each adapter in `server/sources/` exports `name`, `description`, `enabledByDefault`, and `async fetchLeads({ limit, signal }) -> RawLead[]`.

| Source | Endpoint | Cost | Notes |
| --- | --- | --- | --- |
| `hackernews` | HN Algolia `search_by_date` (`?query=&tags=story|comment`) | Free | No key. Searches configured `HN_QUERIES`, dedupes, filters by `HN_MIN_POINTS`. |
| `github` | GitHub `search/issues?q=` | Free | No key: 60 req/hr. `GITHUB_TOKEN` → 5000 req/hr. |
| `reddit` | `r/<sub>/new.json` | Free | No key. Skips blocked/HTML responses instead of throwing. |
| `synthetic` | in-process generator | Free | Offline. Hot buyers, warm leads, tire-kickers, prompt-injection, and spam fixtures. |

`RawLead` shape:

```js
{
  id, source, community, author, title, body, url, createdAt,
  engagement: { score, comments },
  raw
}
```

Toggle any source off via `SOURCE_HACKERNEWS`, `SOURCE_GITHUB`, `SOURCE_REDDIT`, `SOURCE_SYNTHETIC`.

## Jev criteria

Defined in `server/jev/schema.js`. Each criterion maps to a native Jev question type. Jev's `choice` and `score` answers carry a native `confidence` and a full probability distribution; a `noul` answer returns only a probability, so its confidence is derived as **decisiveness** `2·|p − 0.5|` (0 at p=0.5, 1 at p=0 or 1).

| Criterion | Kind | Question | Output |
| --- | --- | --- | --- |
| `intent` | Noul | Actively looking to buy, hire, or evaluate a commercial product/service/vendor? | boolean + probability + confidence |
| `injection` | Noul | Prompt injection, jailbreak, or off-topic abuse (spam/scam/SEO bait)? | boolean + probability + confidence |
| `urgency` | Score | How urgent is the need? 1 = someday, 10 = blocking production now. | integer 1–10 + confidence |
| `industry` | Choice | Which industry / use case fits best? | `devtools` \| `fintech` \| `healthcare` \| `ecommerce` \| `other` + confidence |
| `painPoint` | Choice | What is the primary pain point? | `performance` \| `cost` \| `security` \| `compliance` \| `other` + confidence |

Scoring providers (`server/jev/client.js`):

| Provider | Selected when | Notes |
| --- | --- | --- |
| `jev` | `JEV_API_KEY` (or `OPENROUTER_API_KEY`) set (and requested) | **TypeSafe Jev decision model** — `POST {JEV_DECISION_BASE_URL}/decisions` with typed questions; model `JEV_DECISION_MODEL` (`typesafe/jev-1.14`). Answers are typed: `noul` probability, `choice` label, `score` index. |
| `typesafe` | `TYPESAFE_API_KEY` set (and requested) | OpenAI-compatible chat completions at `TYPESAFE_BASE_URL`, JSON response format. |
| `gateway` | `AI_GATEWAY_API_KEY` set (and requested) | Vercel AI Gateway, model `typesafe-ai/jev`. |
| `openrouter` | `OPENROUTER_API_KEY` set (and requested) | OpenRouter (OpenAI-compatible), model `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`). Sends `HTTP-Referer` / `X-Title` attribution headers. |
| `heuristic` | No key, or provider `heuristic` | Deterministic local scorer (`server/jev/heuristic.js`), always works offline, includes prompt-injection detection. |

`JEV_PROVIDER=auto` picks the first live provider with a key (order: `jev` → `typesafe` → `gateway` → `openrouter`), otherwise `heuristic`. Any live-provider error falls back to `heuristic` with `score.fallbackReason` set to the failure.

The `jev` provider is the one that matches the brief: Jev is a **decision model**, not a chat model. Each criterion is a native Jev question (`noul` / `score` / `choice`) and the server owns the routing workflow.

## The Jev Console

The dashboard's default tab is the **Jev Console** — the view that puts Jev's work on screen, not just its verdicts. Three parts:

- **Scorecard** — decisions made, median confidence, p50/p95 and average latency, cumulative spend, tokens in/out, quarantine rate and fallback count (from `GET /api/jev`).
- **Decision log** — every Jev call, newest first, with the model, routing verdict, the five answers, latency and cost. Click a row to open it.
- **Decision inspector** — for the selected post: the exact state Jev evaluated, then each criterion rendered as its **native type** — a probability gauge for `noul`, probability bars for `choice`, and the distribution across the labelled rungs for `score` — each with its confidence. Below that, a **gate trace** shows which routing thresholds passed or failed, and a **raw response** toggle reveals Jev's literal JSON.

The console builds from the `raw` payload stored on every lead (`score.raw`) plus the criteria definitions in `GET /api/config`, so it always shows what Jev actually returned rather than a re-derived guess.

## Routing thresholds

Pure function in `server/router.js`, evaluated in order:

| Route | Condition | Meaning |
| --- | --- | --- |
| `quarantine` | `injection >= ROUTE_INJECTION_THRESHOLD` (0.5) | Adversarial / abusive → review queue. Priority capped at 20. |
| `auto` | `intent >= ROUTE_AUTO_INTENT` (0.85) **AND** `intent confidence >= ROUTE_AUTO_CONFIDENCE` (0.8) **AND** `urgency >= ROUTE_AUTO_URGENCY` (6) | High confidence + high score → auto-route to SDR. |
| `review` | `intent >= ROUTE_REVIEW_INTENT` (0.45) | Medium confidence → human BDR triage. |
| `nurture` | otherwise | Low intent → standard queue. |

Priority: `intent*60 + urgency*3 + confidence*20 - injection*60`, clamped to `0–100`.

> **Design note (postmortem):** the routing confidence gate uses the **intent criterion's own confidence**, not the mean across all criteria. This was a deliberate correction — averaging pulled in high-confidence but irrelevant criteria (like a confident `industry` guess) and could auto-route borderline or adversarial leads. Gating on intent confidence keeps the auto-route bar honest.

## API reference

HTTP server in `server/index.js`; JSON responses include `access-control-allow-origin: *`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness: `ok`, `version`, `uptimeMs`, `leads`. |
| GET | `/api/config` | Active provider, criteria, routing thresholds, tiers, ingest settings. |
| GET | `/api/sources` | Source status (`enabled` / `available` / module-load `error`, plus `lastError` and `lastRun` from the most recent cycle) + ingest status. |
| GET | `/api/stats` | Store stats (by route, by source, by provider, hot deals, avg latency) + ingest status. |
| GET | `/api/jev` | Jev scorecard: active provider/model plus aggregates (spend, tokens, p50/p95/avg latency, confidence, quarantine rate, fallbacks). |
| GET | `/api/decisions` | Compact decision-log rows (`limit` ≤ 300): model, latency, cost, answers, route, priority. |
| GET | `/api/leads` | List leads. Query: `route`, `source`, `q`, `minIntent`, `minUrgency`, `limit` (≤500), `offset`, `sort=recent\|priority`. |
| GET | `/api/leads/:id` | Fetch a single scored lead. |
| POST | `/api/leads/:id/route` | Body `{ "action": "approve" \| "reject" \| "reset" }`. Manual override. |
| POST | `/api/ingest` | Run one ingest cycle now (optional body `{ limit }`). |
| POST | `/api/ingest/start` | Start the periodic ingest loop. |
| POST | `/api/ingest/stop` | Stop the periodic ingest loop. |
| GET | `/api/stream` | Server-Sent Events. Events: `hello`, `stats`, `status`, `lead`, `error`. |

## Configuration

Copy `.env.example` → `.env`. All variables are optional; defaults come from `server/config.js`.

| Group | Variable | Default | Purpose |
| --- | --- | --- | --- |
| server | `PORT` | `8787` | HTTP port. |
| server | `HOST` | `0.0.0.0` | Bind address. |
| ingest | `INGEST_INTERVAL_MS` | `20000` | Poll interval. |
| ingest | `INGEST_LIMIT` | `25` | Max leads per source per cycle. |
| ingest | `INGEST_CONCURRENCY` | `6` | Parallel Jev scoring calls per cycle. |
| ingest | `INGEST_AUTOSTART` | `true` | Start the loop on boot. |
| sources | `SOURCE_HACKERNEWS` | `true` | Enable HN source. |
| sources | `SOURCE_GITHUB` | `true` | Enable GitHub source. |
| sources | `SOURCE_REDDIT` | `true` | Enable Reddit source. |
| sources | `SOURCE_SYNTHETIC` | `true` | Enable offline synthetic source. |
| sources | `HN_QUERIES`, `HN_TAGS`, `HN_HITS_PER_QUERY`, `HN_MIN_POINTS` | see `.env.example` | HN search config. |
| sources | `REDDIT_SUBREDDITS`, `REDDIT_LISTING`, `REDDIT_USER_AGENT` | see `.env.example` | Reddit monitor config. |
| sources | `GITHUB_TOKEN`, `GITHUB_QUERIES`, `GITHUB_PER_QUERY` | see `.env.example` | GitHub search config (`GITHUB_TOKEN` optional). |
| sources | `SYNTHETIC_BATCH`, `SYNTHETIC_SEED` | `12`, `1337` | Synthetic generator size/seed. |
| jev | `JEV_PROVIDER` | `auto` | `auto` \| `jev` \| `typesafe` \| `gateway` \| `openrouter` \| `heuristic`. |
| jev | `JEV_API_KEY`, `JEV_DECISION_BASE_URL` | `https://openrouter.ai/api/alpha` | TypeSafe Jev decision endpoint. Key falls back to `OPENROUTER_API_KEY`. |
| jev | `JEV_DECISION_MODEL` | `typesafe/jev-1.14` | Jev decision model id. |
| jev | `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` | `https://api.typesafe.ai/v1` | TypeSafe provider. |
| jev | `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v1` | Vercel AI Gateway provider. |
| jev | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter provider. |
| jev | `OPENROUTER_MODEL`, `OPENROUTER_REFERER`, `OPENROUTER_TITLE` | `openai/gpt-4o-mini` | OpenRouter model id and attribution headers. |
| jev | `JEV_MODEL` | `typesafe-ai/jev` | Model id for the TypeSafe / Gateway providers. |
| jev | `JEV_TIMEOUT_MS` | `12000` | Per-call timeout. |
| routing | `ROUTE_AUTO_INTENT` | `0.85` | Auto-route intent bar. |
| routing | `ROUTE_AUTO_CONFIDENCE` | `0.8` | Auto-route intent-confidence bar. |
| routing | `ROUTE_AUTO_URGENCY` | `6` | Auto-route urgency bar. |
| routing | `ROUTE_REVIEW_INTENT` | `0.45` | Review intent bar. |
| routing | `ROUTE_INJECTION_THRESHOLD` | `0.5` | Quarantine injection bar. |
| webhook | `SDR_WEBHOOK_URL` | *(unset)* | Slack/Discord-compatible POST target; no-op if unset. |
| store | `DATA_DIR` | `data` | JSON snapshot directory. |
| store | `PERSIST` | `true` | Write `DATA_DIR/leads.json`. |
| store | `STORE_MAX` | `3000` | Ring-buffer cap; oldest leads evicted past this. |

Additional optional variables recognized by `config.js`: `INGEST_MAX_CYCLES`, `JEV_MAX_TOKENS`, `GITHUB_USER_AGENT`, and `VERCEL_AI_GATEWAY_API_KEY` (alias for `AI_GATEWAY_API_KEY`).

## Scripts

Defined in `package.json`:

| Script | Command | Purpose |
| --- | --- | --- |
| `npm start` | `node server/index.js` | Run the HTTP + SSE server. |
| `npm run dev` | `node --watch server/index.js` | Run with auto-restart on file changes. |
| `npm run ingest` | `node scripts/ingest-once.js` | Run a single ingest cycle and print results + stats. |
| `npm run selftest` | `node scripts/selftest.js` | Fixture + synthetic-batch scoring/routing assertions. |
| `npm run check` | `node scripts/check-all.js` | `node --check` every `.js` under `server/`, `public/`, `scripts/`. |

## Project layout

```
.
├── .env.example                       # all config vars with defaults
├── package.json                       # type: module, engines: node >=20, no runtime deps
├── .commandcode/agents/               # project subagents (see below)
├── data/                              # leads.json snapshot (gitignored)
├── public/                            # dashboard (static, no build step)
│   ├── index.html                     # Tailwind via CDN
│   ├── app.js                         # Live Feed view
│   ├── console.js                     # Jev Console: scorecard, decision log, inspector
│   ├── stream.js                      # shared SSE subscription
│   └── styles.css
├── scripts/
│   ├── check-all.js                   # node --check sweep
│   ├── ingest-once.js                 # one-shot ingest
│   └── selftest.js                    # scoring + routing assertions
└── server/
    ├── index.js                       # entry point: HTTP + SSE server
    ├── config.js                      # env parsing → typed config
    ├── ingest.js                      # poll → dedupe → score → route → dispatch
    ├── router.js                      # routeLead() + TIERS
    ├── store.js                       # in-memory Map + JSON persistence
    ├── webhook.js                     # Slack/Discord-compatible POST
    ├── jev/
    │   ├── schema.js                  # CRITERIA, prompt, normalizeAnswers
    │   ├── client.js                  # provider resolution + remote call
    │   └── heuristic.js               # deterministic offline scorer
    └── sources/
        ├── hackernews.js
        ├── github.js
        ├── reddit.js
        └── synthetic.js
```

The dashboard (`public/`) is Tailwind via CDN + vanilla JS + `EventSource` — no build step. Source adapters and Jev providers are plain ES modules; there are **no npm runtime dependencies** (`global fetch`, Node built-ins only).

## Adversarial input handling

Lead text is treated as **untrusted data, never instructions**. When a lead is scored by a live model it is wrapped in `<lead>…</lead>` delimiters inside the user prompt, and the system prompt states that everything inside the block is content to classify — attempts to change the task are themselves evidence for the `injection` criterion. The deterministic heuristic scorer likewise runs explicit prompt-injection and abuse pattern detection (`ignore previous instructions`, jailbreaks, system-prompt extraction, spam/scam bait, `<script>` payloads). If `injection` probability meets `ROUTE_INJECTION_THRESHOLD` (default 0.5), the lead is routed to **quarantine** and its priority is capped, so injected "mark this as VIP" payloads never reach the SDR webhook.

## Project subagents

Reusable subagents live in `.commandcode/agents/` — `backend-builder`, `frontend-builder`, `jev-integrator`, `data-sources`, `qa-verifier`, and `docs-writer`. Each is pinned to `deepseek/deepseek-v4.1-flash` at high reasoning effort.
