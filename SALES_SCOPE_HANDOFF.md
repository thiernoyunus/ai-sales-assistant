# Handoff — sales-only scope narrowing

Working branch: `claude/sales-app-scope-review-h21i23`. Plan of record: [SALES_SCOPE_PLAN.md](SALES_SCOPE_PLAN.md).

This file is the pick-up point. If you are new to this work, read this first, then §2 and §3 of the plan.

---

## Where things stand

| Phase | State |
|---|---|
| 0 — docs/positioning | done |
| 1 — clean deletions | done |
| 2 — shimmed deletions | **done, ~8,600 lines removed** |
| 3 — mode collapse | **code complete** — migration, enum, mirrors, validators, tests, prompts all done; full suite confirming |
| 4 — answer-type narrowing | not started |
| 5 — docs, tests, branding | not started |

### Verification status — read this before trusting anything below

- `npm run typecheck:electron` and `npx tsc --noEmit`: **both clean** as of `ef7cd34`.
- Full suite after the code-verification removal (`16d42cd`): **green, exit 0**.
- Full suite after the vision removal: **last observed 0 failures in 156 KB of output, still running.** Not yet confirmed end to end. Re-run and confirm before building on it.
- `electron/db/__tests__/ModeTemplateCollapseV26.test.mjs`: **passing, all four cases** including the `__reserved__` sentinel guard.

It needs Electron's runtime — under plain `node --test`, `DatabaseManager.db` is null (better-sqlite3 is built against Electron's ABI) and every assertion fails misleadingly. Also note `electron/db/__tests__/` is **not** in the `npm test` globs, so it never runs in the normal suite:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/db/__tests__/ModeTemplateCollapseV26.test.mjs
```

### OPEN ISSUE — the full suite does not terminate

**Status: under investigation. Do not read a stalled suite as "tests failing".**

`npm test` reaches ~155 KB of output with **0 failures**, then hangs indefinitely (observed 32–38 min before being killed, twice). Seven files are still resident at that point:

```
electron/llm/__tests__/IntentClassifierStackWordBoundary2026_07_19.test.mjs
electron/rag/__tests__/LocalEmbeddingProviderRealModel.test.mjs      <- loads a real ML model
electron/rag/__tests__/LocalRerankerModel.test.mjs                   <- loads a real ML model
electron/services/__tests__/IntelligenceEngineCandidateSanitizerFallback.test.mjs
electron/services/__tests__/IntelligenceEngineFalseNoContentClaim.test.mjs
electron/services/__tests__/IntelligenceEngineJsonEnvelopeRecovery.test.mjs
electron/services/__tests__/IntelligenceEnginePlanner.test.mjs
```

Running `IntelligenceEnginePlanner.test.mjs` alone is decisive:

```
ℹ tests 6   ℹ pass 5   ℹ fail 0   ℹ cancelled 1
✖ electron/services/__tests__/IntelligenceEnginePlanner.test.mjs
  'Promise resolution is still pending but the event loop has already resolved'
```

**Every assertion passes.** The *file* is cancelled because something leaves an unsettled promise / open handle so the process never exits. `--test-timeout` does not rescue it — that bounds individual tests, not a process kept alive after they finish.

Suite outcomes by commit:

| Commit | Result |
|---|---|
| `dbead21` gitlink fix only | exit 0, green |
| `16d42cd` code-verification removal | exit 0, green |
| `f0e108b` vision removal | stalled |

That ordering *suggests* the vision removal, but `f0e108b` does not touch `IntelligenceEngine.ts` at all — of the hanging files it only touches `ScreenContextService.ts`, and only to *reduce* it to a type (dropping its `ScreenshotHelper` and `OcrProviderManager` imports, i.e. removing side effects rather than adding any). So the correlation is unexplained and may be coincidental — the two green runs could simply have been lucky, since a hang like this can depend on timing and parallelism.

**A worktree at `16d42cd` is being built to test the same file at the known-green commit.** That answers "is this a regression I introduced, or pre-existing?" — settle it before trusting or dismissing the suite. If it hangs there too, this is pre-existing and unrelated to the scope work.

Note the two `RealModel` RAG tests load actual ML models and are a plausible independent hang source (network / model download).

### Gotcha that cost time twice

Do not write `until ! pgrep -f "node --test"; do sleep 15; done`. `pgrep -f` matches the wait loop's **own** command line, so it never exits and looks exactly like a hung test suite. Use the background-task completion notification instead, or match on a pattern that cannot appear in your own process.

Also: `npm test | tail -40` buffers everything until the run ends, so the log looks empty for 20 minutes and reads as a hang. Redirect straight to a file. **The suite genuinely takes ~20 minutes** — that is normal, not a stall.

---

## Phase 3 — the remaining work

### What already landed: `ef7cd34`

A `user_version` 25 → 26 migration in [DatabaseManager.ts](electron/db/DatabaseManager.ts) remaps retired `modes.template_type` rows to `'general'`.

**This had to come first.** `template_type` is a free TEXT column, so upgrading installs hold literal strings like `'technical-interview'`. If the enum narrows before those rows are migrated, `getOrMigrateSourceContract` and the `ModesManager` startup invariant loop hit unhandled paths at launch.

**Deviation from the plan, on purpose.** The plan said remap every row to `'sales'`. This maps to `'general'` instead: `'general'` survives the narrowing as the neutral fallback (`general_meeting_answer` is a load-bearing floor type in `modeProfiles.ts:142-145`), and remapping to `'sales'` would silently turn a user's "Weekly standup" mode into sales prompting. `'__reserved__'` is preserved — it is the v23 FK sentinel for profile OKF cards, not a user template. **If the product owner prefers `'sales'`, change the one `UPDATE` and its test.**

### Narrowing progress

**Done** (`5ef9add`, `bd45f1b`):
- The union is now declared **once**, in `llm/modeProfiles.ts`, as `'general' | 'sales'`. It lives in the leaf `llm/` layer because `services/` imports from `llm/` and never the reverse — that direction is *why* the copy existed. `ModesManager` re-exports it, so existing `import { ModeTemplateType } from '../services/ModesManager'` call sites are unchanged.
- `ModesManager`: `MODE_TEMPLATES`, `TEMPLATE_NOTE_SECTIONS`, `TEMPLATE_SYSTEM_PROMPTS` → 2 entries. `PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES` → empty set (kept, not deleted — every mode it named is retired and neither survivor suppresses the intercept). `buildUserSourceContract` lost its interview-prep branch; every surviving mode is reference-file owned, which is what sales wants. Six unused prompt imports dropped.
- `ContextRouter`: `MODE_TEMPLATE_TYPES` → 2; unreachable `team-meet` / interview-followup branches collapsed. **Kept** the `answerType === 'lecture_answer'` half of the doc-grounded gate — per plan Phase 4 note 2 that branch is what makes "answer from the product PDF" work and must be *rerouted*, not deleted.
- `MeetingModeDetector`: narrowed **and its confidence math re-derived** — see finding 4 above. Now `clamp01(bestScore / 12)` with the margin term removed, because margin degenerated to `bestScore` with one candidate.

**Empirically confirmed:** after narrowing only the `ModesManager` copy, the whole project still compiled with **zero errors**. The mirrors really are independent. `modeProfiles.ts` carried a comment claiming drift "would surface as a type error at the call sites" — it does not.

**Also done** (`609f73b`, `2e4858a`, `c2b4610`, `42b916d`, `9974990`):
- The silent mirrors: `modeSourceContract` (`ContractTemplateType` + the `isContractTemplateType()` `===` chain), `ModeGenerator` (mirror deleted in favor of the import; `VALID_TEMPLATE_TYPES`; **and the meta-prompt that tells the LLM which types are legal** — stale text there made the generator emit types the validator rejects), `PostCallWorkflow` (kept its `| string` widening, removed the unreachable coaching branches).
- Runtime validators with no compiler protection: `ProfileIntelligenceRouter.MODE_TEMPLATE_TYPES` (it gates an unchecked `as` cast — a real path for a retired string to enter typed code), `ContextFusionEngine.MODES_SUPPRESSING_PROFILE`, `ProfileTreeService.CANDIDATE_VOICE_MODES`, `liveSessionMemory.toMemoryMode`/`toSurface`, `ipcHandlers.clarSurface`.
- Tests narrowed rather than deleted wherever they assert a general property (spoken-contract composition, identity guard, prefix dedup). Negative examples were re-pointed at `MODE_GENERAL_PROMPT` after verifying it genuinely lacks the contract.
- The 11 retired prompt constants deleted, −711 lines.
- Stale user-facing copy in `IntelligenceSettings.tsx`.

**Deliberately NOT narrowed** — separate type spaces that merely reuse the same strings: `llm/SessionMemory.MemoryMode` (still has `interview`/`coding`/`negotiation`), `llm/FollowUpResolver.FollowUpSurface`, `llm/ProviderRouter`'s same-named type, `MeetingRecipes.RecipeType`, `LongTermMemoryService`'s surface tags, and a stopword list containing the English word "seminar".

### RESOLVED: the test suite blocker (kept for the record)

The retired mode prompt constants (`MODE_LOOKING_FOR_WORK_PROMPT`, `MODE_RECRUITING_PROMPT`, `MODE_TEAM_MEET_PROMPT`, `MODE_LECTURE_PROMPT`, `MODE_TECHNICAL_INTERVIEW_PROMPT`, `MODE_SEMINAR_PROMPT`) and all five `TINY_MODE_*_PROMPT` constants **cannot be deleted yet** — every one is still referenced by live tests:

```
electron/llm/__tests__/modePrompts.test.mjs
electron/llm/__tests__/HumanizedInterviewVoice2026_06_15.test.mjs
electron/llm/__tests__/InterviewHumanFeel2026_06_15.test.mjs
electron/llm/__tests__/TinySpokenVoice2026_06_15.test.mjs
electron/llm/__tests__/TinyPromptHumanVoice2026_06_15.test.mjs
electron/services/__tests__/ModesManager.test.mjs          (EXPECTED_MODE_TYPES asserts all 8)
electron/services/__tests__/ModeSeminarGroundingProfile.test.mjs
electron/test/__tests__/IdentityGuard.test.mjs
evalHarnessPatterns.test.mjs
```

Most of these test a *general* property (every mode prompt has a human voice / does not leak identity / starts with the shared prefix) and merely use the 8 modes as their sample set. Those should be **narrowed, not deleted** — the property is still worth asserting. Only `ModeSeminarGroundingProfile.test.mjs` looks like a pure single-mode test. Retire the test references first, then the constants.

**A prior survey wrongly reported `MODE_TEMPLATES` as having zero references** — it is used by two test files. Verify before deleting anything on a survey's say-so.

### What is left: narrowing the enum

Target union, per the plan's own recommendation: **keep `general` alongside `sales`.** Do not collapse to exactly one — `general_meeting_answer` is load-bearing in the fallthrough logic.

Retired: `looking-for-work`, `recruiting`, `team-meet`, `lecture`, `technical-interview`, `seminar`.

**28 files** reference the retired strings:

```
electron/main.ts                     electron/LLMHelper.ts
electron/ipcHandlers.ts              electron/IntelligenceEngine.ts
electron/llm/modeProfiles.ts         electron/llm/FollowUpResolver.ts
electron/llm/documentGroundedPrompt.ts  electron/llm/tinyPrompts.ts
electron/llm/whatToAnswerRequestSnapshot.ts  electron/llm/SessionMemory.ts
electron/llm/ProviderRouter.ts       electron/llm/ProfileIntelligenceRouter.ts
electron/llm/liveSessionMemory.ts    electron/llm/TurnPlanner.ts
electron/intelligence/ContextFusionEngine.ts  electron/intelligence/ProfileTreeService.ts
electron/intelligence/ContextRouter.ts  electron/intelligence/memory/LongTermMemoryService.ts
electron/services/modeSourceContract.ts  electron/services/ModeContextRetriever.ts
electron/services/ModesManager.ts    electron/services/ModeGenerator.ts
electron/services/meeting/MeetingModeDetector.ts  electron/services/meeting/MeetingRecipes.ts
electron/services/meeting/FollowUpDraftGenerator.ts  electron/services/meeting/MeetingSummaryReducer.ts
electron/services/post-call/PostCallWorkflow.ts  electron/db/DatabaseManager.ts
```

### SURVEY FINDINGS — read before editing. These invalidate parts of the plan.

A full read-only survey found **344 real occurrences across 55 files** (word-boundary matched, so `lecture_answer` / `lectureId` / `lecture_notes` are correctly excluded). Five findings change the approach:

**1. Narrowing the canonical type does NOT force the mirrors to fix.** The type is independently declared **5 times** plus **4 hand-written runtime validators**. The mirrors satisfy themselves; TypeScript gives zero cross-file signal. Each must be edited by hand or it silently keeps accepting retired strings.

**2. `ProviderRouter.ts:207` is a NAME COLLISION — do not touch it.** It declares `export type ModeTemplateType = 'sales' | 'recruiting' | 'interview' | 'default'` — same name, unrelated 4-value set, with `'interview'`/`'default'` that are not mode types at all. Its `modePreferences` Record at :408 is keyed on *that* type. Editing it while "narrowing ModeTemplateType" is the single most likely mistake here.

**3. `DatabaseManager.ts:790` `BACKFILL_SECTIONS` MUST KEEP its retired-mode keys — forever.** It is v12→v13 migration code operating on already-persisted rows from old app versions. Cleaning it up breaks upgrades from old databases. It looks like dead config; it is not.

**4. `MeetingModeDetector` confidence math genuinely breaks — not just list edits.** Scoring: opening-window matches score `weight × 2`, later matches `weight × 1`, no double-count; calendar title hints add flat weight. Winner needs `bestScore >= 3` or it floors to `general`. Then `confidence = clamp01((bestScore/12)*0.6 + (margin/8)*0.4)` where `margin = bestScore - secondScore`.
   - Retired signals **vanish rather than redistribute** — a recruiting-heavy transcript scores zero everywhere and floors to `general`.
   - With only `sales` left as a non-general candidate, **`secondScore` is always 0, so `margin === bestScore`** — the margin term loses its comparative meaning and every hit collects the full 40% bonus. Confidence becomes systematically inflated.
   - The constants `3`, `/12`, `/8` were tuned for a 6–7-way contest. **Re-derive them; do not just delete list entries.**

**5. Confirmed dead code, safe to delete outright:** the five `TINY_MODE_*_PROMPT` constants in `llm/tinyPrompts.ts` (re-exported via `llm/index.ts:138-143`, zero consumers, and `TINY_PROMPTS_SET` deliberately excludes them), and `MODE_TEMPLATES` in `ModesManager.ts:117-127` (zero external references).

**Self-cleaning vs. silent:** these break at compile time once the union narrows — `TEMPLATE_NOTE_SECTIONS` (:131), `TEMPLATE_SYSTEM_PROMPTS` (:208), `PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES` (:459), `MODE_CONTEXT_PROFILES` (`modeProfiles.ts:109`), and the `===` comparisons in `ModesManager:585`, `ipcHandlers:1408`, `ContextRouter:151,160,318`, `liveSessionMemory:52-91`. These do **not** — `isContractTemplateType()` OR-chain (`modeSourceContract.ts:283`), `MODE_TEMPLATE_TYPES` Sets (`ContextRouter:117`, `ProfileIntelligenceRouter:89`), `VALID_TEMPLATE_TYPES` (`ModeGenerator:42`), and `PostCallWorkflow`'s union (widened with `| string`, so its :116-176 branches just become unreachable).

**Also needs a product decision:** `IntelligenceSettings.tsx:30` advertises "Detects whether a meeting was a sales call, interview, standup, or lecture" — becomes literally false. And `ModeGenerator.ts:118` feeds the valid-type list **into an LLM prompt**; stale text there makes the generator emit types the validator then rejects.

### The union is hand-mirrored in six places — no single source of truth

| File | Line | Members |
|---|---|---|
| `services/ModesManager.ts` | 56-67 | 8 — **canonical** |
| `llm/modeProfiles.ts` | 30-45 | 8 (deliberate copy) |
| `services/modeSourceContract.ts` | 49-61 | 8 |
| `services/ModeGenerator.ts` | 33-40 | 7 (no seminar) |
| `services/meeting/MeetingModeDetector.ts` | 11-18 | 7 |
| `services/post-call/PostCallWorkflow.ts` | 4-10 | 7 |

Plus two *different* unions that do not match: `llm/SessionMemory.ts:35-36` adds `interview`/`coding`/`negotiation`, and `llm/ProviderRouter.ts:207` has 4 values driving provider fallback order.

**Strongly consider making `ModesManager.ModeTemplateType` the single exported source and having the other five import it.** That converts this from a recurring 6-place edit into a one-place edit, and it is the reason this keeps drifting.

### Four exhaustive maps break at compile time — that is the checklist, not a problem

```
llm/modeProfiles.ts:109      MODE_CONTEXT_PROFILES
llm/ProviderRouter.ts:408    modePreferences
services/ModesManager.ts:131 TEMPLATE_NOTE_SECTIONS
services/ModesManager.ts:208 TEMPLATE_SYSTEM_PROMPTS
```

### Two things fail only at RUNTIME — the compiler will not catch these

1. **`ModesManager.ts:222-235`** — the startup invariant loop iterates `TEMPLATE_SYSTEM_PROMPTS` and warns if a prompt does not start with a shared prefix. It reads whatever is in the map, so a stale entry surfaces as a console warning at launch, not a build error.
2. **`MeetingModeDetector`'s scoring math** — narrowing the candidate set changes score normalization. Removing modes silently shifts which mode wins. **Re-check the arithmetic, do not just delete list entries.**

### Also retire with this phase

- The 6 non-sales prompts in `llm/prompts.ts` (`MODE_LOOKING_FOR_WORK` / `RECRUITING` / `TEAM_MEET` / `LECTURE` / `TECHNICAL_INTERVIEW` / `SEMINAR`), ~650 lines.
- `llm/codingStreamGate.ts` — still used by the coding chat path; it retires with Phase 4, not here.

---

## Standing decisions

- **Keep `general`.** Do not collapse to a single mode.
- **Keep Codex** (`CodexCliService` / `CodexOAuthService`). It is ChatGPT OAuth — subscription access, not duplicate OpenAI-key support. Removing it forces users onto per-token billing. Pricing decision, not scope.
- **Keep the Skills engine**, drop only its settings UI. Cheapest future home for MEDDIC / Challenger / Sandler packs.
- **Keep `ImageOptimizer`** — still live for image attachments.
- **Keep `ScreenContext` (the interface).** Nothing populates it now, but four signatures thread it and `PromptAssembler` renders it when given one, so a future screen-share reader reuses the seam.

---

## Phase 4 — REQUIRED SEQUENCING (discovered, changes the plan's order)

The plan treats Phase 4 as "narrow `AnswerType` from 38 members". **You cannot start there.** Roughly 20 of those members are the *output* of Profile Intelligence — `identity_answer`, `profile_fact_answer`, `skills_answer`, `experience_answer`, `jd_fit_answer`, the five `jd_*` / `resume_jd_*` shapes, `behavioral_interview_answer`, `gap_analysis_answer`, and friends. Profile Intelligence is **still fully present** (`ProfileIntelligenceRouter`, `ProfileOutputValidator`, `ProfileTreeService`, and the `resume` / `jd` / `negotiation` context layers are live and populated). Remove the answer types while the router still routes to them and the app breaks at runtime.

**Correct order:**
1. Delete the Profile Intelligence backend (~5,200 lines) and `ProfileIntelligenceSettings.tsx` (~2,150).
2. Then narrow `AnswerType`.
3. Then remove `resume` / `jd` / `negotiation` from `ContextLayer`.

**On the plan's trap #1 (the sales leak-guard).** `AnswerPlanner.ts:1839-1845` has `sales_answer` forbid `['resume', 'jd', 'negotiation']`, and the plan warns the guard "disappears with" that vocabulary. Resolved by ordering: once Profile Intelligence is gone there is no résumé/JD/salary context left to leak, so the guard is not weakened by losing its list — it becomes genuinely moot. **But only in that order.** Removing the layers while the profile backend still populates them deletes a live protection. Mirror deny-sets naming `sales_answer` live at `ProfileOutputValidator.ts:130,545` and `ProfileIntelligenceRouter.ts:157` — they retire together.

**Do NOT remove with the interview types** (plan trap #2): `lecture_answer`, `definitional_answer`, `list_answer`, `exact_numeric_answer`, `document_structure_answer`, `document_followup_answer`. Sales modes default to `reference_files_primary`, and these are exactly what makes "answer from the product PDF / battlecard / pricing sheet" work. `lecture_answer` wants renaming, not deleting.

**Rewrite, do not drop** (trap #3): `ethical_usage_answer` is written in proctoring-evasion language but is a **safety route**. It needs sales framing — recording consent, honesty about being on a call.

`product_candidate_mix_answer` (trap #4) either folds into `sales_answer` or gets re-derived without the résumé dependency.

---

### Open question for the product owner

**Screenshot capture was NOT deleted**, though the plan lists `ScreenshotHelper` / `CropperWindowHelper` / `Cropper.tsx` under the screenshot-solve path. The *solve* half is gone. The *capture* half is live and user-facing — keyboard shortcut, area cropper, image attachment on a question, via `take-screenshot` and the still-used screenshot queues. Deleting it removes the ability to ask about anything on screen, which is plausibly a sales use (reading a prospect's shared slide). **Needs a call before anyone deletes it.**

---

## Commit trail

| Commit | What |
|---|---|
| `dbead21` | removed orphaned `natively-api` gitlink — this is what broke branch switching |
| `37311df` | dead coding-interview path out of `ProcessingHelper` / `LLMHelper` |
| `16d42cd` | verified code execution removed end to end, −4,289 |
| `060d19e` | plan doc |
| `f0e108b` | vision/OCR chain removed, −3,870 |
| `850acac` | dead screenshot state + vision provenance, −62 |
| `86a3a23` | plan doc: Phase 2 complete + deviations |
| `ef7cd34` | v26 migration + test (**test not yet run**) |

Everything through `86a3a23` is pushed. Verify `git status` before assuming.

### Why the gitlink fix mattered

`git submodule status` errored because `natively-api` was a submodule pointer with no `.gitmodules` entry and no URL recorded anywhere. Tools that shell out to it read the error as "uncommitted changes" and refused to switch branches. Removing the dead pointer fixed it.
