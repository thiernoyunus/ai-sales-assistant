// MeetingModeDetector.ts (Phase 10)
// Lightweight, deterministic mode detection from the first minutes of a transcript plus
// optional calendar metadata. It NEVER switches the live mode — it only produces a
// suggestion stored in summary.mode.detected* so the UI can offer "regenerate as <mode>".
//
// Pure (no I/O). Keyword/signal scoring; returns the best ModeTemplateType + a 0..1
// confidence. Ties and weak signals → low confidence → general.

import type { TranscriptSegment } from '../../SessionTracker';

// Kept separate from llm/modeProfiles' ModeTemplateType on purpose: this is what
// the detector is willing to GUESS, which is not necessarily every mode that
// exists. Today they happen to coincide.
export type DetectableTemplateType =
  | 'general'
  | 'sales';

export interface ModeDetectionInput {
  transcript: TranscriptSegment[];
  calendarTitle?: string;
  calendarDescription?: string;
  participants?: string[];
  // Only the first N ms of transcript are weighted (defaults to 5 min).
  openingWindowMs?: number;
}

export interface ModeDetectionResult {
  templateType: DetectableTemplateType;
  confidence: number; // 0..1
  scores: Record<DetectableTemplateType, number>;
  signals: string[];
}

// Weighted keyword signals per mode. Word-boundary matched, case-insensitive.
const SIGNALS: Record<Exclude<DetectableTemplateType, 'general'>, Array<{ re: RegExp; w: number; label: string }>> = {
  sales: [
    { re: /\b(pricing|price|quote|discount)\b/i, w: 2, label: 'pricing' },
    { re: /\b(demo|trial|pilot|poc|proof of concept)\b/i, w: 2, label: 'demo/pilot' },
    { re: /\b(budget|procurement|contract|proposal|sow)\b/i, w: 2, label: 'budget/procurement' },
    { re: /\b(objection|competitor|roi|use case|stakeholder)\b/i, w: 1, label: 'sales discovery' },
    { re: /\b(close|deal|renewal|upsell|expansion)\b/i, w: 1, label: 'deal' },
  ],
};

const TITLE_HINTS: Array<{ re: RegExp; type: DetectableTemplateType; w: number }> = [
  { re: /\b(sales|demo|discovery|pipeline|prospect)\b/i, type: 'sales', w: 3 },
];

function emptyScores(): Record<DetectableTemplateType, number> {
  return { general: 0, sales: 0 };
}

export class MeetingModeDetector {
  detect(input: ModeDetectionInput): ModeDetectionResult {
    const windowMs = input.openingWindowMs ?? 5 * 60 * 1000;
    const scores = emptyScores();
    const signals: string[] = [];

    const segments = Array.isArray(input.transcript) ? input.transcript : [];
    const firstTs = segments.find(s => s.timestamp > 0)?.timestamp ?? 0;
    const openingText = segments
      .filter(s => !firstTs || s.timestamp === 0 || s.timestamp - firstTs <= windowMs)
      .map(s => s.text || '')
      .join('\n');
    const fullText = segments.map(s => s.text || '').join('\n');

    // Transcript signals: opening window weighted 2x, rest 1x.
    for (const [type, sigs] of Object.entries(SIGNALS) as Array<[Exclude<DetectableTemplateType, 'general'>, typeof SIGNALS['sales']]>) {
      for (const sig of sigs) {
        const inOpening = sig.re.test(openingText);
        const inFull = sig.re.test(fullText);
        if (inOpening) { scores[type] += sig.w * 2; signals.push(`${type}:${sig.label}`); }
        else if (inFull) { scores[type] += sig.w; signals.push(`${type}:${sig.label}`); }
      }
    }

    // Calendar title/description hints.
    const titleText = `${input.calendarTitle || ''} ${input.calendarDescription || ''}`;
    if (titleText.trim()) {
      for (const hint of TITLE_HINTS) {
        if (hint.re.test(titleText)) { scores[hint.type] += hint.w; signals.push(`title:${hint.type}`); }
      }
    }

    // Pick the best non-general score.
    let best: DetectableTemplateType = 'general';
    let bestScore = 0;
    for (const [type, score] of Object.entries(scores) as Array<[DetectableTemplateType, number]>) {
      if (type === 'general') continue;
      if (score > bestScore) { bestScore = score; best = type; }
    }

    // Confidence is absolute signal strength only, normalized against a target
    // of ~12 points. This used to blend in a `margin` term (lead over the
    // runner-up, 40% weight) which made sense when six modes competed. With
    // sales the only non-general candidate there is never a runner-up, so
    // secondScore was always 0 and margin always equalled bestScore — the
    // formula would have counted the same number twice and inflated every
    // score. Restore the margin term if a third mode is ever added.
    if (bestScore < 3) {
      return { templateType: 'general', confidence: 0, scores, signals: dedupe(signals) };
    }
    const confidence = clamp01(bestScore / 12);

    return { templateType: best, confidence: round2(confidence), scores, signals: dedupe(signals) };
  }
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function dedupe(arr: string[]): string[] { return [...new Set(arr)]; }
