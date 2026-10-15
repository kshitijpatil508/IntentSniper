import config from "../config.js";

export const name = "reddit";
export const description = "Reddit new-listing monitor across configured subreddits";
export const enabledByDefault = true;

const BASE = "https://www.reddit.com";

function isJson(contentType) {
  return typeof contentType === "string" && contentType.includes("application/json");
}

function mapChild(d) {
  if (!d) return null;
  const id = `reddit:${d.name || d.id}`;
  const community = `r/${d.subreddit}`;
  const permalink = d.permalink;
  return {
    id,
    source: "reddit",
    community,
    author: d.author,
    title: d.title,
    body: d.selftext || "",
    url: permalink ? `${BASE}${permalink}` : d.url || "",
    createdAt: new Date((d.created_utc || 0) * 1000).toISOString(),
    engagement: { score: d.score || 0, comments: d.num_comments || 0 },
    raw: {
      subreddit: d.subreddit,
      over_18: !!d.over_18,
      link_flair_text: d.link_flair_text || null,
    },
  };
}

export async function fetchLeads({ limit = 25, signal } = {}) {
  const subs = config.reddit?.subreddits || [];
  const listing = config.reddit?.listing || "new";
  const userAgent = config.reddit?.userAgent;
  const perSub = Math.min(limit, 100);

  let attempted = 0;
  let failed = 0;
  const leads = [];

  for (const sub of subs) {
    attempted += 1;
    const url = `${BASE}/r/${sub}/${listing}.json?limit=${perSub}&raw_json=1`;
    try {
      const res = await fetch(url, {
        signal,
        headers: {
          "user-agent": userAgent,
          accept: "application/json",
        },
      });
      if (!res.ok || !isJson(res.headers.get("content-type"))) {
        failed += 1;
        continue;
      }
      const payload = await res.json();
      const children = payload?.data?.children || [];
      for (const child of children) {
        const lead = mapChild(child?.data);
        if (lead) leads.push(lead);
      }
    } catch {
      failed += 1;
    }
  }

  if (attempted > 0 && failed === attempted) {
    throw new Error(`reddit: all ${attempted} subreddits failed`);
  }

  const seen = new Set();
  const deduped = [];
  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    deduped.push(lead);
  }

  return deduped.slice(0, Math.max(0, limit));
}
