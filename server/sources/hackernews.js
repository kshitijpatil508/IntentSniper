import config from "../config.js";

export const name = "hackernews";
export const description = "Hacker News stories and comments via the free Algolia API.";
export const enabledByDefault = true;

const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";

function normalize(hit, tag) {
  const objectID = hit.objectID;
  const title = hit.title || hit.story_title || "";
  const body = tag === "comment" ? hit.comment_text || "" : hit.story_text || "";
  const url =
    hit.url ||
    hit.story_url ||
    `https://news.ycombinator.com/item?id=${objectID}`;

  return {
    id: `hn:${objectID}`,
    source: "hackernews",
    community: "Hacker News",
    author: hit.author || "unknown",
    title: stripHtml(title),
    body: stripHtml(body),
    url,
    createdAt: new Date((hit.created_at_i || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    engagement: { score: hit.points || 0, comments: hit.num_comments || 0 },
    raw: { objectID, tag, story_id: hit.story_id || null },
  };
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

async function search(query, tag, hitsPerQuery, signal) {
  const url = `${ALGOLIA}?query=${encodeURIComponent(query)}&tags=${tag}&hitsPerPage=${hitsPerQuery}`;
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`algolia ${response.status}`);
  const payload = await response.json();
  return (payload.hits || []).map((hit) => normalize(hit, tag));
}

export async function fetchLeads({ limit = 25, signal } = {}) {
  const queries = config.hackernews.queries;
  const tags = config.hackernews.tags;
  const hitsPerQuery = Math.min(config.hackernews.hitsPerQuery, Math.max(limit, 1));

  const results = await Promise.allSettled(
    queries.flatMap((query) => tags.map((tag) => search(query, tag, hitsPerQuery, signal)))
  );

  const leads = [];
  let failures = 0;
  for (const result of results) {
    if (result.status === "fulfilled") leads.push(...result.value);
    else failures += 1;
  }

  if (failures === results.length && results.length > 0) {
    throw new Error(`all ${results.length} hackernews queries failed`);
  }

  const seen = new Set();
  const unique = [];
  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    unique.push(lead);
  }

  return unique
    .filter((lead) => lead.engagement.score >= config.hackernews.minPoints)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export default { name, description, enabledByDefault, fetchLeads };
