import * as crypto from 'crypto';

export type PostCallModeType =
  | 'general'
  | 'sales'
  // Widened with `| string` (not just the two surviving literals) because
  // callers pass whatever templateType a mode happens to have — including
  // custom modes — and unknown strings must still fall through safely below.
  | string;

export interface PostCallTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface StructuredActionItem {
  id: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestamp?: number;
}

export interface CoachingInsight {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: 'info' | 'opportunity' | 'warning';
  evidence?: string;
}

export interface PostCallEnhancements {
  schemaVersion: 2;
  actionItemsStructured: StructuredActionItem[];
  followUpDraft: string;
  coachingInsights: CoachingInsight[];
}

const ACTION_PATTERNS = [
  /\b(?:i|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:action|todo|follow up):\s*(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:send|share|schedule|book|prepare|review|follow up|circle back|introduce|email)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
];

const OWNER_PATTERN = /\b(I|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\b/;
const DEADLINE_PATTERN = /\b(?:by|before|on|after)\s+([^.!?]+)$/i;

export function buildPostCallEnhancements(params: {
  transcript: PostCallTranscriptSegment[];
  modeTemplateType?: PostCallModeType | null;
  summaryData?: { overview?: string; actionItems?: string[]; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> };
}): PostCallEnhancements {
  const actionItemsStructured = extractStructuredActionItems(params.transcript, params.summaryData?.actionItems ?? []);
  const coachingInsights = generateCoachingInsights(params.transcript, params.modeTemplateType, params.summaryData);

  return {
    schemaVersion: 2,
    actionItemsStructured,
    followUpDraft: buildFollowUpDraft(params.modeTemplateType, actionItemsStructured, params.summaryData),
    coachingInsights,
  };
}

export function extractStructuredActionItems(
  transcript: PostCallTranscriptSegment[],
  summaryActionItems: string[] = []
): StructuredActionItem[] {
  const items: StructuredActionItem[] = [];
  const seen = new Set<string>();

  const addItem = (text: string, sourceTimestamp?: number, owner?: string, deadline?: string) => {
    const cleaned = normalizeActionText(text);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: `action_${crypto.randomUUID()}`,
      text: cleaned,
      ...(owner ? { owner } : {}),
      ...(deadline ? { deadline: deadline.trim() } : {}),
      ...(typeof sourceTimestamp === 'number' ? { sourceTimestamp } : {}),
    });
  };

  for (const segment of transcript) {
    const text = segment.text.trim();
    if (!text) continue;

    for (const pattern of ACTION_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const owner = text.match(OWNER_PATTERN)?.[1];
      const deadline = match[2] ?? text.match(DEADLINE_PATTERN)?.[1];
      addItem(match[1] ?? text, segment.timestamp, normalizeOwner(owner), deadline);
      break;
    }
  }

  for (const item of summaryActionItems) {
    addItem(item);
  }

  return items.slice(0, 8);
}

export function buildFollowUpDraft(
  modeTemplateType: PostCallModeType | null | undefined,
  actionItems: StructuredActionItem[],
  summaryData?: { overview?: string; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> }
): string {
  // 'recruiting' used the same 'Hi,' greeting as 'sales' — retired along with
  // the recruiting mode, so this now keys off 'sales' alone.
  const greeting = modeTemplateType === 'sales'
    ? 'Hi,'
    : 'Hi team,';
  const lines = [greeting, '', 'Thanks for the conversation today.'];

  if (summaryData?.overview) {
    lines.push('', summaryData.overview.trim());
  }

  const nextSteps = actionItems.map(item => {
    const owner = item.owner ? `${item.owner}: ` : '';
    const deadline = item.deadline ? ` by ${item.deadline}` : '';
    return `- ${owner}${item.text}${deadline}`;
  });

  if (nextSteps.length > 0) {
    lines.push('', 'Next steps:', ...nextSteps);
  }

  if (nextSteps.length === 0) {
    lines.push('', 'I will follow up if anything else is needed.');
  }

  lines.push('', 'Best,');
  return lines.join('\n');
}

export function generateCoachingInsights(
  transcript: PostCallTranscriptSegment[],
  modeTemplateType: PostCallModeType | null | undefined,
  summaryData?: { sections?: Array<{ title: string; bullets: string[] }> }
): CoachingInsight[] {
  const text = transcript.map(segment => segment.text).join('\n');
  const insights: CoachingInsight[] = [];

  const add = (type: string, title: string, detail: string, severity: CoachingInsight['severity'], evidence?: string) => {
    insights.push({ id: `coach_${crypto.randomUUID()}`, type, title, detail, severity, ...(evidence ? { evidence } : {}) });
  };

  if (modeTemplateType === 'sales') {
    const hasObjection = /\b(price|pricing|cost|expensive|competitor|budget|too much|not sure)\b/i.test(text);
    const hasNextStep = /\b(next step|follow up|send|schedule|pilot|trial|contract|proposal)\b/i.test(text);
    if (hasObjection && !sectionHasContent(summaryData, 'Objections')) {
      add('missed_objection', 'Objection may need a clearer note', 'The conversation included objection language, but the objection section is empty.', 'opportunity', firstMatch(text, /[^.!?]*(?:price|pricing|cost|expensive|competitor|budget|too much|not sure)[^.!?]*/i));
    }
    if (!hasNextStep) {
      add('missing_next_step', 'Next step was not explicit', 'Consider ending sales calls with a concrete owner and follow-up date.', 'opportunity');
    }
  }
  // Retired: 'recruiting', 'looking-for-work' / 'technical-interview',
  // 'team-meet', and 'lecture' each had a coaching-insight branch here.
  // 'general', 'sales' (handled above), and any unknown string all fall
  // through to the fallback below with no insights added.

  return insights.slice(0, 5);
}

function normalizeActionText(value: string): string {
  return value
    .replace(/^\s*(?:action|todo|follow up):\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

function normalizeOwner(owner?: string): string | undefined {
  if (!owner) return undefined;
  const normalized = owner.trim();
  if (/^i$/i.test(normalized)) return 'Me';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sectionHasContent(
  summaryData: { sections?: Array<{ title: string; bullets: string[] }> } | undefined,
  title: string
): boolean {
  return Boolean(summaryData?.sections?.some(section => section.title.toLowerCase() === title.toLowerCase() && section.bullets.length > 0));
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0]?.trim();
}
