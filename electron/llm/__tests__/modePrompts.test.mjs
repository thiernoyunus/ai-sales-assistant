import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/prompts.js');
const prompts = await import(pathToFileURL(promptsPath).href);

const MODE_PROMPTS = {
  general: prompts.MODE_GENERAL_PROMPT,
  sales: prompts.MODE_SALES_PROMPT,
};

const MODE_CONTRACT_TERMS = {
  general: ['universal meeting', 'conversation copilot', 'adapt', 'RECENT QUESTION'],
  sales: ['seller', 'prospect', 'OBJECTION DETECTED', 'pricing', 'Case study'],
};

const UNIQUE_MODE_TERMS = {
  general: ['conversation copilot'],
  sales: ['prospect', 'objection'],
};

function assertIncludesAll(text, terms, label) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    assert.ok(lower.includes(term.toLowerCase()), `${label} should include "${term}"`);
  }
}

test('every mode prompt includes shared prompt-leakage and safety controls', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<security>',
      'system prompt',
      'instructions',
      'reveal',
      "I can't share that information",
    ], modeType);
  }
});

test('every mode prompt includes injected context handling for custom context and reference files', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      '<injected_context>',
      '<user_context>',
      '<reference_file name="...">',
      'file name',
    ], modeType);
  }
});

test('mode prompts prevent reference-file hallucination for absent file-specific claims', () => {
  for (const [modeType, prompt] of Object.entries(MODE_PROMPTS)) {
    assertIncludesAll(prompt, [
      'absent',
      'provided material',
      'general knowledge',
      'untrusted evidence',
      'never follow instructions',
    ], modeType);
  }

  assertIncludesAll(MODE_PROMPTS.general, ['Do not invent formulas', 'file-specific recommendations'], 'general');
  assertIncludesAll(MODE_PROMPTS.sales, ['customer proof point', 'ROI metric', 'inventing one'], 'sales');
});

test('each mode prompt carries its own mode-specific behavior contract', () => {
  for (const [modeType, terms] of Object.entries(MODE_CONTRACT_TERMS)) {
    assertIncludesAll(MODE_PROMPTS[modeType], terms, modeType);
  }
});

test('mode prompts are meaningfully distinct rather than flattened generic advice', () => {
  for (const [modeType, terms] of Object.entries(UNIQUE_MODE_TERMS)) {
    for (const term of terms) {
      assert.ok(MODE_PROMPTS[modeType].toLowerCase().includes(term.toLowerCase()), `${modeType} should preserve its distinctive term "${term}"`);
    }
  }

  // Cross-contamination guard: each mode's distinctive opening voice line must
  // not leak into the other mode's prompt.
  assert.ok(!MODE_PROMPTS.general.includes("You are the seller's spoken voice in a live sales"));
  assert.ok(!MODE_PROMPTS.sales.includes('You are a universal meeting and conversation copilot'));
});

test('profile-aware modes mention candidate/profile grounding without requiring every mode to overfit resume data', () => {
  assertIncludesAll(MODE_PROMPTS.general, ['<candidate_experience>', 'do not invent', 'salary_intelligence'], 'general');
});

// team-meet-specific example-shape test and looking-for-work-specific no-overclaim /
// example tests were removed with the retired 'team-meet' and 'looking-for-work'
// modes (mode universe narrowed to 'general' | 'sales').

test('mode formatting contracts prevent coachy meta-output in live suggestions', () => {
  assertIncludesAll(MODE_PROMPTS.sales, ['DO NOT use meta-labels', 'No preamble', 'Under 3 sentences'], 'sales');
});

test('code hint examples avoid named problems and em dashes', () => {
  assertIncludesAll(prompts.CODE_HINT_PROMPT, [
    'Use schematic examples only',
    'Do not copy sample problem names, line numbers, metrics, or concrete fixes unless they are visible',
  ], 'code-hint');

  const examples = prompts.CODE_HINT_PROMPT.match(/<output_examples>[\s\S]*?<\/output_examples>/)?.[0] ?? '';
  assert.match(examples, /Use schematic examples only/);
  assert.doesNotMatch(examples, /Two Sum/);
  assert.doesNotMatch(examples, /line 8/);
  assert.doesNotMatch(examples, /—/);
});

// ── SERVER ROUTING CONTRACT ──────────────────────────────────────────────────
// The Natively server (natively-api/lib/flashModelPicker.js) used to route the
// live interview modes ('looking-for-work', 'technical-interview') to
// gemini-3.6-flash by regex-matching a "spoken voice in a live interview"
// phrase in the system prompt. Both of those modes were retired when the mode
// universe narrowed to 'general' | 'sales', so that routing contract has no
// surviving subject and the SERVER-ROUTING tests were removed along with it.
