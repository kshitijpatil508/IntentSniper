import config from "../config.js";

export const name = "github";
export const description = "GitHub issue search monitor across configured queries";
export const enabledByDefault = true;

const BASE = "https://api.github.com/search/issues";

function mapItem(item) {
  if (!item) return null;
  const repo =
    (item.repository_url || "").split("/repos/")[1] ||
    item.repository?.full_name ||
    "unknown";
  return {
    id: `github:${repo}#${item.number}`,
    source: "github",
    community: repo,
    author: item.user?.login || "unknown",
    title: item.title || "",
    body: item.body || "",
    url: item.html_url || "",
    createdAt: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString(),
    engagement: {
      score: item.reactions?.total_count ?? 0,
      comments: item.comments || 0,
    },
    raw: {
      repo,
      number: item.number,
      state: item.state,
      labels: (item.labels || []).map((l) => l.name).slice(0, 8),
    },
  };
}

export async function fetchLeads({ limit = 25, signal } = {}) {
  const queries = config.github?.queries || [];
  const token = config.github?.token || "";
  const userAgent = config.github?.userAgent;
  const perPage = Math.min(limit, config.github?.perQuery ?? limit);

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": userAgent,
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let attempted = 0;
  let failed = 0;
  const leads = [];

  for (const query of queries) {
    attempted += 1;
    const url = `${BASE}?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${perPage}`;
    try {
      const res = await fetch(url, { signal, headers });
      if (!res.ok) {
        failed += 1;
        continue;
      }
      const payload = await res.json();
      const items = payload?.items || [];
      for (const item of items) {
        const lead = mapItem(item);
        if (lead) leads.push(lead);
      }
    } catch {
      failed += 1;
    }
  }

  if (attempted > 0 && failed === attempted) {
    throw new Error(`github: all ${attempted} queries failed`);
  }

  const seen = new Set();
  const deduped = [];
  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    deduped.push(lead);
  }

  return deduped;
}
