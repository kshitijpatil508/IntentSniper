# TypeSafe Jev: Lead Acquisition & Hackathon Guide

## Original Prompt & Context

> **Background Context:**
> Lead acquisition. The work is high-volume scoring and routing of text against explicit criteria, which is what Jev is built for. TypeSafe’s use-case map lists ICP matching, industry fit, buyer intent, pain points and lead prioritization. Its closest proof point is the Jack & Jill case study: screening about 6,000 candidates per role, with 88% lower cost, about 2x faster, and the same quality as Gemini Flash Lite. Leads work the same way: many cheap judgments, then a confidence threshold decides whether to auto-route or send to a human. The caveats are that inbound messages are untrusted text that can try to steer the model, and it works best in English.
>
> **Goal:**
> Explore how lead acquisition works with TypeSafe Jev, discover hackathon project ideas, and identify 100% free, zero-API-key data sources for sourcing leads.

---

## How Lead Acquisition Works with Jev

In a typical inbound lead funnel, thousands of messy data points arrive daily: website contact forms, demo booking requests, survey responses, or scraped social posts. Traditional generative LLMs (like GPT-4 or Claude) are expensive and slow ($0.50–$3.00/M tokens, ~1–3s latency) because they generate unstructured text that must be parsed into JSON.

**TypeSafe Jev** functions differently:
1. **Decision Model vs. Generative Model:** Jev does not write sentences; it strictly evaluates a piece of state (the lead's text) against explicit typed questions (`Noul` for boolean/probability, `Score` for 1–10 ordinal ratings, and `Choice` for discrete categorical classification).
2. **Parallel Single-Pass Evaluation:** You pass 5–10 criteria simultaneously (e.g., *Is enterprise?*, *Has immediate budget?*, *Urgency score*, *Industry match*). Jev calculates calibrated probability distributions and confidence scores across all of them in a single fast pass (~100 ms).
3. **Calibrated Confidence Gating:** Jev outputs both the answer and an independent **confidence score**. This unlocks three-tier automated routing:
   * **High confidence + High score:** Auto-route directly to VIP sales rep or trigger an instant webhook (e.g., Calendly invite).
   * **Medium confidence:** Flag for human BDR triage or enrich with an external tool before routing.
   * **Low confidence / adversarial / spam:** Send to a standard review queue or discard.

---

## Where to Get Free Leads (Zero Cost, No Paid APIs)

For a hackathon demo, you need high-volume, realistic inbound lead streams without paying for Apollo, ZoomInfo, or Clearbit:

| Source | How to Use | Cost / Limits |
|---|---|---|
| **Reddit Public JSON API** | Append `.json` to subreddits (e.g., `reddit.com/r/SaaS/new.json`, `r/smallbusiness`, `r/startups`). Scrape posts looking for software recommendations or pain points. | 100% free; no auth required for standard read requests. |
| **Hacker News Firebase API** | Query `hitem/{id}.json` for comments in monthly "Ask HN: Who is hiring?", "Show HN", or "Seeking Freelancer" threads. | Free, official, unlimited public JSON REST API. |
| **Kaggle / Hugging Face Datasets** | Download public B2B lead generation datasets (e.g., *B2B Sales CRM Leads*, *Job Postings & RFPs*, *E-commerce Customer Inquiries*). Load them into SQLite or mock a stream. | Completely free to download CSVs/Parquet. |
| **GitHub Issues & Discussions** | Use the GitHub REST API (60 req/hr unauthenticated, 5,000 req/hr with a free Personal Access Token) to fetch issues on open-source tools matching your ICP. | Free personal access token. |
| **Synthetic Stream Generator** | Write a small script using Python's `Faker` library or a free local Ollama instance to generate 500 varied inbound lead submissions (including spammers, prompt injectors, tire-kickers, and enterprise buyers). | Zero cost, running locally. |

---

## Hackathon Project Ideas

### 1. "Zero-Latency" Inbound Triage & SDR Router (The Enterprise Choice)
* **The Concept:** A live dashboard showing a simulated firehose of incoming B2B contact forms.
* **Architecture:**
  * **Ingestion:** A webhook endpoint receiving form fills (from a mock landing page or Reddit/HN queries).
  * **Jev Layer:** Parallel evaluation of 4 questions:
    * `Choice` (Industry/Use Case): `[fintech, healthcare, devtools, ecommerce, other]`
    * `Noul` (B2B Intent): Is the submitter seeking a commercial enterprise solution?
    * `Score` (Budget/Seat Size): Estimated buying capacity scale (1–5).
    * `Noul` (Prompt Injection/Jailbreak): Does the message attempt prompt injection or off-topic abuse?
  * **Decision Engine:** If intent $> 0.85$ and confidence $> 0.8$, auto-assign to an SDR via Discord/Slack webhook. If confidence is low, push to a manual review queue.

### 2. "IntentSniper" – Real-Time Social Listening & High-Intent RFP Catcher
* **The Concept:** Monitor public tech feeds (Hacker News, Reddit, GitHub) to instantly flag buyers actively looking for a product in your niche.
* **Architecture:**
  * Pull new posts every 30 seconds from `r/devops` or `r/webdev`.
  * Pass raw post titles + bodies to Jev to answer:
    * `Noul`: Is the author looking for a commercial product/service recommendation?
    * `Score` (1–10): Urgency of implementation.
    * `Choice`: Primary pain point `[security, performance, cost, compliance, other]`.
  * Display a live feed in the UI, highlighting "Hot Deals" in real time with Jev's confidence badges.

### 3. Freelancer / Agency Upwork & Job Feed Auto-Scorer
* **The Concept:** Independent contractors and agencies drown in bad gig postings. This app scores public freelance/job boards against custom criteria in under 100 ms.
* **Architecture:**
  * Ingest public Upwork RSS feeds or job listings.
  * Score against your personal ICP: *Fixed price vs. hourly match*, *Technical complexity (1–10)*, *Vague requirement warning (Noul)*.
  * Calculate an expected value metric and trigger an instant desktop notification for 9/10+ matches.

---

## Free Hackathon Tech Stack

* **TypeSafe Jev Access:** TypeSafe grants initial free trial credits upon signing up at `console.typesafe.ai` ($5 in credits covers millions of input tokens at $0.042/M). If signups are throttled, access Jev directly through **Vercel AI Gateway** (model name: `typesafe-ai/jev`) using Vercel’s free tier.
* **Backend:** Node.js / FastAPI running locally or on a free Render/Fly.io instance.
* **Database / Cache:** Free tier Supabase (PostgreSQL) or local SQLite.
* **Frontend:** Next.js, Vite + React, or a simple Streamlit / Tailwind dashboard.
* **Lead Stream:** Reddit public JSON endpoints + Faker generator for adversarial edge cases (prompt injection tests).