# FOIA Fluent — Token Usage & Cost Analysis

A complete breakdown of every Claude API call in the product, with token estimates, per-call USD cost, and per-user-tier monthly cost projections to inform pricing tiers.

> **Methodology.** Token counts are estimated using Anthropic's rule of thumb (1 token ≈ 4 English characters) plus inspection of system prompt sizes from the source. Output tokens are typically ~50–80% of `max_tokens`. Pricing uses public list prices as of late 2025: **Claude Sonnet 4** = $3.00/MTok input, $15.00/MTok output. **Claude Haiku 4.5** = $1.00/MTok input, $5.00/MTok output. (MTok = 1 million tokens.) No prompt caching is currently used; all numbers below are uncached.
>
> All cost figures are **costs to us** (vendor cost), not user-facing prices. See the [Pricing Tier Recommendations](#pricing-tier-recommendations) section for suggested user-facing prices.

---

## Quick Reference: Vendor Cost per Call

| Flow | Endpoint | Model | Calls per action | Typical $/call | Typical $/action |
|---|---|---|---|---|---|
| Query interpretation | `/search` | Sonnet 4 | 1 | $0.008 | $0.008 |
| Agency identification | `/draft/identify-agency` or in `/search` | Sonnet 4 | 1 | $0.011 | $0.011 |
| Letter drafting | `/draft/generate` | Sonnet 4 | 1 | $0.060 | $0.060 |
| **Search & Draft (full flow)** | combined | Sonnet 4 | **3** | — | **$0.079** |
| Response analysis | `/analyze-response` | Sonnet 4 | 1 | $0.035 | $0.035 |
| Response analysis (with PDF) | `/analyze-response` | Sonnet 4 | 1 | $0.090 | $0.090 |
| Follow-up letter | `/generate-letter?type=follow_up` | Sonnet 4 | 1 | $0.029 | $0.029 |
| Appeal letter | `/generate-letter?type=appeal` | Sonnet 4 | 1 | $0.039 | $0.039 |
| Import existing letter | `/tracking/requests/import` | Sonnet 4 | 1–2 | $0.035 | $0.035–$0.070 |
| Chat message (typical) | `/chat` | Haiku 4.5 | 2 rounds | $0.003 | $0.007 |
| Chat message (tool-heavy) | `/chat` | Haiku→Sonnet | 5 rounds | mixed | $0.042 |
| News digest refresh | scheduled cron | Haiku 4.5 | 1 | $0.014 | $0.014/run |
| Agency profile expansion | manual script | Haiku 4.5 | 150–250 | $0.001 | $0.20–$0.30/run |

The single most expensive user action is **letter drafting at ~$0.06**. The single cheapest is a **chat message at <$0.01**. A complete "search → draft → file → analyze response → generate appeal" round trip costs roughly **$0.16 per request**.

---

## 1. Search & Draft Flow

**User action.** User types a natural-language description of the records they want. The system interprets the query, picks the best agency, runs intelligence research, and generates a complete FOIA letter.

**Total Claude calls per full Search & Draft flow: 3** (query interpretation + agency identification + letter drafting). Intel research and similar-request lookups are Tavily/MuckRock, not Claude.

### 1.1 Query Interpretation

| Field | Value |
|---|---|
| Source | [backend/app/services/query_interpreter.py:45](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/query_interpreter.py#L45) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 1,000 |
| System prompt | ~190 input tokens (~750 chars hardcoded) |
| User input | ~80 tokens (1–3 sentences from user) |
| **Typical input** | **~270 tokens** |
| **Typical output** | **~500 tokens** (50% of cap) |
| **Vendor cost / call** | **$0.0083** = (270 × $3 + 500 × $15) / 1M |
| Frequency | Once per `/api/v1/search` call |
| Streaming | One-shot |
| Tools | None |

### 1.2 Agency Identification

| Field | Value |
|---|---|
| Source | [backend/app/services/drafter.py:162](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/drafter.py#L162) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 1,000 |
| System prompt | ~1,500 input tokens (includes federal agency summary list) |
| User input | ~100 tokens |
| **Typical input** | **~1,600 tokens** |
| **Typical output** | **~400 tokens** |
| **Vendor cost / call** | **$0.0108** = (1,600 × $3 + 400 × $15) / 1M |
| Frequency | Once per `/search` and once per `/draft/identify-agency` |
| Streaming | One-shot |
| Tools | None |

### 1.3 Letter Drafting

| Field | Value |
|---|---|
| Source | [backend/app/services/drafter.py:384](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/drafter.py#L384) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 3,000 |
| System prompt | ~6,000+ chars baseline; with full agency CFR text + similar requests + intel context, **~10,000 input tokens typical, up to ~15,000** |
| User input | included in system context above |
| **Typical input** | **~10,000 tokens** |
| **Typical output** | **~2,000 tokens** (a full FOIA letter) |
| **Vendor cost / call** | **$0.060** = (10,000 × $3 + 2,000 × $15) / 1M |
| Worst-case ($0.10+) | If agency has long CFR (e.g. DOJ) and rich intel: 15K in / 3K out → **$0.090** |
| Frequency | Once per `/draft/generate` |
| Streaming | One-shot |
| Tools | None |

### Search & Draft — Per-Action Total

- **Typical:** $0.0083 + $0.0108 + $0.060 = **$0.079**
- **Worst case (huge CFR agency):** ~$0.11
- **Best case (small CFR, terse output):** ~$0.04

---

## 2. My Requests (Tracking) Flow

User flow: file → log responses → analyze → generate follow-up or appeal letters as needed.

### 2.1 Response Analysis

| Field | Value |
|---|---|
| Source | [backend/app/services/response_analyzer.py:134](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/response_analyzer.py#L134) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 2,000 |
| System prompt | ~1,000 tokens (statute + exemptions + appeal rights references) |
| User input | original letter (~500) + agency response (~500–3,000) + history (~500) |
| **Typical input (text-only)** | **~4,000 tokens** |
| **Typical input (with PDF/image attachments)** | **~20,000 tokens** (vision content blocks are token-heavy) |
| **Typical output** | **~1,500 tokens** (75% of cap) |
| **Vendor cost / call (text)** | **$0.0345** = (4,000 × $3 + 1,500 × $15) / 1M |
| **Vendor cost / call (with attachments)** | **~$0.090** |
| Frequency | Once per `/tracking/requests/{id}/analyze-response` |
| Streaming | One-shot |
| Tools | None (file processor pre-converts attachments to base64) |
| Retry logic | Yes — catches rate-limit/413, rolls back communication on failure |

### 2.2 Follow-Up Letter Generation

| Field | Value |
|---|---|
| Source | [backend/app/services/letter_generator.py:115](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/letter_generator.py#L115) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 2,000 |
| System prompt | ~300 tokens (time limit + appeal rights + instructions) |
| User input | ~1,500 tokens (original request + deadline info) |
| **Typical input** | **~2,000 tokens** |
| **Typical output** | **~1,500 tokens** |
| **Vendor cost / call** | **$0.0285** = (2,000 × $3 + 1,500 × $15) / 1M |
| Frequency | Once per `/generate-letter?type=follow_up` |

### 2.3 Appeal Letter Generation

| Field | Value |
|---|---|
| Source | [backend/app/services/letter_generator.py:166](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/letter_generator.py#L166) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 2,500 |
| System prompt | ~500 tokens (appeal rights + exemption context) |
| User input | ~2,500 tokens (original request + analysis summary + grounds) |
| **Typical input** | **~3,000 tokens** |
| **Typical output** | **~2,000 tokens** |
| **Vendor cost / call** | **$0.039** = (3,000 × $3 + 2,000 × $15) / 1M |
| Frequency | Once per `/generate-letter?type=appeal` |

### 2.4 Import Existing Request Analysis

| Field | Value |
|---|---|
| Source | [backend/app/services/request_analyzer.py:145](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/request_analyzer.py#L145) |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 2,000 |
| System prompt | ~6,000 chars + research context, ~4,000 input tokens typical |
| User input | included above |
| **Typical input** | **~4,000 tokens** |
| **Typical output** | **~1,500 tokens** |
| **Vendor cost / call** | **$0.0345** |
| Frequency | Once per `/tracking/requests/import` (twice if existing_response provided — runs response analysis after) |

---

## 3. Chat Assistant Flow

The chat assistant uses an iterative tool-use loop with up to 5 rounds. It starts on **Haiku 4.5** for cost, and **escalates to Sonnet 4** if `search_web` returns no usable results (4-tier accuracy fallback).

| Field | Value |
|---|---|
| Source | [backend/app/services/chat.py:309](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L309) |
| Default model | `claude-haiku-4-5-20251001` |
| Escalation model | `claude-sonnet-4-20250514` |
| `max_tokens` | 2,000 per iteration |
| System prompt | ~875 input tokens (~3,500 chars: platform guide + tool defs + statute refs + exemptions) |
| Tools | 8 (lookup_exemption, lookup_agency, search_web, search_web_broad, search_requests, get_request_detail, get_hub_stats, search_muckrock) |
| Streaming | Yes (SSE) |
| Max tool rounds | 5 |
| Frequency | Per chat message |

### Chat Cost by Round Count

Each round = 1 API call. History accumulates so input grows each round.

| Scenario | Rounds | Total input tokens | Total output tokens | Model | **Cost** |
|---|---|---|---|---|---|
| Trivial (1 lookup) | 1 | 1,000 | 400 | Haiku | **$0.003** |
| Typical (1 tool call) | 2 | 2,500 | 800 | Haiku | **$0.0065** |
| Heavy (3 tool calls) | 4 | 6,000 | 1,500 | Haiku | **$0.0135** |
| Worst case (escalated) | 5 | 8,000 | 2,000 | mixed Haiku→Sonnet | **~$0.042** |

**Average cost per chat message: ~$0.007**

> **Note.** Without prompt caching, history is re-paid each round. Adding `cache_control` on the system prompt would cut chat cost by ~30% (system prompt is 875 tokens of the ~2,500 typical input). **Recommended optimization** — see [Cost Reduction Opportunities](#cost-reduction-opportunities) below.

---

## 4. Scheduled / Background Jobs

### 4.1 News Digest Refresh

| Field | Value |
|---|---|
| Source | [backend/app/scripts/refresh_news_digest.py:165](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/scripts/refresh_news_digest.py#L165) |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 2,000 |
| Input | ~4,000 tokens (30+ RSS items batched) |
| Output | ~2,000 tokens |
| **Cost per run** | **$0.014** |
| Cadence | Weekly |
| **Monthly cost** | **~$0.06** |

### 4.2 Agency Profile Expansion (one-time / on-demand)

| Field | Value |
|---|---|
| Source | [backend/app/scripts/expand_federal_profiles.py:154](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/scripts/expand_federal_profiles.py#L154) |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 500 |
| Calls per agency | 2–3 (submission_notes, routing_notes, cfr_summary) |
| Total calls per run | ~150–250 (~80 agencies × ~3 calls) |
| **Cost per call** | **~$0.001** |
| **Cost per full run** | **~$0.20–$0.30** |
| Cadence | Manual / on-demand |

### 4.3 No-Claude Refresh Scripts

These do **not** call Claude — pure data ingestion:
- `refresh_hub_stats.py` (federal agency stats from MuckRock)
- `refresh_jurisdiction_stats.py` (state stats from MuckRock)
- `refresh_insights_data.py` (FOIA.gov annual reports)

**Total scheduled-job vendor cost: ~$0.10–$0.50 / month** (negligible).

---

## 5. Per-User Monthly Cost Scenarios

These are **vendor cost estimates** for typical user behavior at different intensity levels. Used to derive pricing tiers.

### Light user (e.g. occasional citizen / student)

| Action | Volume / mo | Unit cost | Subtotal |
|---|---|---|---|
| Searches → Draft | 3 | $0.079 | $0.237 |
| Chat messages | 8 | $0.007 | $0.056 |
| Response analyses | 1 | $0.0345 | $0.0345 |
| Follow-up letters | 0 | — | — |
| **Total vendor cost** | | | **~$0.33 / mo** |

### Active individual (e.g. freelance journalist, NGO researcher)

| Action | Volume / mo | Unit cost | Subtotal |
|---|---|---|---|
| Searches → Draft | 25 | $0.079 | $1.98 |
| Chat messages | 100 | $0.007 | $0.70 |
| Response analyses | 12 | $0.0345 | $0.41 |
| Response analyses w/ PDFs | 4 | $0.090 | $0.36 |
| Follow-up letters | 5 | $0.0285 | $0.14 |
| Appeal letters | 2 | $0.039 | $0.08 |
| Imports | 3 | $0.0345 | $0.10 |
| **Total vendor cost** | | | **~$3.77 / mo** |

### Power user (e.g. investigative reporter at staff outlet)

| Action | Volume / mo | Unit cost | Subtotal |
|---|---|---|---|
| Searches → Draft | 80 | $0.079 | $6.32 |
| Chat messages | 400 | $0.007 | $2.80 |
| Response analyses | 40 | $0.0345 | $1.38 |
| Response analyses w/ PDFs | 15 | $0.090 | $1.35 |
| Follow-up letters | 20 | $0.0285 | $0.57 |
| Appeal letters | 8 | $0.039 | $0.31 |
| Imports | 10 | $0.0345 | $0.35 |
| **Total vendor cost** | | | **~$13.08 / mo** |

### Pro user (e.g. boutique law firm associate, environmental NGO researcher)

| Action | Volume / mo | Unit cost | Subtotal |
|---|---|---|---|
| Searches → Draft | 150 | $0.079 | $11.85 |
| Chat messages | 800 | $0.007 | $5.60 |
| Response analyses | 80 | $0.0345 | $2.76 |
| Response analyses w/ PDFs | 30 | $0.090 | $2.70 |
| Follow-up letters | 40 | $0.0285 | $1.14 |
| Appeal letters | 20 | $0.039 | $0.78 |
| Imports | 20 | $0.0345 | $0.69 |
| **Total vendor cost** | | | **~$25.52 / mo** |

### Enterprise heavy user (e.g. big-law associate, hedge-fund analyst, biotech CI team member)

| Action | Volume / mo | Unit cost | Subtotal |
|---|---|---|---|
| Searches → Draft | 400 | $0.079 | $31.60 |
| Chat messages | 2,500 | $0.007 | $17.50 |
| Response analyses | 200 | $0.0345 | $6.90 |
| Response analyses w/ PDFs | 100 | $0.090 | $9.00 |
| Follow-up letters | 100 | $0.0285 | $2.85 |
| Appeal letters | 50 | $0.039 | $1.95 |
| Imports | 50 | $0.0345 | $1.73 |
| **Total vendor cost** | | | **~$71.53 / mo** |

> **Future addition: Live FOIA Signals** (planned section). When the Signals personalized feed ships, expect an additional **$2–$15/mo per active user** in vendor cost depending on watchlist size and AI summarization depth. Add to all tiers above.

---

## 6. Pricing Tier Recommendations

Standard SaaS markup is **5–10x vendor cost** to cover infrastructure, support, sales, and margin. For an AI-heavy product where the marginal cost is high, **5–7x** is more realistic.

| Tier | Audience | Limits | Vendor cost | **Suggested price** | Markup |
|---|---|---|---|---|---|
| **Free** | Citizens, students, occasional users | 5 searches/mo, 25 chat msgs/mo, 2 analyses/mo, no appeal letters | $0.50 | **$0** | loss leader |
| **Individual $9/mo** | Freelance journalists, advocates, researchers | 30 searches, 200 chat, 20 analyses, 10 letters/mo | $4 | **$9/mo** | 2.3x — promotional |
| **Pro $29/mo** | Staff reporters, mid-firm associates, NGO leads | 100 searches, 1,000 chat, 80 analyses, 50 letters, all features | $14 | **$29/mo** | 2.1x |
| **Team $79/seat/mo** | Newsrooms, NGOs, mid-size law firms (3+ seats) | Pro limits per seat + collaboration + watchlists + export | $20 | **$79/seat** | 4x |
| **Enterprise** | Big law, hedge funds, big pharma, large agencies | Unlimited usage, SSO, audit log, priority API, custom Signals personas | $75–$200/seat | **$300–$1,000/seat/mo** | 4–5x |
| **Live FOIA Signals (add-on)** | Pro/Team/Enterprise add-on | Personalized realtime feed, watchlists, alerts | +$2–$15 | **+$49/mo (Pro) / $199/mo (Team) / custom (Ent)** | 4–10x |

### Pricing rationale notes

- **Free tier** is loss-leading by design — drives signups, builds corpus, brand. Cap aggressively (5 searches is the right number to feel value but force upgrade for any real workflow).
- **$9 Individual** is below market for what's offered but reflects journalism/NGO reality. Most competitors (MuckRock paid tier, FOIA Mapper) are in the $5–$20 range for individuals. This tier should not be profitable on margin alone — it pays for itself via word-of-mouth + corpus contributions.
- **$29 Pro** is the **true core revenue tier**. Aim to get 80% of paying users here. Margin: $29 - $14 = $15/seat/mo gross profit before infra/support/sales.
- **$79 Team** captures the small-newsroom and NGO segment. The 4x markup is justified by the team features (collaboration, shared watchlists, exports) and lower support burden per seat than individual users.
- **Enterprise** is where the real revenue is. Big law, hedge funds, and pharma CI teams have $25k–$1M/seat budgets for analogous tools (GovTribe, BGOV, Bloomberg Terminal, alt-data feeds). $300–$1,000/seat/mo is **conservative** for those segments — start at $300/seat with usage-based add-ons, negotiate up. Annual contracts only.
- **Signals add-on** is the differentiator. Don't bundle it with base tiers — sell it separately so we can price it independently as the data layer matures and as competitor pricing data comes in.

---

## 7. Cost Reduction Opportunities

Implementing these would meaningfully cut vendor cost without changing user experience.

### 7.1 Prompt caching (highest leverage — implement first)

Anthropic supports prompt caching with `cache_control` blocks. Cache reads cost **$0.30/MTok** for Sonnet vs $3.00/MTok uncached — **a 10x reduction** on cached content.

Highest-value targets:
- **Letter drafting system prompt** (~10K input tokens, mostly static statute + agency CFR text) — caching here cuts each draft from ~$0.060 to ~$0.018, a **70% savings on the most expensive call**.
- **Response analysis system prompt** (~1,000 tokens of statute references) — modest savings.
- **Chat system prompt** (~875 tokens) — saves ~25% per chat round.

**Estimated overall savings if implemented across the top 3 flows: 40–50% of total Claude spend.** This alone could halve the vendor cost in every tier above.

### 7.2 Move chat to Haiku-only by default

Currently chat starts on Haiku and escalates to Sonnet on `search_web` miss. The escalation rate is unknown — measure it. If <20% of messages escalate, the overall chat cost is already cheap. If >50%, consider improving the trusted search pool instead of relying on Sonnet escalation.

### 7.3 Cap response analysis attachment size

PDF response analyses cost ~$0.09 vs $0.035 for text-only — a **2.6x premium** driven by vision tokens. Add a soft cap (e.g. 20-page max, ~2 PDFs per request) and warn users above that. Alternatively, OCR PDFs locally first and pass extracted text only — eliminates the vision premium entirely.

### 7.4 Smaller default `max_tokens` for letter drafting

Current cap is 3,000. Average actual output is ~2,000. Lowering the cap doesn't directly save money (you only pay for tokens used) but encourages tighter outputs. No-op for cost; possibly worth it for UX.

### 7.5 Move Search & Draft query interpretation to Haiku

Query interpretation is a simple structured-output task that Haiku 4.5 handles well. Switching saves ~$0.006 per search (~75% reduction on that step alone). Acceptable quality risk; **A/B test before committing.**

---

## 8. What's NOT Counted

These are cost drivers that exist outside Claude API and need separate accounting before final pricing:

| Cost | Notes |
|---|---|
| **Tavily search API** | Used in chat tools + drafter intel research. Pricing: $0.005/search at low tiers. Estimate ~5–20 searches per Search & Draft flow → **$0.025–$0.10 per draft**. Not negligible — verify Tavily plan. |
| **MuckRock API** | Free for reasonable usage; rate-limited. No marginal cost. |
| **Supabase** | Free tier covers MVP. Paid: $25/mo + usage. Negligible per-user. |
| **Railway hosting** | ~$5–$50/mo backend. Fixed cost, not per-user. |
| **Vercel hosting** | Free Hobby tier currently. Pro is $20/mo if needed. |
| **eCFR + FOIA.gov APIs** | Free, US government. |
| **Sentry / monitoring** | Free tier sufficient. |
| **Email (OTP via Supabase)** | Free up to ~100/mo, then $$. Enterprise tier should switch to Resend or SES. |

**Realistic non-Claude variable cost per active user: ~$0.50–$2/mo** (mostly Tavily). Add to vendor cost estimates above when finalizing pricing.

---

## 9. Token Estimation Methodology Notes

**These numbers are estimates, not measurements.** Real cost should be measured with Anthropic's [usage tracking](https://docs.anthropic.com/en/api/messages) once production traffic exists. Until then, treat the per-call costs as ±30% accurate.

To improve accuracy, instrument:
1. **Log every Claude call's `usage.input_tokens` and `usage.output_tokens`** (returned in the response). Anthropic's SDK exposes these on every response.
2. **Tag each call with the flow name** (search, draft, analyze, chat, etc.) so spend can be attributed in dashboards.
3. **Build a daily/weekly Claude spend dashboard** broken down by flow and user tier. This unlocks evidence-based pricing iteration after launch.

A 1-week measurement of real production traffic would replace this entire document with actuals. Highly recommended before launching any paid tier.

---

## Appendix: Anthropic Pricing Reference (late 2025)

| Model | Input ($/MTok) | Output ($/MTok) | Cached input ($/MTok) |
|---|---|---|---|
| Claude Opus 4 | $15.00 | $75.00 | $1.50 |
| **Claude Sonnet 4** (used in most flows) | **$3.00** | **$15.00** | **$0.30** |
| **Claude Haiku 4.5** (used in chat + scripts) | **$1.00** | **$5.00** | **$0.10** |

Verify current pricing at https://docs.anthropic.com/en/docs/about-claude/pricing before finalizing tiers.
