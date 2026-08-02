# Natively Roadmap

## Vision

A real-time AI copilot for sales reps on live calls — and for the hour after the call ends.

Natively listens to the call, retrieves from the rep's own reference material (product decks, pricing sheets, case studies, battlecards, prospect research), and surfaces the next thing to say while the call is still happening. Everything else the app currently does is being removed.

> **Scope note.** The product is being narrowed from a multi-purpose meeting copilot to a sales-call-only tool. The full audit, removal plan, and open decisions live in [`SALES_SCOPE_PLAN.md`](./SALES_SCOPE_PLAN.md). This roadmap is the forward-looking half of that document.

**How to read this file.** **Planned** = agreed direction, not started. **In progress** = actively being worked on. **Under review** = needs a product or architecture call before any work starts. Sizing is relative — **small** (days), **medium** (weeks), **large** (months). No dates, no version numbers, no delivery commitments. Nothing here is shipped.

The product name stays **Natively** for now — the rename is a separate, later phase with its own migration risk (`SALES_SCOPE_PLAN.md` §3).

---

## Near-term: scope reduction

**Status: in progress.** Sequencing detail in `SALES_SCOPE_PLAN.md` §2 and §6; day-to-day status in `SALES_SCOPE_HANDOFF.md`.

This is the prerequisite for most of what follows. It ships a focused product with the brand untouched and zero risk to existing installs.

| Phase | Content | Size | Status |
|---|---|---|---|
| 0 | `README.md` liability cleanup (interview-cheating SEO block, competitor positioning, testimonials) + GitHub repo topics | small | Done |
| 1 | Clean deletions — subsystems with no sales-core importers | small | Done |
| 2 | Shimmed deletions — extract the credential bootstrap out of `ProcessingHelper` first, then stub and delete | small | Done |
| 3 | Mode collapse in `electron/services/ModesManager.ts` and its five hand-mirrored copies, **plus a DB migration** — `template_type` is a persisted row in `electron/db/DatabaseManager.ts` | medium | Code complete, test suite being confirmed |
| 4 | `AnswerType` narrowing in `electron/llm/AnswerPlanner.ts` — **delete the Profile Intelligence backend first, then narrow the enum, then remove the `resume`/`jd`/`negotiation` context layers** (see `SALES_SCOPE_HANDOFF.md` for why this order matters) | medium | Not started |
| 5 | Docs, test cull, i18n regeneration | small | In progress — this document and `README.md` |

Two things must not be lost in the pruning:

- **The mode reference-file retrieval layer stays.** `electron/services/ModeContextRetriever.ts`, `electron/services/modes/ModeHybridRetriever.ts`, and `electron/rag/` are what make battlecards and pricing sheets work. Tier 1 (d) and (e) below depend on them.
- **`electron/services/knowledge/` is a split, not a delete.** The card, graph, and evidence engine is reused in Tier 2 (f); only the résumé-shaped card templates go.

---

## Tier 1 — Cheap wins on existing seams

**Status: Planned.** These sit on wiring that already runs end to end. Each is small unless noted.

### a) LLM-backed qualification extraction (MEDDIC)

**Planned · small**

`salesMeddic()` in `electron/services/meeting/MeetingRecipes.ts` runs a regex over section *titles* and re-buckets whatever bullets landed there. Because the sales note sections are titled "Pain points" and "Budget / timeline / authority", *Metrics* and *Economic buyer* resolve to the same source and duplicate content. There is no per-letter scoring, no confidence, and no gap detection.

- Replace it with a `generateStructured()` call. The pattern is proven next door in `electron/services/meeting/FollowUpDraftGenerator.ts` and `electron/services/meeting/SectionPromptCompiler.ts`.
- Add a `qualification` block to `MeetingSummaryV3` and its sanitizer (`electron/services/meeting/MeetingSummaryV3.ts`).
- **Blocker to confirm first:** `recipes` is declared in the UI type in `src/components/MeetingDetails.tsx` but has no render path. The recipe output may be generated, stored, and never displayed. Verify before building on top of it.

### b) LLM call coaching and scoring

**Planned · small**

`electron/services/post-call/PostCallWorkflow.ts` holds the only call-scoring code in the repo: two regex rules (`missed_objection`, `missing_next_step`). `CoachingInsight` carries no numeric score.

- Swap the regex rules for an LLM rubric with per-dimension scores and evidence spans.
- The seam is already wired: invoked from `electron/MeetingPersistence.ts`, rendered in `src/components/MeetingDetails.tsx`.

### c) Talk-ratio and talk-time analytics

**Planned · small (post-call) / medium (live)**

No talk-time, speaker-share, or monologue metrics exist today — but the raw data does. `electron/services/meeting/SpeakerLabelService.ts` and `electron/services/meeting/TranscriptNormalizer.ts` already carry per-segment speaker and timestamp.

- Post-call metrics module beside them: talk ratio, longest monologue, question count, patience after questions.
- Live in-call ratio ("you've been talking for four minutes") needs a new streaming consumer in `electron/IntelligenceEngine.ts` — medium.

### d) Data-driven battlecards

**Planned · small**

`electron/services/dynamic-actions/DynamicActionDetector.ts` hardcodes a competitor list as a regex and instructs the model to "position Natively's advantages" — our own dogfood config shipped as product behaviour.

- Drive competitor triggers from the indexed battlecard instead of a constant. `tests/fixtures/modes/sales/sales_competitor_battlecard.md` shows the retrieval path already carries them.
- Ingestion (`electron/services/ModeReferenceFileIngestion.ts`), retrieval (`ModeContextRetriever` + `electron/rag/`), and the `<injected_context>` reference-file type cues in `electron/llm/prompts.ts` all exist.

### e) Configurable pricing policy

**Planned · small**

The pricing *guardrails* — walk-away price, BATNA, discount-floor suppression — are the best-covered logic in the repo, enforced independently in `electron/llm/prompts.ts` and `electron/llm/tinyPrompts.ts`. What is missing is customer-configurable *policy*: approved discount ladders, concession trades, approval thresholds.

- Ships as a structured reference file through the path `tests/fixtures/modes/sales/sales_pricing_policy.json` already exercises. No new subsystem.

### Sales methodology packs

**Planned · small**

`electron/services/skills/` is a markdown instruction-pack loader (drop a `SKILL.md` file, invoke it from the overlay chat). The engine stays live — only its settings-panel UI was removed in the Phase 1 cleanup (`SALES_SCOPE_PLAN.md` §4). It is the cheapest possible host for MEDDIC / Challenger / Sandler coaching packs without touching prompt code — nobody has written those packs yet.

---

## Tier 2 — Deal context

**Status: Planned.** Medium to large. These need new schema but reuse existing machinery.

### f) Repoint the knowledge graph at accounts and deals

**Planned · large**

`electron/services/knowledge/` is a working structured-knowledge stack — `OkfCardBuilder.ts`, `GraphExtractor.ts`, `GraphRetriever.ts`, `KnowledgePackStore.ts`, `EvidenceAssembler.ts` — currently aimed at résumés.

- Swap `ProfileCardTemplates.ts` for account / deal / competitor / stakeholder cards. Card schema, graph extraction, retrieval, and evidence assembly carry over.
- This is the single highest-leverage reuse in the codebase, and the reason Tier 1's pruning treats `knowledge/` as a split.

### g) Deal and opportunity objects

**Planned · medium**

No deal, account, or stage object exists anywhere in the app. The join keys do: `MeetingSummaryV3.people[]` carries `role` and `organization`, calendar attendees carry emails, and the mode metadata block is the natural home for a `dealId`.

- Needs new tables in `electron/db/DatabaseManager.ts` and a linking pass at summary time.
- Prerequisite for (k) pipeline review.

### h) Mutual next-step commitment detection

**Planned · medium**

Half-built today: action-item regex patterns, a `missing_next_step` insight, and an `explicitness: 'explicit' | 'inferred'` flag. Missing: *who* committed to *whom*, a date-confirmed flag, and a calendar cross-check.

- `electron/services/CalendarManager.ts` could verify a booked next step, but its OAuth scope is `calendar.readonly`. Booking the next meeting from the call requires a scope change and a re-consent flow — treat that as its own decision, not a silent expansion.

---

## Tier 3 — New subsystems

**Status: Planned unless noted.** Large. None of these have existing code to build on.

### i) CRM sync (Salesforce / HubSpot)

**Planned · large**

Genuinely absent — no CRM integration of any kind exists. `electron/services/CalendarManager.ts` is a working template for exactly this shape: OAuth loopback on localhost, tokens encrypted via `safeStorage`, secret exchange proxied through the API server. Write-back hangs off the post-call hook in `electron/MeetingPersistence.ts`.

`FollowUpDraftType` in `MeetingSummaryV3.ts` already accepts `'crm_note'` and the sanitizer passes it, so a CRM-note draft type is schema-legal today.

### j) Follow-up sequences

**Planned · medium**

`src/components/FollowUpEmailModal.tsx` is one-shot `mailto:` — no send, no scheduling, no cadence. Content generation is solid; the transport and scheduler do not exist.

### k) Pipeline review

**Planned · large**

Depends entirely on (g) landing first. `electron/services/meeting/CrossMeetingRecall.ts` is the only cross-meeting primitive today.

### l) Team rollups / manager view

**Under review — architecture decision, not a feature.**

Natively is single-user, local-first, and `userData`-scoped, and `PRIVACY.md` actively markets that as a position. A manager dashboard requires a server and a multi-tenant model.

Flagging it because every incumbent in this category is fundamentally a manager tool. Choosing to stay rep-local is choosing a different market — that is a call to make deliberately, not to arrive at by default.

---

## Under review

### Natively Token & Pro Access

**Under review — see `SALES_SCOPE_PLAN.md` §4, decision 5.**

The previous roadmap planned token-gated Pro access (wallet connection, on-chain balance monitoring, token-holder governance). The scope plan recommends cutting it from the sales product's positioning — enterprise sales buyers and token-gated access do not mix.

This is a business decision, not a technical one, and it is not settled. It is recorded here rather than deleted so the call gets made explicitly. Nothing is being built against it in the meantime.

### Long-term memory (Hindsight)

**Under review — see `SALES_SCOPE_PLAN.md` §2.1, §4.**

`electron/services/HindsightManager.ts` hosts an optional, user-provisioned long-term-memory sidecar (cross-meeting recall backed by a self-hosted Postgres + embedding server). The scope plan recommends cutting it — it is disabled by default, needs a server almost no shipped user runs, and is out of scope for a lean sales tool. That removal has not happened yet; the code is still present and off unless a user configures a server. Not marketed as a current feature.

### Stealth / process disguise

**Under review — see `SALES_SCOPE_PLAN.md` §4, decision 1.**

The app can rename its own process and swap its icon to impersonate Terminal, System Settings, or Activity Monitor. For a sales tool where you're recording a call, that is closer to a legal liability than a feature. The recommendation is to drop the impersonation icons and keep only "invisible during screen share" (a different, legitimate code path already covered under [Why Natively?](README.md#why-natively)). Not yet implemented.

---

## Cut

Removed from the roadmap as out of scope for a sales product:

- **System Design Visualization Engine** — microservice architecture diagrams, DFA/NFA state machines, sequence diagrams, Mermaid/SVG export. Written for engineering meetings. Zero sales relevance.
- **Persona System** — seven professional personas, of which only "Sales Representative" survives, and that one is superseded by the existing sales mode prompt and note schema rather than added to by a persona layer.
- **Short / medium / long-term checklists** — persona library expansion, diagram customization, token-holder community features, mobile app, plugin ecosystem. Replaced by the tiers above.

Multi-language support is *not* cut — it is an existing obligation. The app ships generated ru/zh/ja/es dictionaries, and any copy change during the rebrand silently drops them back to English until they are regenerated.

---

## Contributing

Feature suggestions are welcome, with the scope narrowing in mind — proposals outside the live-sales-call use case will likely be declined.

1. Open an issue with the `feature-request` label
2. Join community discussions
3. Submit PRs for approved items

---

## Notes

This roadmap is subject to change based on user feedback, technical feasibility, and business priorities. Items are labeled by status; none are shipped, and sizing is relative rather than a schedule.
