// tests/intelligence/e2e/fixtures/fixtures.mjs
//
// Synthetic fixtures for the Natively Intelligence 100-question E2E suite.
//
// PRIVACY: all names/projects/companies here are FAKE and exist ONLY to exercise
// the intelligence *services* (MeetingMemory, Search, Conversation) which take
// injected data. The REAL profile (resume/JD) is read from the
// safe DB copy by the harness for the manual + WTA (categories A/B/C/D) live path
// — these fixtures never replace it.
//
//   User A = Alice Varma   (project AtlasDB)
//   User B = Bob Menon     (project CloudCart)
//
// Used so categories E/F/G/I/J/K can drive the deterministic engines with known
// data and assert exact behavior (right meeting retrieved, isolation, etc.).

export const USER_A = { userId: 'user_alice', orgId: 'org_acme', name: 'Alice Varma', project: 'AtlasDB' };
export const USER_B = { userId: 'user_bob', orgId: 'org_beta', name: 'Bob Menon', project: 'CloudCart' };

// ── Live transcript fixture (Category C — what-to-answer) ────────────────────
// Interviewer asks about Redis scaling, latency optimization, system-design
// tradeoffs, salary, project ownership. Speakers: interviewer / candidate.
export const LIVE_TRANSCRIPT = [
  { speaker: 'interviewer', text: 'Thanks for joining. To start, can you introduce yourself?' },
  { speaker: 'candidate', text: 'Sure, happy to be here.' },
  { speaker: 'interviewer', text: 'How would you scale Redis to handle ten times the current load?' },
  { speaker: 'candidate', text: 'Good question, let me think about partitioning.' },
  { speaker: 'interviewer', text: 'And how do you approach latency optimization in a read-heavy service?' },
  { speaker: 'interviewer', text: 'What are the tradeoffs you weigh when doing system design for a high-throughput pipeline?' },
  { speaker: 'interviewer', text: 'What are your salary expectations for this role?' },
  { speaker: 'interviewer', text: 'Tell me about a project where you owned the end-to-end delivery.' },
];

// ── Meeting memory fixtures (Category E) ─────────────────────────────────────
// Meeting1 interview re Redis+scaling, Meeting2 sales call pricing objection,
// Meeting3 team meeting action items.
export const MEETING_1 = {
  meetingId: 'm1_interview_redis',
  title: 'Backend Engineer Interview — Redis & Scaling',
  mode: 'technical-interview',
  date: 1_700_000_000_000,
  segments: [
    { speaker: 'interviewer', text: 'How would you scale Redis horizontally under heavy write load?', timestamp: 1000 },
    { speaker: 'candidate', text: 'I would use Redis Cluster with consistent hashing for sharding.', timestamp: 2000 },
    { speaker: 'interviewer', text: 'What about caching strategy and eviction policies?', timestamp: 3000 },
    { speaker: 'candidate', text: 'We decided to go with an LRU eviction policy for the hot keys.', timestamp: 4000 },
    { speaker: 'interviewer', text: 'Important: remember that scalability requires sharding the dataset.', timestamp: 5000 },
  ],
};

export const MEETING_2 = {
  meetingId: 'm2_sales_pricing',
  title: 'Sales Call — Acme Pricing Objection',
  mode: 'sales',
  date: 1_700_100_000_000,
  segments: [
    { speaker: 'prospect', text: 'Honestly your pricing is too high compared to competitors.', timestamp: 1000 },
    { speaker: 'rep', text: 'I understand the pricing concern. Let me walk through the ROI.', timestamp: 2000 },
    { speaker: 'prospect', text: 'Can we get a discount on the enterprise tier?', timestamp: 3000 },
    { speaker: 'rep', text: 'We agreed to offer a 15 percent discount for an annual commitment.', timestamp: 4000 },
    { speaker: 'rep', text: 'Action item: I will send the revised pricing proposal by Friday.', timestamp: 5000 },
  ],
};

export const MEETING_3 = {
  meetingId: 'm3_team_actions',
  title: 'Team Standup — Sprint Action Items',
  mode: 'team-meet',
  date: 1_700_200_000_000,
  segments: [
    { speaker: 'lead', text: 'We need to migrate the auth service to the new gateway this sprint.', timestamp: 1000 },
    { speaker: 'dev1', text: 'I will take the migration and have it ready by Wednesday.', timestamp: 2000 },
    { speaker: 'lead', text: 'Action item: Priya to update the deployment runbook.', timestamp: 3000 },
    { speaker: 'dev2', text: 'We decided to postpone the Kafka upgrade to next sprint.', timestamp: 4000 },
    { speaker: 'lead', text: 'Follow-up: schedule a security review before release.', timestamp: 5000 },
  ],
};

export const ALL_MEETINGS = [MEETING_1, MEETING_2, MEETING_3];

// ── Global search candidate corpus (Category F) ──────────────────────────────
// Pre-fetched SearchCandidate[] shape the SearchOrchestrator fuses. Includes
// candidates owned by BOTH Alice and Bob to prove isolation in search.
export function buildGlobalSearchCandidates() {
  const A = USER_A, B = USER_B;
  return [
    // Alice's meetings
    { meetingId: 'm1_interview_redis', title: 'Redis Scaling Interview', date: MEETING_1.date, mode: 'technical-interview', snippet: 'scale Redis horizontally under heavy write load with consistent hashing', source: 'lexical', score: 0.92, userId: A.userId, orgId: A.orgId, metadata: { company: 'Acme', hasInterviewQuestions: 'true' } },
    { meetingId: 'm1_interview_redis', title: 'Redis Scaling Interview', date: MEETING_1.date, mode: 'technical-interview', snippet: 'sharding and eviction policy discussion', source: 'vector', score: 0.81, userId: A.userId, orgId: A.orgId },
    { meetingId: 'm2_sales_pricing', title: 'Acme Pricing Objection', date: MEETING_2.date, mode: 'sales', snippet: 'pricing is too high, 15 percent discount for annual commitment', source: 'lexical', score: 0.78, userId: A.userId, orgId: A.orgId, metadata: { company: 'Acme', hasActionItems: 'true' } },
    { meetingId: 'm3_team_actions', title: 'Sprint Action Items', date: MEETING_3.date, mode: 'team-meet', snippet: 'migrate the auth service, update deployment runbook', source: 'lexical', score: 0.70, userId: A.userId, orgId: A.orgId, metadata: { hasActionItems: 'true' } },
    { meetingId: 'm3_team_actions', title: 'Sprint Action Items', date: MEETING_3.date, mode: 'team-meet', snippet: 'kafka upgrade postponed', source: 'memory', score: 0.55, userId: A.userId, orgId: A.orgId },
    // Bob's meeting — must NEVER surface for Alice's scope
    { meetingId: 'b1_cloudcart', title: 'CloudCart Architecture Review', date: MEETING_1.date, mode: 'technical-interview', snippet: 'CloudCart Redis scaling and sharding strategy', source: 'lexical', score: 0.99, userId: B.userId, orgId: B.orgId, metadata: { company: 'Beta' } },
  ];
}

// ── In-meeting search fixture (Category G) ───────────────────────────────────
// Finalized chunks of the CURRENT meeting (Meeting1) to search locally.
export function buildInMeetingChunks() {
  return MEETING_1.segments.map((s) => ({ text: s.text, timestampMs: s.timestamp, speaker: s.speaker }));
}

