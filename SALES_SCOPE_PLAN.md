# Sales-Only Scope Plan

**Goal:** rebrand this app from a multi-purpose meeting copilot (interviews, job hunting, lectures, coding help, sales) into a single-purpose **real-time AI copilot for sales calls**.

**Status:** plan only. No code has been changed. Based on a full-repo audit (Jul 2026).

---

## 1. Where the codebase stands today

| Area | Size |
|---|---|
| `electron/` (main process) | ~237k LOC, 330 source files |
| `src/` (renderer) | ~47k LOC, 101 files |
| Tests | ~660 test files (595 under `electron/**/__tests__`, 69 under `tests/`) |
| Native Rust addon | ~5k LOC |
| Chrome extension (`natively-browser/`) | ~3.6k LOC |

The app currently ships **8 modes**: `general`, `sales`, `looking-for-work`, `recruiting`, `team-meet`, `lecture`, `technical-interview`, `seminar`. Only one of those is the product we're keeping.

### The good news

The **live sales call path is genuinely the best-built part of the app.** It is not a stub:

- `MODE_SALES_PROMPT` (`electron/llm/prompts.ts:1563-1679`) — a real 7-branch decision hierarchy: objection → buying signal → conflicting deal notes → direct question → discovery opening. Plus dedicated objection-handling (validate → reframe → advance), discovery diagnostics, happy-customer expansion, and reference-file type cues (product deck / pricing sheet / case study / prospect research).
- **Pricing guardrails already exist** — walk-away price / BATNA / discount-floor suppression is enforced in four independent places (`prompts.ts:1581,1634`, `tinyPrompts.ts:191`, `customContextClassifier.ts:58`). This is real product safety logic that would take weeks to rebuild.
- **The sales note schema is BANT in all but name** — `TEMPLATE_NOTE_SECTIONS.sales` (`ModesManager.ts:151-159`): Account context, Pain points, Buying signals, Objections, Budget/timeline/authority, Next steps, Follow-up email. Each compiled into per-section extraction prompts by `SectionPromptCompiler.ts`.
- **Follow-up email generation is solid** — `FollowUpDraftGenerator.ts` has a sales mail profile with deal-advancing semantics ("mirror back the pain, confirm the agreed next step with a date, never invent pricing or commitments") plus subject-grounding validation and a deterministic fallback.
- The audio → STT → transcript → RAG → summary pipeline is mature and entirely mode-agnostic. Keep all of it.

### The bad news

**Everything after the call hangs up is thin**, and the app carries an enormous amount of weight it will never use again.

---

## 2. Removal plan

### Verdict summary

| Subsystem | LOC (approx) | Verdict |
|---|---|---|
| Coding-interview machinery (`llm/codeVerification/*`, `CodeSanityCheck`, `CodeHintLLM`, `codingContract/Followup/StreamGate`, `CodingConversationState`) | ~3,300 | **DELETE** |
| Profile Intelligence — resume/CV/JD (backend) | ~5,200 | **DELETE** |
| `ProfileIntelligenceSettings.tsx` (UI) | 2,150 | **DELETE** |
| Screenshot-solve path (`ScreenshotHelper`, `ProcessingHelper`, `CropperWindowHelper`, `Cropper.tsx`) | ~2,100 | **DELETE** (extract credential bootstrap first — see §3) |
| Vision/OCR chain (`services/screen/*` minus 2 shims) | ~1,900 | **DELETE** |
| Phone Mirror (`PhoneMirrorService` + `phoneMirrorClient` + settings tab) | ~3,540 | **DELETE** |
| Skills system (`SkillsManager`, `services/skills/*`, `SkillsSettings.tsx`) | ~2,980 | **DELETE** *(or repurpose — see §5)* |
| Codex CLI/OAuth provider (`CodexCliService`, `CodexOAuthService`) | ~1,790 | **DELETE** — duplicates OpenAI-key support |
| Hindsight LTM sidecar (`HindsightManager`, `intelligence/memory/*`, banner UI) | ~1,730 | **DELETE** (needs Noop shim) |
| Lecture + diagram intelligence | ~470 | **DELETE** |
| Non-sales mode prompts (`MODE_LOOKING_FOR_WORK/RECRUITING/TEAM_MEET/LECTURE/TECHNICAL_INTERVIEW/SEMINAR`) | ~650 | **DELETE** |
| Dead `TINY_MODE_*` constants (no consumers found) | ~124 | **DELETE** |
| Interview/coding/JD regions of `AnswerPlanner.ts` | ~1,300 | **DELETE** |
| `DonationManager` + `ReviewService`/`ReviewPromptLogic` | ~570 | **DELETE** *(review prompt is arguably keepable)* |
| Dead components (`SuggestionOverlay.tsx`, `NativelyInterfaceCard.tsx`, `settings/Sidebar.tsx`, `worker-script/`) | ~440 | **DELETE** — already unreferenced |
| Investigation harnesses (`tools/jd-resume-jit-investigation/`, `tools/profile-intelligence-investigation/`) | — | **DELETE** |
| ~20 `benchmark:profile*` npm scripts + `benchmarks/profile-intelligence/` | — | **DELETE** |
| **Multi-mode CRUD apparatus** (`ModeGenerator`, mode creation IPC, mode picker) | ~2,000 | **COLLAPSE** to one hardcoded sales mode |
| **Mode reference-file retrieval** (`ModeContextRetriever`, `services/modes/ModeHybridRetriever`, `DocumentMap`) | ~4,570 | **KEEP** — this is what makes battlecards/pricing sheets work |
| **Knowledge/OKF substrate** (`services/knowledge/`) | 4,765 | **SPLIT** — delete profile/resume card templates (~1,400), keep the card/graph/evidence engine and repoint at accounts & deals |
| Chrome extension + `services/browser-context/` | ~4,575 | **DECISION** — see §4 |
| Stealth/disguise (fake Terminal/Activity Monitor icons, process rename) | ~700 + 6 assets | **DECISION** — see §4 |
| Audio pipeline, DB, RAG, meeting summaries, dynamic actions, post-call, calendar | ~25k | **KEEP — this is the product** |

**Rough total removable: 28–35k LOC of production code + ~160–180 test files** (~25% of the app), before counting docs.

### Phasing

Order matters — several deletions will not compile unless the ones before them land first.

**Phase 0 — De-risk (do this first, it's cheap and it's the highest liability)**

1. `README.md:15-37` — a hidden SEO keyword block stuffed with ~60 phrases including *"HackerRank AI cheat"*, *"interview cheating tool"*, *"Hirevue AI cheat"*, *"undetectable interview AI"*. This is the single most reputationally damaging artifact in the repo for a sales product. Delete it.
2. GitHub **repo topics** carry the same tags (`interview-helper`, `interview-coder`, `final-round-ai`, `cluely-alternative`). Those live in repo settings, not in any file — prune them there.
3. Delete README sections: 78–84 (Cluely-clone positioning), 120–128, 155–302 (interview-competitor comparison), 261–302 (*"Undetectable on LeetCode, HackerRank & CoderPad"*), 985–1007 (interview-tool replacement table).
4. Rewrite the 4 testimonials at `README.md:86-100` — 3 of 4 are explicitly about passing coding interviews.

Phase 0 touches no code and can ship the same day.

**Phase 1 — Clean deletions (no sales-core importers, safe to `rm`)**

Phone Mirror · Skills · Codex provider · Donation · Review service · lecture/diagram intelligence · `services/dev/ThinkingBudgetBench` · vision/OCR registry · dead components · `tools/` job-seeker harnesses · `worker-script/`.

Each removes its own IPC channels cleanly. ~110 of the app's 314 IPC channels (~35%) belong to features on the removal list.

**Phase 2 — Shimmed deletions (need a stub before the delete)**

| What | Blocker | Fix |
|---|---|---|
| `ProcessingHelper` | `loadStoredCredentials()` (~120 LOC) is the **app-wide credential bootstrap** — it seeds LLM keys, re-inits `IntelligenceManager`, and initializes RAG embeddings. Deleting the class breaks startup. | Extract to `CredentialBootstrap.ts` first |
| `HindsightManager` | imported by `MeetingPersistence.ts` | Noop shim (the file already documents a Noop degradation path) |
| `services/screen/ScreenContextService` | imported by `IntelligenceEngine`, `IntelligenceManager`, `WhatToAnswerLLM` | Empty-context stub, then strip the vision branch |
| `services/screen/ImageOptimizer` | imported by `LLMHelper` | Inline or drop with the vision path |
| `llm/codeVerification/verificationEnabled`, `codingStreamGate` | imported by `IntelligenceEngine`, `WhatToAnswerLLM`, `AnswerLLM` | Constant-`false` shim, then dead-code-eliminate |

**Phase 3 — Mode collapse (the big one)**

The mode union is **hand-mirrored in six independent places** with no single source of truth:

- `ModesManager.ts:56-67` (canonical, 8 modes)
- `modeProfiles.ts:30-45` (deliberate copy, 8)
- `modeSourceContract.ts:49-61` (8)
- `ModeGenerator.ts:33-40` (7 — no seminar)
- `MeetingModeDetector.ts:11-18` (7)
- `PostCallWorkflow.ts:4-10` (7)
- plus two *different* unions: `SessionMemory.ts:35-36` (adds `interview`/`coding`/`negotiation`) and `ProviderRouter.ts:207` (4 values, drives provider fallback order)

Narrowing the union breaks ~8 exhaustive `Record<ModeTemplateType, X>` maps at compile time — which is good, it's a checklist. But two things fail at *runtime* only: the startup invariant loop at `ModesManager.ts:222-235`, and `MeetingModeDetector`'s scoring math.

**Critical: modes are persisted DB rows**, not just code. `DatabaseManager.ts:725` stores `template_type` as a free string. Existing installs have `'technical-interview'` rows, and stored meeting summaries carry `mode.detectedTemplateType`. Ship a migration that remaps every row to `sales` before the enum narrows, or `getOrMigrateSourceContract` hits an unhandled path.

Recommendation: keep `general` alongside `sales` as a fallback rather than collapsing to exactly one — `general_meeting_answer` is a load-bearing floor type in the fallthrough logic (`modeProfiles.ts:142-145`), and removing it is more disruptive than keeping it.

**Phase 4 — Answer-type narrowing (do last, most entangled)**

`AnswerType` has 38 members (`AnswerPlanner.ts:9-65`); ~23 are interview/job-hunt/coding specific. Four traps:

1. **The sales leak-guard is *expressed as* the interview enum.** `AnswerPlanner.ts:1839-1845` says `sales_answer` **forbids** the context layers `resume`, `jd`, `negotiation`. If you delete those three members of `ContextLayer`, **the sales branch stops compiling and the guard disappears with them.** Same story in `ProfileOutputValidator.ts:129-132` and `ProfileIntelligenceRouter.ts:157-161`, both of which list `sales_answer` in deny-sets. Rewrite the guard before removing the vocabulary.
2. **Do not delete the `document_*` answer types with `lecture_answer`.** Sales modes default to `sourceAuthority: 'reference_files_primary'`, and `definitional_answer` / `list_answer` / `exact_numeric_answer` / `document_structure_answer` / `document_followup_answer` are exactly what makes "answer from the product PDF" work. Note `ContextRouter.ts:318` gates doc behavior on `templateType === 'lecture' || answerType === 'lecture_answer'` — that branch needs rerouting to sales, not deleting.
3. **`ethical_usage_answer`** (`AnswerPlanner.ts:59-62`) is written in interview/proctoring language but is a **safety route**. Rewrite it for sales (recording consent, honesty about being on a call), don't drop it.
4. **`product_candidate_mix_answer`** ("founder credibility while selling") shares `SALES_TEMPLATE` but also sits in the profile answer-type lists. Either fold it into `sales_answer` or re-derive it without the resume dependency.

`ContextLayer` fans out across ~6 files in `intelligence/context-os/` (`sourceKinds.ts`, `sourceOwnership.ts`, `explicitSourceSwitch.ts`, `SourceAuthorityKernel.ts`, `turnSourceDecision.ts`). Budget a coordinated edit.

**Phase 5 — Docs, tests, branding**

- `README.md` realistically goes 60KB → ~15KB. Regenerate the ToC (`:421`) and the roadmap mermaid (`:776`).
- `ROADMAP.md` is ~80% out of scope (System Design Visualization Engine = engineering meetings; Persona System = 7 personas of which 1 survives). Rewrite from scratch.
- `CHANGELOG.md` — **leave history alone.** Rewriting shipped release notes is misleading. Only future entries change.
- `PRIVACY.md` / `termsandcondition.md` — `§10.1` "Recording, capture, and consent" is already written and directly reusable for sales. But **T&C needs a lawyer pass, not find-replace** — the entity name appears in license-grant and liability clauses tied to live Dodo Payments SKUs.
- `CODE_OF_CONDUCT.md` needs **zero** changes (verbatim Contributor Covenant, no brand references).
- ~160–180 test files retire. Cleanest prune axis is `tests/fixtures/modes/` (9 mode dirs, ~3 in scope) and `tests/e2e-modes/` (34 files). **Careful with the 69 sales-referencing tests** — many of them assert the *absence* of resume/JD leakage, so they depend on the interview types existing. Rewrite those assertions rather than deleting the tests.

---

## 3. Do-not-break list

These will silently break existing users if touched carelessly.

| Item | Why | Guidance |
|---|---|---|
| **`appId` = `com.electron.meeting-notes`** (`package.json:112`) | Keychain access group is `BJM29W3UQ6.com.electron.meeting-notes`, asserted in `KeychainEntitlement.test.mjs:22`. It exists specifically to fix issue **#322 — keychain credentials lost across updates.** Changing it orphans every user's stored API keys and macOS preferences. | **Leave it alone.** It's already brand-neutral — it does not need to change for the rebrand. |
| **`productName`** (`package.json:113`) | Electron derives `userData` from the app name. Changing it relocates the directory and orphans 11+ persisted files: `credentials.enc`, `settings.json`, `keybinds.json`, `calendar_tokens.enc`, whisper models, the meetings DB. | Requires a one-time migration/copy shim before rename. |
| **Auto-update feed** (`package.json:220-226`) | Existing installs poll `Natively-AI-assistant/natively-cluely-ai-assistant` directly. | Keep publishing to the old repo, ship a version pointing at the new one, then wait out the tail. |
| **`api.natively.software`** | Hardcoded in 10+ places incl. licensing, trial, pricing, usage, calendar, review, Pro STT — plus a **DNS monkey-patch** at `main.ts:20-27` for that exact hostname. | Server-side DNS/cert work + client rollout. Old clients call the old host forever. |
| **Signing identity / Team ID `BJM29W3UQ6`** | `electron-builder.signed.cjs:56`, notary profile `natively-notary`, CI keychain `natively-signing.keychain-db`. | Fixed by the Apple Developer account. Renaming the profile requires rotating local keychain + CI secrets in lockstep or release builds break silently. |
| **`extraMetadata.nativelySigned`** (`electron-builder.signed.cjs:73`, read at `main.ts:124,136`) | Decides whether auto-install is permitted. | Renaming this key silently downgrades signed builds to the manual-download path. |
| **Dodo Payments product IDs** (`src/config/urls.ts:10-18`) | 5 live checkout SKUs, named in the Dodo dashboard, on customer invoices, and in `refund.md` / T&C §6-7. | Renaming mid-flight desyncs existing subscriptions from the published terms. |
| **`sttProvider: 'natively'`** (`main.ts:2662-2664`) | A **persisted settings value**. | Renaming the enum without a migration breaks STT for hosted-tier users. |
| **`natively://` deep links** | `ProfileMarkdownExporter` / `OkfMarkdownExporter` emit these URIs **into markdown files users already have on disk**. | Back-compat alias on the resolver. |
| **`premium/` submodule** | Private repo `Natively-AI-assistant/natively-premium`, not checked out here. Carries the paid feature set *and the actual mode-picker UI* (`src/components/settings/ModesSettings.tsx` is an 11-line stub re-exporting from it). | **Parallel workstream in that repo.** Backend-only mode deletion leaves the UI offering dead template types. |

**Rebrand effort:** 415 brand occurrences across 51 source files, +284 in generated i18n, +82 files with the name in the *filename*. Because the brand string is simultaneously an **i18n key**, a **localStorage key prefix**, and a **filename prefix**, a clean rename is ~3–5 days, not a find-replace. Any copy change also silently drops ru/zh/ja/es translations back to English until the generated dictionaries are regenerated — budget a translation pass *as part of* the rebrand, not after.

### Pre-existing rot worth fixing while we're in here

- `natively-api` is an **orphaned gitlink** with no `.gitmodules` mapping — `git submodule status` errors, and `npm run test:e2e:screen-understanding` is broken in a fresh clone.
- Every `docs/*` path referenced in CHANGELOG and `electron-builder.signed.cjs:38` is dead — there is no `docs/` directory.
- `KeychainEntitlement.test.mjs:26-29` asserts a `keychain-access-groups` key that **neither entitlements plist declares**.
- `src/config/urls.ts:10` and `:14` (`pro` and `apiPro`) point at the *same* Dodo product ID.
- `package.json:232` — `"author": ""`.
- GitHub owner mismatch: `package.json:223` says `Natively-AI-assistant`, `.github/ISSUE_TEMPLATE/config.yml:4` says `evinjohnn`.

---

## 4. Decisions I need from you

I've made a recommendation on each; none is locked in.

**1. Stealth / disguise.** The app can rename its own process and swap its icon to fake **Terminal, System Settings, or Activity Monitor** (6 assets in `assets/fakeicon/`, ~700 LOC in `main.ts`). That is interview-cheating machinery, and for a sales product where you're recording a call it's a legal liability, not a feature.
→ **Recommend: delete the impersonation icons and disguise modes. Keep "invisible to screen share"** — that one is legitimately useful (your notes don't show when you share your screen with a prospect) and is a different code path.

**2. Chrome extension** (`natively-browser/`, 3.6k LOC + `services/browser-context/`, 961 LOC). Already published to the Chrome Web Store, so a rename means a store resubmission.
→ **Recommend: keep and rebrand.** Tab capture is *more* useful for sales than it ever was for interviews — pulling context off a prospect's LinkedIn, their pricing page, a company news article. This is a genuine asset.

**3. Skills system** (~2,980 LOC). Markdown instruction packs loaded from disk.
→ **Recommend: keep the engine, drop the settings UI for now.** It's the cheapest possible host for sales *methodology* packs — MEDDIC coach, Challenger framing, Sandler pain funnel — without touching prompt code. Killing it now means rebuilding it in six months.

**4. Local models / offline mode** (Ollama, local Whisper, local reranker, ~1,500 LOC + 163MB of bundled ONNX). Not a sales question — a privacy-positioning question.
→ **Recommend: keep.** Sales orgs care about not shipping call audio to third parties. Separately: `resources/models/Xenova/mobilebert-uncased-mnli/` ships **both** full (99MB) and quantized (27MB) weights — dropping the full one cuts ~99MB from the installer regardless.

**5. Crypto token.** `README.md:362` gates Natively Pro behind a `$NAT` token on Printr; ROADMAP Feature 3 is the token system; `assets/pumpfun-card.png` is its marketing card.
→ **Recommend: cut it from the sales product's positioning.** Enterprise sales buyers and token-gated access do not mix. This is a business call, not a technical one.

**6. Rename now or later?** The rebrand is the riskiest part (userData relocation, update feed, payment SKUs) and is *independent* of the pruning.
→ **Recommend: prune first, rename second.** Phases 0–4 ship real value with zero risk to existing installs. Do the rename as its own release with a migration shim.

---

## 5. What to add

The pruning is the boring half. Here's where the product actually gets better — ordered by leverage, not by ambition.

### Tier 1 — Cheap wins, existing seams, days not weeks

**a) Make the post-call output as good as the live call.** Right now it isn't close.

- `MeetingRecipes.ts:192-206` `sales-meddic` claims to produce a MEDDIC summary. It actually runs a **regex over section *titles*** and re-buckets whatever bullets landed there. Because the sales sections are titled "Pain points" and "Budget / timeline / authority", *Metrics* and *Economic buyer* both resolve to the same section and duplicate content. No per-letter scoring, no confidence, no gap detection.
  → Replace `salesMeddic()` with a `generateStructured()` call. The pattern is already proven next door in `FollowUpDraftGenerator.ts` and `SectionPromptCompiler.ts`. Add a `qualification` block to the `MeetingSummaryV3` interface + sanitizer.
- `PostCallWorkflow.ts:155-163` is the **only** call-scoring code in the repo: two regex rules (`missed_objection`, `missing_next_step`), and `CoachingInsight` has no numeric score.
  → Swap regex for an LLM rubric. The seam is already wired end to end: called from `MeetingPersistence.ts:495`, rendered at `MeetingDetails.tsx:1741`.

**b) Bug: the recipes may never be displayed.** `recipes` is declared in the UI type at `MeetingDetails.tsx:817` but I found **no render path for it**. The MEDDIC summary and CRM note appear to be generated, stored, and never shown. Worth confirming before building on top of them.

**c) Talk-ratio and talk-time analytics.** Completely absent — no `talkTime`/`speakerStats`/`monologue` anywhere. But `SpeakerLabelService.ts` and `TranscriptNormalizer.ts` already carry per-segment speaker + timestamp, so **the raw data is sitting there unused.** Post-call metrics are a small module beside them. Live in-call talk ratio ("you've been talking for 4 minutes") needs a new streaming consumer in `IntelligenceEngine.ts` — medium.

**d) First-class battlecards.** Today `DynamicActionDetector.ts:89` hardcodes a competitor regex — `/\b(Gong|Chorus|ZoomInfo|Salesloft|Outreach|Clari)\b/` — and the instruction literally says "Position **Natively's** advantages." That's our own dogfood config shipped as product. Meanwhile `tests/fixtures/modes/sales/sales_competitor_battlecard.md` proves the retrieval path already carries battlecards.
→ Make competitor triggers **data-driven from the indexed battlecard** instead of a hardcoded const. Ingestion (`ModeReferenceFileIngestion`), retrieval (`ModeContextRetriever` + `rag/`), and the prompt's `<injected_context>` type cues (`prompts.ts:1660-1668`) all already exist. This is the single best argument for **not** deleting the mode-retrieval layer in Phase 3.

**e) Configurable pricing policy.** The *guardrails* are the best-covered thing in the repo. What's missing is customer-configurable policy — approved discount ladders, concession trades. Ships as a structured reference file through the path `tests/fixtures/modes/sales/sales_pricing_policy.json` already exercises.

### Tier 2 — Real features, weeks

**f) Repoint the knowledge graph at accounts and deals.** `services/knowledge/` is 4,765 LOC of genuine structured-knowledge machinery — `OkfCardBuilder`, `GraphExtractor`, `GraphRetriever`, `KnowledgePackStore`, `EvidenceAssembler` — currently aimed at *resumes*. The card schema, graph extraction, retrieval, and evidence assembly all exist and work.
→ **This is the highest-leverage reuse in the entire repo.** Swap `ProfileCardTemplates` for account/deal/competitor/stakeholder cards and you get a deal knowledge base nearly for free. It also means Phase 1's "delete knowledge/" should be a *split*, not a delete.

**g) Deal / opportunity context.** No deal, account, or stage object exists anywhere. But `MeetingSummaryV3.people[]` already carries `role` + `organization`, `CalendarEvent.attendees` carries emails, and `MeetingSummaryModeMeta` is the natural place for a `dealId`. Needs new schema in `DatabaseManager.ts` — but the join keys are already in the data.

**h) Next-step commitment detection.** Half-built: `ACTION_PATTERNS` regex + a `missing_next_step` insight + `ActionItem.explicitness: 'explicit' | 'inferred'`. Missing: *mutual* commitment (who committed to whom), a date-confirmed flag, and a calendar cross-check. `CalendarManager` could verify a booked next step — but its OAuth scope is **read-only** (`CalendarManager.ts:14`), so "book the next meeting from the call" needs a scope change and a re-consent flow.

### Tier 3 — New subsystems, months

**i) CRM sync (Salesforce/HubSpot).** Zero hits repo-wide for `salesforce|hubspot|pipedrive`. Genuinely absent. The good news: `CalendarManager.ts` is a working template for exactly this shape — OAuth loopback on localhost, tokens encrypted via `safeStorage`, secret exchange proxied through the API server. Copy that into a `CrmManager`. Write-back hangs off `MeetingPersistence.ts:495`.
Worth noting `MeetingSummaryV3`'s `FollowUpDraftType` **already accepts `'crm_note'`** and the sanitizer passes it — a CRM-note draft type is schema-legal today.

**j) Follow-up sequences.** `FollowUpEmailModal.tsx` is one-shot `mailto:` with no send, no scheduling, no cadence. The *content* generation is solid; the transport and scheduler don't exist.

**k) Pipeline review.** Depends entirely on (g) existing first. `CrossMeetingRecall.ts` (92 LOC) is the only cross-meeting primitive today.

**l) Team rollups / manager view.** The app is single-user, local-first, `userData`-scoped, and `PRIVACY.md` actively markets that. A manager dashboard needs a server and a multi-tenant model. **This is a product-architecture decision, not a feature** — flagging it because every competitor (Gong, Chorus, Clari) is fundamentally a manager tool, and choosing to stay rep-local is choosing a different market.

### Not worth doing

`ROADMAP.md` Feature 1 — **System Design Visualization Engine** (microservice diagrams, DFA/NFA state machines, Mermaid export). Written for engineering meetings. Zero sales relevance. It's currently marked Priority: High and sits at the top of the README roadmap timeline. Cut it.

---

## 6. Suggested sequencing

| Phase | Content | Risk | Rough effort |
|---|---|---|---|
| 0 | README liability cleanup + GitHub topics | None | 0.5 day |
| 1 | Clean deletions (no importers) | Low | 3–4 days |
| 2 | Shimmed deletions (extract credential bootstrap first) | Medium | 3–4 days |
| 3 | Mode collapse + DB migration | **High** — persisted rows | 4–6 days |
| 4 | Answer-type narrowing + rewrite leak guards | **High** — safety logic lives in the enum | 5–8 days |
| 5 | Docs, test cull, i18n regeneration | Low | 3–5 days |
| — | *Ship here. Prune is done, brand unchanged, zero risk to installs.* | | |
| 6 | Tier 1 additions (MEDDIC, coaching, talk-ratio, battlecards) | Low | 1–2 weeks |
| 7 | Rebrand + userData migration shim | **High** | 3–5 days |
| 8 | Tier 2 (knowledge graph repoint, deal objects) | Medium | 3–4 weeks |

Phases 0–5 are ~3 weeks of pruning that leaves a shippable, focused sales product with the brand untouched. That's the natural first milestone.
