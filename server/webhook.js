import config from "./config.js";

function payloadFor(lead) {
  const intent = lead.score?.answers?.intent?.probability ?? 0;
  const urgency = lead.score?.answers?.urgency?.value ?? 0;
  const industry = lead.score?.answers?.industry?.value ?? "other";
  const line = `HOT LEAD [${industry}] intent=${intent} urgency=${urgency} :: ${lead.title}`;

  return {
    content: line,
    text: line,
    lead: {
      id: lead.id,
      source: lead.source,
      community: lead.community,
      url: lead.url,
      priority: lead.routing?.priority ?? 0,
    },
  };
}

export async function dispatch(lead, options = {}) {
  const url = options.url ?? config.webhook.url;
  if (!url) return { delivered: false, reason: "no webhook configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFor(lead)),
    });
    if (!response.ok) return { delivered: false, reason: `HTTP ${response.status}` };
    return { delivered: true };
  } catch (error) {
    return { delivered: false, reason: error.message };
  } finally {
    clearTimeout(timer);
  }
}

export default dispatch;
