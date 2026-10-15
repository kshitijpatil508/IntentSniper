import { overallConfidence } from "./schema.js";

const INTENT_POSITIVE = [
  [/\blooking for\b/i, 2.2],
  [/\brecommend\w*\b/i, 1.6],
  [/\bany\s+(recommend\w*|suggest\w*|advice|ideas?|thoughts?|pointers?)\b/i, 1.5],
  [/\bany(one|body)?\s*(know|recommend|using|suggest)\b/i, 1.7],
  [/\bbest (tool|platform|solution|service|software|vendor|provider|option)\b/i, 2.0],
  [/\balternatives? to\b/i, 1.8],
  [/\b(which|what) (tool|platform|vendor|solution|service|provider)\b/i, 1.5],
  [/\bcompar(e|ing|ison)\b/i, 1.0],
  [/\b(pricing|quote|procure(ment)?|budget for)\b/i, 1.8],
  [/\b(what|what's|whats) (is |are )?(the )?(price|pricing|cost)\b/i, 1.5],
  [/\bhow much (does|do|would)\b/i, 1.2],
  [/\bper[ -]?(seat|user|month|license|year)\b/i, 1.5],
  [/\brfp\b/i, 2.2],
  [/\brequest for (proposal|quote|pricing)\b/i, 2.2],
  [/\bvendor\b/i, 1.4],
  [/\b(demo|trial|pilot|onboarding|proof of concept|poc)\b/i, 1.3],
  [/\benterprise (plan|license|deployment|seats?|agreement|provider)\b/i, 2.0],
  [/\bimplement(ation|ing)?\b/i, 0.9],
  [/\bmigrat(e|ing|ion) (to|from|off)\b/i, 1.4],
  [/\bwe('| a)?re (evaluating|considering|shopping|selecting|looking)\b/i, 2.0],
  [/\bneed\b[^.]{0,40}\b(tool|solution|service|vendor|platform|provider|software|product)\b/i, 1.8],
  [/\bhire (a|an)?\s*(vendor|agency|consultant|freelancer|contractor)\b/i, 1.6],
  [/\bshould (i|we) (buy|use|switch|adopt)\b/i, 1.8],
  [/\bwilling to pay\b/i, 2.0],
  [/\b(budget|funding) (is )?approved\b/i, 1.6],
  [/\bready to (buy|move|purchase|commit|adopt)\b/i, 1.8],
  [/\b(bill|cost|spend|spend) (tripled|doubled|exploded|skyrocketed)\b/i, 1.6],
  [/\blosing (money|customers|revenue|\$)\b/i, 1.5],
  [/\b(iso ?27001|soc ?2|hipaa|gdpr|pci[- ]?dss|fedramp)\b/i, 1.2],
];

const INTENT_NEGATIVE = [
  [/\bshow hn\b/i, -1.6],
  [/\bi (built|made|created|launched|wrote|released)\b/i, -1.4],
  [/\bwe (built|launched|shipped|released|are releasing)\b/i, -1.4],
  [/\bmy (startup|product|app|tool|side project)\b/i, -1.0],
  [/\bfree (and )?open source\b/i, -0.5],
];

const URGENCY_SIGNALS = [
  [/\basap\b/i, 3],
  [/\burgent(ly)?|urgency\b/i, 3],
  [/\bimmediately\b/i, 3],
  [/\bdeadline\b/i, 2.5],
  [/\b(by|before) (today|tomorrow|eod|friday|monday)\b/i, 2.5],
  [/\bthis (week|month|quarter)\b/i, 1.5],
  [/\bblocking\b/i, 2.5],
  [/\bproduction (down|is down|outage)\b/i, 3],
  [/\bneed (it |this )?(now|today)\b/i, 3],
  [/\bcritical\b/i, 2],
  [/\bcost(ing)? us\b/i, 1.6],
  [/\b(budget|funding) (is )?approved\b/i, 2.0],
  [/\bready to (buy|move|purchase|commit|start|adopt)\b/i, 2.0],
  [/\bneed (a |an |some |something )?.*\bbefore\b/i, 2.0],
  [/\b(audit|renewal|rollout|launch|migration deadline)\b/i, 1.5],
  [/\blosing .{0,25}(month|\$|money|revenue|customers)\b/i, 2.0],
  [/\bpeak (season|traffic|load|hours)\b/i, 1.5],
];

const INDUSTRY_SIGNALS = {
  fintech: [/\b(payment|banking|lending|ledger|kyc|aml|wire transfer|card|fraud|fintech|stripe|reconciliation)\b/i],
  healthcare: [/\b(patient|hipaa|clinic|ehr|emr|medical|telehealth|hospital|healthcare)\b/i],
  devtools: [/\b(ci\/cd|deploy|kubernetes|k8s|sdk|api|observability|monitoring|repo|pipeline|docker|terraform|codebase|developer)\b/i],
  ecommerce: [/\b(shopify|checkout|cart|storefront|product listing|order|fulfillment|ecommerce|e-commerce|merchant)\b/i],
};

const PAIN_SIGNALS = {
  security: [/\b(vulnerab|breach|exploit|soc ?2|pen ?test|penetration|cve|ransomware|auth|secret|zero.?trust)\b/i],
  performance: [/\b(latency|slow|scale|throughput|timeout|p99|speed|memory|performance|downtime)\b/i],
  cost: [/\b(expensive|cost|budget|price|bill|cheaper|spend|invoice|pricing is)\b/i],
  compliance: [/\b(gdpr|hipaa|soc ?2|iso ?27001|audit|pci|regulation|compliance|residency)\b/i],
};

const INJECTION_SIGNALS = [
  [/\bignore (all )?(previous|prior|above) (instructions|prompts|rules)\b/i, 3.5],
  [/\bdisregard (the )?(above|previous|prior)\b/i, 3.0],
  [/\bsystem prompt\b/i, 2.5],
  [/\byou are now\b/i, 2.2],
  [/\bjailbreak\b/i, 3.0],
  [/\bdeveloper mode\b/i, 2.5],
  [/\bprint (your|the) (instructions|prompt|rules)\b/i, 3.0],
  [/\breveal (your|the) (prompt|instructions|system)\b/i, 3.0],
  [/\bas an ai (language )?model\b/i, 2.0],
  [/\bact as (a|an|if)\b/i, 1.6],
  [/\brepeat after me\b/i, 2.2],
  [/\boverride (the )?(rules|instructions|safety)\b/i, 2.6],
  [/\bprompt injection\b/i, 3.0],
  [/<\s*script\b/i, 2.4],
];

const ABUSE_SIGNALS = [
  [/\b(buy|get) (followers|backlinks|traffic|leads) (cheap|fast|now)\b/i, 3.0],
  [/\b(forex|crypto|binary options) (signals|bot|profits?)\b/i, 3.0],
  [/\b100% (free|guaranteed) (money|profit|returns)\b/i, 3.0],
  [/\bclick (here|this link)\b/i, 1.8],
  [/\bunsubscribe\b/i, 1.2],
  [/\bseo (backlinks|services|packages)\b/i, 2.2],
  [/\bviagra|casino|loan approved\b/i, 3.0],
];

const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const logistic = (x) => 1 / (1 + Math.exp(-x));
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;

function sumSignals(patterns, text) {
  let total = 0;
  const matched = [];
  for (const [re, weight] of patterns) {
    if (re.test(text)) {
      total += weight;
      matched.push(re.source);
    }
  }
  return { total, matched };
}

function pickChoice(signals, text) {
  const scored = Object.entries(signals).map(([label, patterns]) => {
    const { total } = sumSignals(
      patterns.map((re) => [re, 1]),
      text
    );
    return { label, score: total };
  });
  scored.push({ label: "other", score: 0.4 });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1] || { score: 0 };
  const margin = top.score - second.score;
  const confidence = clamp01(0.42 + margin * 0.18);
  return { value: top.score > 0.5 ? top.label : "other", confidence };
}

export function scoreHeuristic(lead) {
  const text = `${lead.title || ""}\n${lead.body || ""}`;
  const noise = hash(String(lead.id || text));
  const jitter = (noise - 0.5) * 0.04;

  const pos = sumSignals(INTENT_POSITIVE, text);
  const neg = sumSignals(INTENT_NEGATIVE, text);
  const intentSum = pos.total + neg.total;
  const intentP = clamp01(logistic(intentSum - 1.5));
  const intentConf = clamp01(0.5 + Math.abs(intentP - 0.5) * 1.1 + jitter);

  const inj = sumSignals(INJECTION_SIGNALS, text);
  const abuse = sumSignals(ABUSE_SIGNALS, text);
  const capsWords = (text.match(/\b[A-Z]{5,}\b/g) || []).length;
  const abuseBoost = capsWords >= 4 ? 1.6 : 0;
  const injP = clamp01(
    Math.max(logistic(inj.total - 1.0), logistic(abuse.total + abuseBoost - 1.5))
  );
  const injConf = clamp01(0.55 + Math.abs(injP - 0.5) * 1.0 + jitter);

  const urg = sumSignals(URGENCY_SIGNALS, text);
  const question = /\?\s*$/.test(text.trim()) ? 0.4 : 0;
  const urgencyValue = Math.min(10, Math.max(1, Math.round(2 + urg.total + question)));
  const urgencyConf = clamp01(0.42 + urg.matched.length * 0.07 + 0.02 * Math.min(6, text.length / 200) + jitter);

  const industry = pickChoice(INDUSTRY_SIGNALS, text);
  const pain = pickChoice(PAIN_SIGNALS, text);

  const answers = {
    intent: { value: intentP >= 0.5, probability: round(intentP), confidence: round(intentConf) },
    injection: { value: injP >= 0.5, probability: round(injP), confidence: round(injConf) },
    urgency: { value: urgencyValue, confidence: round(urgencyConf) },
    industry: { value: industry.value, confidence: round(clamp01(industry.confidence + jitter)) },
    painPoint: { value: pain.value, confidence: round(clamp01(pain.confidence + jitter)) },
  };

  return {
    provider: "heuristic",
    model: "intent-sniper-heuristic-v1",
    latencyMs: 0,
    answers,
    overallConfidence: overallConfidence(answers),
    notes: [...pos.matched, ...inj.matched, ...abuse.matched].slice(0, 6),
  };
}

export default scoreHeuristic;
