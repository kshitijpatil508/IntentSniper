import config from "./config.js";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const TIERS = {
  auto: "High confidence + high score -> auto-route to SDR",
  review: "Medium confidence -> human BDR triage",
  quarantine: "Low confidence / adversarial / spam -> review queue",
  nurture: "Low intent -> standard queue",
};

export function routeLead(score, cfg = config.routing) {
  const intent = score?.answers?.intent ?? { probability: 0, confidence: 0 };
  const injection = score?.answers?.injection ?? { probability: 0, confidence: 0 };
  const urgency = score?.answers?.urgency?.value ?? 1;
  const confidence = Number.isFinite(intent.confidence)
    ? intent.confidence
    : Number.isFinite(score?.overallConfidence)
      ? score.overallConfidence
      : 0;
  const reasons = [];

  const priority = clamp(
    Math.round(intent.probability * 60 + urgency * 3 + confidence * 20 - injection.probability * 60),
    0,
    100
  );

  if (injection.probability >= cfg.injectionThreshold) {
    reasons.push(
      `injection probability ${injection.probability} >= ${cfg.injectionThreshold}`
    );
    return { route: "quarantine", priority: Math.min(priority, 20), reasons, tier: TIERS.quarantine };
  }

  if (
    intent.probability >= cfg.autoIntent &&
    confidence >= cfg.autoConfidence &&
    urgency >= cfg.autoUrgency
  ) {
    reasons.push(
      `intent ${intent.probability} >= ${cfg.autoIntent}`,
      `intent confidence ${confidence} >= ${cfg.autoConfidence}`,
      `urgency ${urgency} >= ${cfg.autoUrgency}`
    );
    return { route: "auto", priority, reasons, tier: TIERS.auto };
  }

  if (intent.probability >= cfg.reviewIntent) {
    reasons.push(
      `intent ${intent.probability} >= ${cfg.reviewIntent}`,
      confidence < cfg.autoConfidence
        ? `intent confidence ${confidence} below auto bar ${cfg.autoConfidence}`
        : `urgency ${urgency} below auto bar ${cfg.autoUrgency}`
    );
    return { route: "review", priority, reasons, tier: TIERS.review };
  }

  reasons.push(`intent ${intent.probability} < ${cfg.reviewIntent}`);
  return { route: "nurture", priority, reasons, tier: TIERS.nurture };
}

export default routeLead;
