import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRemainingSeconds,
  computeCountdownParts,
  calculateTryoutScore,
  rankLeaderboardEntries,
  applyAnswerToMastery,
  confirmUnderstoodMastery,
  validateQuestionImportPayload,
  resolveAllowedOAuthOrigin,
  normalizeOriginUrl,
  resolveDiscordRedirectUri,
  normalizeQuestionHash,
  assignTryoutSubtestBoundaries,
  validatePdfDraftBeforeCommit,
  buildDrillingCatalogTree,
  normalizeCropBoxWithPadding,
  bboxIoU,
  deduplicateAndOrderDraftAssets,
  findVisualMissingWarnings,
  filterCarouselCardsForPackages,
  stripMarkdownCodeFences,
  extractJsonSubstring,
  repairTruncatedOrMalformedJson,
  parseAndRepairAiJson,
  isRetryableProviderError,
  canApproveChecklist,
  detectMajorQuestionChange,
  aggregateStudyTimeLogs,
  buildPublicProfilePayload,
  isTrustedPostMessageOrigin,
  type MasteryState,
} from './utbkLogic';
import type {
  PdfImportDraftItem,
  StudyTimeLog,
  TryoutCarouselCard,
  TryoutDraftSubtest,
  TryoutPackage,
} from '../types';

test('server-authoritative timer prevents refresh extra time', () => {
  const startIso = '2026-11-19T00:00:00.000Z';
  const nowMs = new Date('2026-11-19T00:05:30.000Z').getTime();
  assert.equal(computeRemainingSeconds(startIso, 900, nowMs), 570);
  const expiredMs = new Date('2026-11-19T00:20:00.000Z').getTime();
  assert.equal(computeRemainingSeconds(startIso, 900, expiredMs), 0);
});

test('countdown breakdown calculates days, hours, minutes, seconds accurately', () => {
  const now = new Date('2026-11-19T00:00:00.000Z').getTime();
  const target = new Date(now + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000).toISOString();
  const parts = computeCountdownParts(target, now);
  assert.deepEqual(parts, { days: 2, hours: 3, minutes: 4, seconds: 5, isExpired: false });
});

test('UTBK configurable scoring evaluates raw counts and subtest scores separately', () => {
  const result = calculateTryoutScore(
    [
      { questionId: 1, subtest: 'Penalaran Umum', selected: ['A'], correct: ['A'] },
      { questionId: 2, subtest: 'Penalaran Umum', selected: ['B'], correct: ['C'] },
      { questionId: 3, subtest: 'Penalaran Kuantitatif', selected: [], correct: ['D'] },
      { questionId: 4, subtest: 'Penalaran Kuantitatif', selected: ['D'], correct: ['D'] },
    ],
    { baseScore: 300, maxScore: 1000, wrongPenalty: 0 }
  );
  assert.equal(result.correctCount, 2);
  assert.equal(result.wrongCount, 1);
  assert.equal(result.blankCount, 1);
  assert.equal(result.utbkScore, 650);
  assert.equal(result.subtestScores['Penalaran Umum'].score, 650);
  assert.equal(result.subtestScores['Penalaran Kuantitatif'].score, 650);
});

test('leaderboard uses highest score per user regardless of mode and tie-breaks by active time', () => {
  const ranked = rankLeaderboardEntries([
    { userId: 1, username: 'Andi', avatarUrl: '', utbkScore: 720, activeDurationSeconds: 3000, completedAt: '2026-11-18T10:00:00Z' },
    { userId: 1, username: 'Andi', avatarUrl: '', utbkScore: 780, activeDurationSeconds: 3200, completedAt: '2026-11-19T10:00:00Z' },
    { userId: 2, username: 'Budi', avatarUrl: '', utbkScore: 780, activeDurationSeconds: 2900, completedAt: '2026-11-19T11:00:00Z' },
    { userId: 3, username: 'Citra', avatarUrl: '', utbkScore: 750, activeDurationSeconds: 2500, completedAt: '2026-11-19T12:00:00Z' },
  ]);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].username, 'Budi');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].username, 'Andi');
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].username, 'Citra');
  assert.equal(ranked[2].rank, 3);
});

test('ragu indicator persists across correct answers and retains history after Saya Sudah Paham', () => {
  let state: MasteryState = {
    isRaguActive: false,
    wasEverRagu: false,
    raguCount: 0,
    correctCount: 0,
    wrongCount: 0,
    status: 'learned',
    understoodAt: null,
  };
  state = applyAnswerToMastery(state, { isCorrect: true, markRagu: true });
  assert.equal(state.isRaguActive, true);
  assert.equal(state.wasEverRagu, true);
  assert.equal(state.raguCount, 1);
  assert.equal(state.correctCount, 1);

  state = applyAnswerToMastery(state, { isCorrect: true });
  assert.equal(state.isRaguActive, true);
  assert.equal(state.status, 'ragu');

  state = confirmUnderstoodMastery(state, '2026-11-19T08:00:00.000Z');
  assert.equal(state.isRaguActive, false);
  assert.equal(state.wasEverRagu, true);
  assert.equal(state.raguCount, 1);
  assert.equal(state.status, 'understood');
  assert.equal(state.understoodAt, '2026-11-19T08:00:00.000Z');
});

test('question JSON validation catches missing options, duplicates, and unbalanced LaTeX', () => {
  const existing = new Set([normalizeQuestionHash('Jika semua A adalah B maka?')]);
  const res = validateQuestionImportPayload(
    {
      subject: 'Penalaran Umum',
      questions: [
        {
          id: 'PU100',
          topic: 'Logika',
          question: 'Jika semua A adalah B maka?',
          options: [{ key: 'A', content: 'Benar' }, { key: 'B', content: 'Salah' }],
          correct_answer: ['A'],
          explanation: 'Nilai $x = 2',
        },
      ],
    },
    existing
  );
  assert.equal(res.valid, true);
  assert.equal(res.normalizedQuestions[0].needsReview, true);
  assert.ok(res.warnings[0].includes('duplikat'));
  assert.ok(res.warnings[0].includes('LaTeX'));
});

test('Discord OAuth origin resolver keeps dev, shared Cloud Run, and production .ai.studio origins while blocking untrusted domains', () => {
  const devUrl = 'https://ais-dev-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app';
  const sharedUrl = 'https://ais-pre-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app';
  const prodAiStudioUrl = 'https://ganesha-circle-komunitas-belajar-utbk.ai.studio';
  assert.equal(resolveAllowedOAuthOrigin(`${sharedUrl}/`, devUrl, devUrl), sharedUrl);
  assert.equal(resolveAllowedOAuthOrigin(`${prodAiStudioUrl}/`, devUrl, devUrl), prodAiStudioUrl);
  assert.equal(resolveAllowedOAuthOrigin('https://evil.ai.studio', devUrl, devUrl), devUrl);
  assert.equal(resolveAllowedOAuthOrigin('https://evil.example.com', devUrl, devUrl), devUrl);
  assert.equal(resolveAllowedOAuthOrigin('https://attacker-other.run.app', devUrl, devUrl), devUrl);
  assert.equal(resolveAllowedOAuthOrigin('http://localhost:3000/', devUrl, devUrl), devUrl);
  assert.equal(resolveAllowedOAuthOrigin('http://localhost:3000/', 'http://localhost:3000', devUrl), 'http://localhost:3000');
  assert.equal(normalizeOriginUrl('http://ais-dev-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app:8080/'), devUrl);
  assert.equal(normalizeOriginUrl('http://ganesha-circle-komunitas-belajar-utbk.ai.studio/'), prodAiStudioUrl);
  assert.equal(
    resolveDiscordRedirectUri({ requestedOrigin: prodAiStudioUrl, fallbackOrigin: devUrl, envAppUrl: devUrl }),
    `${prodAiStudioUrl}/auth/callback`
  );
  assert.equal(
    resolveDiscordRedirectUri({ requestedOrigin: devUrl, fallbackOrigin: devUrl, envAppUrl: devUrl }),
    `${devUrl}/auth/callback`
  );
  assert.equal(
    resolveDiscordRedirectUri({
      requestedOrigin: devUrl,
      fallbackOrigin: devUrl,
      envAppUrl: devUrl,
      explicitRedirectUri: 'https://custom.example.com/auth/callback',
    }),
    'https://custom.example.com/auth/callback'
  );
});

test('PDF draft validation flags missing answer keys without fabricating and blocks commit until filled', () => {
  const draft: PdfImportDraftItem[] = [
    {
      temp_id: 'q1',
      question_number: 1,
      external_code: 'PDF-1',
      subtest: 'Penalaran Kuantitatif',
      topic: 'Aljabar',
      subtopic: 'Persamaan Linear',
      difficulty: 'medium',
      question_type: 'single_choice',
      question_text: 'Jika 2x + 3 = 11 maka x = ?',
      image_url: null,
      has_visual: false,
      visual_description: '',
      options: [
        { key: 'A', content: '3' },
        { key: 'B', content: '4' },
      ],
      correct_answer: [],
      explanation_text: '',
      solution_text: '',
      needs_review: true,
      review_note: '',
    },
  ];
  const resStrict = validatePdfDraftBeforeCommit(draft, new Set(), { allowMissingKeys: false });
  assert.equal(resStrict.valid, false);
  assert.equal(resStrict.reviewCount, 1);
  assert.ok(resStrict.blockingErrors[0].includes('kunci jawaban'));

  const resPermissive = validatePdfDraftBeforeCommit(draft, new Set(), { allowMissingKeys: true });
  assert.equal(resPermissive.valid, true);
  assert.equal(resPermissive.itemsWithFlags[0].needs_review, true);
});

test('Tryout dynamic subtest boundary assignment supports arbitrary counts and reassignments', () => {
  const subtests: TryoutDraftSubtest[] = [
    { temp_id: 's1', subtest_code: 'PU', subtest_name: 'Penalaran Umum', duration_seconds: 1800, sort_order: 1, start_number: 1, end_number: 2 },
    { temp_id: 's2', subtest_code: 'PK', subtest_name: 'Penalaran Kuantitatif', duration_seconds: 1200, sort_order: 2, start_number: 3, end_number: 5 },
  ];
  const makeQ = (n: number, subtestTempId?: string): PdfImportDraftItem => ({
    temp_id: `q${n}`,
    question_number: n,
    external_code: `TO-${n}`,
    subtest: '',
    topic: 'Umum',
    subtopic: '',
    difficulty: 'medium',
    question_type: 'single_choice',
    question_text: `Soal nomor ${n}`,
    image_url: null,
    has_visual: false,
    visual_description: '',
    options: [
      { key: 'A', content: '1' },
      { key: 'B', content: '2' },
    ],
    correct_answer: ['A'],
    explanation_text: 'Pembahasan',
    solution_text: '',
    needs_review: false,
    review_note: '',
    subtest_temp_id: subtestTempId,
  });

  const { grouped, unassignedCount } = assignTryoutSubtestBoundaries(
    [makeQ(1), makeQ(2), makeQ(3), makeQ(4), makeQ(5, 's1')],
    subtests
  );
  assert.equal(unassignedCount, 0);
  assert.equal(grouped[0].questions.map((q) => q.question_number).join(','), '1,2,5');
  assert.equal(grouped[1].questions.map((q) => q.question_number).join(','), '3,4');
});

test('Drilling catalog tree aggregates subtests, topics, and subtopics cleanly', () => {
  const tree = buildDrillingCatalogTree([
    { subtest: 'Penalaran Kuantitatif', topic: 'Aljabar', subtopic: 'Persamaan Kuadrat', question_count: 5 },
    { subtest: 'Penalaran Kuantitatif', topic: 'Aljabar', subtopic: 'Pertidaksamaan', question_count: 3 },
    { subtest: 'Penalaran Kuantitatif', topic: 'Geometri', subtopic: '', question_count: 4 },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].totalQuestions, 12);
  assert.equal(tree[0].topics[0].topic, 'Aljabar');
  assert.equal(tree[0].topics[0].totalQuestions, 8);
  assert.equal(tree[0].topics[0].subtopics.length, 2);
});

test('Crop bounding box padding expands safely within 0..1000 and computes IoU accurately', () => {
  const padded = normalizeCropBoxWithPadding([100, 10, 400, 990], 30);
  assert.deepEqual(padded, [70, 0, 430, 1000]);

  const same = bboxIoU([100, 100, 300, 300], [100, 100, 300, 300]);
  assert.equal(same, 1);
  const disjoint = bboxIoU([0, 0, 100, 100], [200, 200, 300, 300]);
  assert.equal(disjoint, 0);
});

test('Multi-image draft assets preserve order, deduplicate shared URLs, and detect missing visuals', () => {
  const ordered = deduplicateAndOrderDraftAssets([
    { asset_url: '/uploads/question_assets/b.png', asset_type: 'cropped', display_order: 2 },
    { asset_url: '/uploads/question_assets/a.png', asset_type: 'embedded', display_order: 0 },
    { asset_url: '/uploads/question_assets/b.png', asset_type: 'shared', display_order: 5 },
  ]);
  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].asset_url, '/uploads/question_assets/a.png');
  assert.equal(ordered[0].display_order, 0);
  assert.equal(ordered[1].display_order, 1);

  const warnings = findVisualMissingWarnings([
    {
      temp_id: 'q1',
      question_number: 1,
      external_code: 'DR-1',
      subtest: 'PM',
      topic: 'Geometri',
      subtopic: '',
      difficulty: 'medium',
      question_type: 'single_choice',
      question_text: 'Perhatikan gambar berikut.',
      image_url: null,
      assets: [],
      has_visual: true,
      visual_description: 'Segitiga siku-siku',
      options: [{ key: 'A', content: '10' }, { key: 'B', content: '20' }],
      correct_answer: ['A'],
      explanation_text: '',
      solution_text: '',
      needs_review: true,
      review_note: '',
    },
  ]);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('No. 1'));
});

test('Dashboard carousel filtering respects active status and user package access', () => {
  const packages: TryoutPackage[] = [
    {
      id: 1,
      title: 'TO #1',
      provider: 'Sainsin',
      description: '',
      cover_url: null,
      is_published: true,
      starts_at: null,
      ends_at: null,
      subtests: [],
    },
    {
      id: 2,
      title: 'TO Draft',
      provider: 'Komunitas',
      description: '',
      cover_url: null,
      is_published: false,
      starts_at: null,
      ends_at: null,
      subtests: [],
    },
  ];
  const cards: TryoutCarouselCard[] = [
    { id: 1, package_id: 1, title: 'Card 1', description: '', image_url: '', status_label: '', package_label: '', cta_label: '', cta_target: 'tryout', sort_order: 2, is_active: true },
    { id: 2, package_id: 2, title: 'Card Draft', description: '', image_url: '', status_label: '', package_label: '', cta_label: '', cta_target: 'tryout', sort_order: 1, is_active: true },
    { id: 3, package_id: null, title: 'Card Global', description: '', image_url: '', status_label: '', package_label: '', cta_label: '', cta_target: 'tryout', sort_order: 1, is_active: true },
    { id: 4, package_id: 1, title: 'Card Hidden', description: '', image_url: '', status_label: '', package_label: '', cta_label: '', cta_target: 'tryout', sort_order: 0, is_active: false },
  ];

  const userVisible = filterCarouselCardsForPackages(cards, packages, false);
  assert.deepEqual(userVisible.map((c) => c.title), ['Card Global', 'Card 1']);

  const adminVisible = filterCarouselCardsForPackages(cards, packages, true);
  assert.deepEqual(adminVisible.map((c) => c.title), ['Card Draft', 'Card Global', 'Card 1']);
});

test('AI JSON repair strips fences, extracts prose-wrapped JSON, and fixes truncated/trailing-comma structures', () => {
  const fenced = 'Berikut hasil ekstraksi:\n```json\n{"questions":[{"id":1,"text":"Baris 1\nBaris 2",}],}\n```\nSemoga membantu!';
  assert.equal(stripMarkdownCodeFences(fenced), '{"questions":[{"id":1,"text":"Baris 1\nBaris 2",}],}');
  assert.equal(extractJsonSubstring(fenced).startsWith('{'), true);

  const repaired = repairTruncatedOrMalformedJson('Preamble {"questions":[{"id":"Q1","text":"Halo\nDunia"},');
  const parsedTruncated = parseAndRepairAiJson<{ questions: Array<{ id: string; text: string }> }>(repaired);
  assert.equal(parsedTruncated.ok, true);
  if (parsedTruncated.ok) {
    assert.equal(parsedTruncated.data.questions[0].id, 'Q1');
    assert.equal(parsedTruncated.data.questions[0].text, 'Halo\nDunia');
  }

  const parsedFenced = parseAndRepairAiJson<{ questions: Array<{ id: number }> }>(fenced);
  assert.equal(parsedFenced.ok, true);
  if (parsedFenced.ok) {
    assert.equal(parsedFenced.repaired, true);
    assert.equal(parsedFenced.data.questions[0].id, 1);
  }
});

test('Provider fallback classifier retries transient errors only and blocks invalid PDF or validation errors', () => {
  assert.equal(isRetryableProviderError(429, 'Rate limit exceeded'), true);
  assert.equal(isRetryableProviderError(503, 'Service unavailable'), true);
  assert.equal(isRetryableProviderError(undefined, 'Request timed out after 30s'), true);

  assert.equal(isRetryableProviderError(400, 'Invalid PDF buffer uploaded'), false);
  assert.equal(isRetryableProviderError(422, 'Validation error: minimal harus 2 opsi'), false);
  assert.equal(isRetryableProviderError(401, 'Unauthorized API key'), false);
});

test('Review audit checklist enforces all required QC checks before approval', () => {
  const incomplete = canApproveChecklist({
    clear_wording: true,
    valid_subtest: true,
  });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.missingLabels.length > 0);

  const complete = canApproveChecklist({
    clear_wording: true,
    valid_subtest: true,
    valid_topic_subtopic: true,
    complete_options: true,
    valid_answer_key: true,
    valid_explanation: true,
    no_duplicate: true,
    ready_for_students: true,
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.missingLabels.length, 0);
});

test('Major question change detector catches key/stem/option/image edits but ignores minor metadata tweaks', () => {
  const base = {
    question_text: 'Berapakah 2 + 2?',
    options: [
      { key: 'A', content: '3' },
      { key: 'B', content: '4' },
    ],
    correct_answer: ['B'],
    image_url: null,
    subtest: 'Penalaran Kuantitatif',
  };
  assert.equal(detectMajorQuestionChange(base, { ...base }), false);
  assert.equal(detectMajorQuestionChange(base, { ...base, correct_answer: ['A'] }), true);
  assert.equal(detectMajorQuestionChange(base, { ...base, question_text: 'Berapakah 2 + 3?' }), true);
  assert.equal(detectMajorQuestionChange(base, { ...base, image_url: '/uploads/a.png' }), true);
});

test('Study time aggregation builds daily, weekly, and monthly buckets plus period comparison deltas', () => {
  const logs: StudyTimeLog[] = [
    { id: 1, user_id: 7, study_date: '2026-11-18', duration_minutes: 90, note: 'PU', created_at: '', updated_at: '' },
    { id: 2, user_id: 7, study_date: '2026-11-17', duration_minutes: 60, note: 'PK', created_at: '', updated_at: '' },
    { id: 3, user_id: 7, study_date: '2026-11-10', duration_minutes: 100, note: 'LBI', created_at: '', updated_at: '' },
    { id: 4, user_id: 7, study_date: '2026-10-15', duration_minutes: 120, note: 'PBM', created_at: '', updated_at: '' },
  ];

  const daily = aggregateStudyTimeLogs(logs, 'daily', '2026-11-18');
  assert.equal(daily.buckets.length, 14);
  assert.equal(daily.totalAllTimeMinutes, 370);
  assert.equal(daily.currentPeriodMinutes, 150);
  assert.equal(daily.previousPeriodMinutes, 100);
  assert.equal(daily.deltaMinutes, 50);
  assert.equal(daily.deltaPercent, 50);

  const weekly = aggregateStudyTimeLogs(logs, 'weekly', '2026-11-18');
  assert.equal(weekly.buckets.length, 8);
  assert.equal(weekly.buckets[weekly.buckets.length - 1].totalMinutes, 150);
  assert.equal(weekly.buckets[weekly.buckets.length - 2].totalMinutes, 100);

  const monthly = aggregateStudyTimeLogs(logs, 'monthly', '2026-11-18');
  assert.equal(monthly.buckets.length, 6);
  assert.equal(monthly.buckets[monthly.buckets.length - 1].totalMinutes, 250);
  assert.equal(monthly.buckets[monthly.buckets.length - 2].totalMinutes, 120);
});

test('Public profile builder enforces all 5 privacy flags strictly without leaking hidden fields', () => {
  const baseInput = {
    user: { id: 10, username: 'Rina', avatar_url: 'https://cdn.example/a.png', joined_at: '2026-01-01', target_score: 760 },
    tryoutStats: {
      completedCount: 4,
      bestScore: 780,
      averageScore: 710,
      recentScores: [{ packageTitle: 'TO #1', utbkScore: 780, completedAt: '2026-11-18T10:00:00.000Z' }],
    },
    studyTimeStats: { totalMinutes: 540, thisWeekMinutes: 180, sessionsCount: 6 },
    subtestMastery: [{ subtest: 'Penalaran Umum', total: 8, understood: 5, learned: 2, ragu: 1, masteryPct: 63 }],
  };

  const privateProfile = buildPublicProfilePayload({
    ...baseInput,
    privacy: {
      profile_visible: false,
      show_target_score: true,
      show_tryout_stats: true,
      show_study_time: true,
      show_subtest_mastery: true,
    },
  });
  assert.equal(privateProfile.profileVisible, false);
  assert.equal(privateProfile.targetScore, null);
  assert.equal(privateProfile.tryoutStats, null);
  assert.equal(privateProfile.studyTimeStats, null);
  assert.equal(privateProfile.subtestMastery, null);

  const selective = buildPublicProfilePayload({
    ...baseInput,
    privacy: {
      profile_visible: true,
      show_target_score: false,
      show_tryout_stats: true,
      show_study_time: false,
      show_subtest_mastery: true,
    },
  });
  assert.equal(selective.profileVisible, true);
  assert.equal(selective.targetScore, null);
  assert.deepEqual(selective.tryoutStats, baseInput.tryoutStats);
  assert.equal(selective.studyTimeStats, null);
  assert.equal(selective.subtestMastery?.length, 1);
});

test('postMessage origin guard accepts current origin and ais-dev/ais-pre siblings while rejecting untrusted origins', () => {
  const dev = 'https://ais-dev-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app';
  const pre = 'https://ais-pre-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app';
  assert.equal(isTrustedPostMessageOrigin(dev, dev), true);
  assert.equal(isTrustedPostMessageOrigin(pre, dev), true);
  assert.equal(isTrustedPostMessageOrigin('https://evil.example.com', dev), false);
});

