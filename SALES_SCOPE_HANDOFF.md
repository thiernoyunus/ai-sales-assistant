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
| 3 — mode collapse | **in progress** — DB migration landed, enum not yet narrowed |
| 4 — answer-type narrowing | not started |
| 5 — docs, tests, branding | not started |

### Verification status — read this before trusting anything below

- `npm run typecheck:electron` and `npx tsc --noEmit`: **both clean** as of `ef7cd34`.
- Full suite after the code-verification removal (`16d42cd`): **green, exit 0**.
- Full suite after the vision removal: **last observed 0 failures in 156 KB of output, still running.** Not yet confirmed end to end. Re-run and confirm before building on it.
- `electron/db/__tests__/ModeTemplateCollapseV26.test.mjs`: **written but never executed.** It needs `npm run build:electron` first, which could not run while the suite was reading `dist-electron/`. **Run this before anything else.**

```bash
npm run build:electron && node --test electron/db/__tests__/ModeTemplateCollapseV26.test.mjs
```

### Gotcha that cost time twice

Do not write `until ! pgrep -f "node --test"; do sleep 15; done`. `pgrep -f` matches the wait loop's **own** command line, so it never exits and looks exactly like a hung test suite. Use the background-task completion notification instead, or match on a pattern that cannot appear in your own process.

Also: `npm test | tail -40` buffers everything until the run ends, so the log looks empty for 20 minutes and reads as a hang. Redirect straight to a file. **The suite genuinely takes ~20 minutes** — that is normal, not a stall.

---

## Phase 3 — the remaining work

### What already landed: `ef7cd34`

A `user_version` 25 → 26 migration in [DatabaseManager.ts](electron/db/DatabaseManager.ts) remaps retired `modes.template_type` rows to `'general'`.

**This had to come first.** `template_type` is a free TEXT column, so upgrading installs hold literal strings like `'technical-interview'`. If the enum narrows before those rows are migrated, `getOrMigrateSourceContract` and the `ModesManager` startup invariant loop hit unhandled paths at launch.

**Deviation from the plan, on purpose.** The plan said remap every row to `'sales'`. This maps to `'general'` instead: `'general'` survives the narrowing as the neutral fallback (`general_meeting_answer` is a load-bearing floor type in `modeProfiles.ts:142-145`), and remapping to `'sales'` would silently turn a user's "Weekly standup" mode into sales prompting. `'__reserved__'` is preserved — it is the v23 FK sentinel for profile OKF cards, not a user template. **If the product owner prefers `'sales'`, change the one `UPDATE` and its test.**

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
