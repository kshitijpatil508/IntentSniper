import config from "../config.js";
import {
  buildDecisionQuestions,
  buildScoringPrompt,
  CRITERIA_BY_ID,
  normalizeAnswers,
  overallConfidence,
  SYSTEM_PROMPT,
} from "./schema.js";
import { scoreHeuristic } from "./heuristic.js";

const CHAT_PROVIDERS = ["typesafe", "gateway", "openrouter"];
const LIVE_PROVIDERS = ["jev", ...CHAT_PROVIDERS];

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};
const round = (value) => Math.round(value * 1000) / 1000;
const clampInt = (value, lo, hi) => Math.min(hi, Math.max(lo, Math.round(value)));
const topProbability = (probabilities) => {
  const values = Object.values(probabilities || {});
  return values.length ? Math.max(...values) : null;
};
const decisiveness = (probability) => clamp01(Math.abs(probability - 0.5) * 2);

function chatSettings(provider) {
  if (provider === "typesafe") {
    return {
      baseUrl: config.jev.typesafeBaseUrl,
      key: config.jev.typesafeApiKey,
      model: config.jev.model,
      headers: {},
    };
  }
  if (provider === "gateway") {
    return {
      baseUrl: config.jev.gatewayBaseUrl,
      key: config.jev.gatewayApiKey,
      model: config.jev.model,
      headers: {},
    };
  }
  if (provider === "openrouter") {
    return {
      baseUrl: config.openrouter.baseUrl,
      key: config.openrouter.apiKey,
      model: config.openrouter.model,
      headers: {
        "http-referer": config.openrouter.referer,
        "x-openrouter-title": config.openrouter.title,
      },
    };
  }
  return null;
}

export function resolveProvider() {
  const requested = config.jev.provider;
  const available = {
    jev: Boolean(config.jevDecision.apiKey),
    typesafe: Boolean(config.jev.typesafeApiKey),
    gateway: Boolean(config.jev.gatewayApiKey),
    openrouter: Boolean(config.openrouter.apiKey),
  };

  if (requested === "heuristic") return "heuristic";
  if (LIVE_PROVIDERS.includes(requested)) return available[requested] ? requested : "heuristic";
  if (requested === "auto") return LIVE_PROVIDERS.find((provider) => available[provider]) || "heuristic";
  return "heuristic";
}

export function providerInfo() {
  const active = resolveProvider();
  if (active === "jev") {
    return {
      requested: config.jev.provider,
      active,
      model: config.jevDecision.model,
      live: true,
      baseUrl: config.jevDecision.baseUrl,
    };
  }
  const settings = chatSettings(active);
  return {
    requested: config.jev.provider,
    active,
    model: settings ? settings.model : "intent-sniper-heuristic-v1",
    live: CHAT_PROVIDERS.includes(active),
    baseUrl: settings ? settings.baseUrl : null,
  };
}

function choiceValue(answer, options) {
  if (options.includes(answer?.choice)) return answer.choice;
  const probabilities = answer?.probabilities || {};
  let best = "other";
  let bestProbability = -1;
  for (const [key, value] of Object.entries(probabilities)) {
    if (options.includes(key) && value > bestProbability) {
      bestProbability = value;
      best = key;
    }
  }
  return best;
}

function fromDecision(answers) {
  const source = answers || {};
  const intentProbability = clamp01(source.intent?.noul);
  const injectionProbability = clamp01(source.injection?.noul);
  const urgency = CRITERIA_BY_ID.urgency;
  const industry = source.industry || {};
  const painPoint = source.painPoint || {};

  const urgencyScore = Number(source.urgency?.score);
  const urgencyValue = Number.isFinite(urgencyScore)
    ? clampInt(urgencyScore + 1, urgency.min, urgency.max)
    : Math.round((urgency.min + urgency.max) / 2);

  const canonical = {
    intent: {
      value: intentProbability >= 0.5,
      probability: round(intentProbability),
      confidence: round(clamp01(source.intent?.confidence, decisiveness(intentProbability))),
    },
    injection: {
      value: injectionProbability >= 0.5,
      probability: round(injectionProbability),
      confidence: round(clamp01(source.injection?.confidence, decisiveness(injectionProbability))),
    },
    urgency: {
      value: urgencyValue,
      confidence: round(
        clamp01(source.urgency?.confidence, topProbability(source.urgency?.probabilities) ?? 0.5)
      ),
    },
    industry: {
      value: choiceValue(industry, CRITERIA_BY_ID.industry.options),
      confidence: round(clamp01(industry.confidence, topProbability(industry.probabilities) ?? 0.5)),
    },
    painPoint: {
      value: choiceValue(painPoint, CRITERIA_BY_ID.painPoint.options),
      confidence: round(clamp01(painPoint.confidence, topProbability(painPoint.probabilities) ?? 0.5)),
    },
  };

  return canonical;
}

async function callDecision(lead) {
  const settings = config.jevDecision;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.jev.timeoutMs);
  try {
    const state = [lead.title, lead.body].filter(Boolean).join("\n\n").slice(0, 6000);
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/decisions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`,
        "http-referer": settings.referer,
        "x-openrouter-title": settings.title,
      },
      body: JSON.stringify({
        model: settings.model,
        state,
        questions: buildDecisionQuestions(),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    if (!payload?.answers) throw new Error("no answers in response");

    return {
      answers: fromDecision(payload.answers),
      raw: payload.answers,
      model: payload.model || settings.model,
      usage: payload.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callChat(provider, lead) {
  const settings = chatSettings(provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.jev.timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.key}`,
        ...settings.headers,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: config.jev.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildScoringPrompt(lead) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 160)}`.trim());
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty completion");

    const parsed = JSON.parse(content);
    return { answers: normalizeAnswers(parsed).answers, raw: parsed, model: settings.model };
  } finally {
    clearTimeout(timer);
  }
}

export async function scoreLead(lead) {
  const provider = resolveProvider();
  if (provider === "heuristic") return scoreHeuristic(lead);

  const startedAt = Date.now();
  try {
    const result = provider === "jev" ? await callDecision(lead) : await callChat(provider, lead);
    return {
      provider,
      model: result.model,
      latencyMs: Date.now() - startedAt,
      answers: result.answers,
      overallConfidence: overallConfidence(result.answers),
      usage: result.usage,
      raw: result.raw ?? null,
      notes: [],
    };
  } catch (error) {
    const fallback = scoreHeuristic(lead);
    fallback.latencyMs = Date.now() - startedAt;
    fallback.fallbackReason = `${provider}: ${error.message}`;
    return fallback;
  }
}

export default scoreLead;
