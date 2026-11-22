import type {
  AuditChecklistState,
  PdfImportDraftItem,
  PublicProfileResponse,
  QuestionAsset,
  StudyTimeLog,
  StudyTimePeriodBucket,
  StudyTimeSummary,
  TryoutCarouselCard,
  TryoutDraftSubtest,
  TryoutPackage,
  UserPrivacySettings,
} from '../types';

export interface ScoringFormulaConfig {
  baseScore: number;
  maxScore: number;
  wrongPenalty: number;
}

export interface AnswerEvaluationInput {
  questionId: number;
  subtest: string;
  selected: string[];
  correct: string[];
}

export interface ScoreResult {
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  totalQuestions: number;
  utbkScore: number;
  subtestScores: Record<string, { correct: number; wrong: number; blank: number; total: number; score: number }>;
}

export interface LeaderboardRawEntry {
  userId: number;
  username: string;
  avatarUrl: string;
  utbkScore: number;
  activeDurationSeconds: number;
  completedAt: string;
}

export interface LeaderboardRankedEntry extends LeaderboardRawEntry {
  rank: number;
}

export interface MasteryState {
  isRaguActive: boolean;
  wasEverRagu: boolean;
  raguCount: number;
  correctCount: number;
  wrongCount: number;
  status: 'ragu' | 'learned' | 'understood';
  understoodAt: string | null;
}

export interface QuestionImportItem {
  id?: string;
  type?: string;
  subtest?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  question?: string;
  image_url?: string | null;
  options?: Array<{ key?: string; content?: string }>;
  correct_answer?: string[];
  explanation?: string;
  solution?: string;
  needs_manual_review?: boolean;
  review_note?: string;
}

export interface QuestionImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedQuestions: Array<{
    externalCode: string;
    subtest: string;
    topic: string;
    subtopic: string;
    difficulty: 'easy' | 'medium' | 'hard';
    questionType: 'single_choice' | 'multiple_choice';
    questionText: string;
    imageUrl: string | null;
    options: Array<{ key: string; content: string }>;
    correctAnswer: string[];
    explanation: string;
    solution: string;
    needsReview: boolean;
    warnings: string[];
  }>;
}

export const PRODUCTION_CUSTOM_OAUTH_ORIGIN = 'https://ganesha-circle-komunitas-belajar-utbk.ai.studio';

/**
 * Normalizes an origin URL (forcing HTTPS for Cloud Run *.run.app and *.ai.studio hosts and stripping default/internal ports).
 */
export function normalizeOriginUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'MY_APP_URL') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    // Cloud Run and AI Studio terminate TLS at the load balancer; internal reverse proxies forward http
    const isManagedHttpsHost = host.endsWith('.run.app') || host.endsWith('.ai.studio');
    const proto = isManagedHttpsHost ? 'https:' : parsed.protocol;
    const rawPort = parsed.port;
    const stripPort =
      !rawPort ||
      (proto === 'https:' && rawPort === '443') ||
      (proto === 'http:' && rawPort === '80') ||
      (isManagedHttpsHost && rawPort === '8080');
    const portSuffix = stripPort ? '' : `:${rawPort}`;
    return `${proto}//${host}${portSuffix}`;
  } catch {
    return null;
  }
}

/**
 * Extracts trusted origin/host set from environment APP_URL (including its ais-dev / ais-pre sibling),
 * configured custom production domain, and optional extra allowed origins.
 */
export function getTrustedOAuthOrigins(envAppUrl?: string, extraOriginsRaw?: string | string[]): string[] {
  const origins: string[] = [];
  const normalizedEnv = normalizeOriginUrl(envAppUrl);
  if (normalizedEnv) {
    origins.push(normalizedEnv);
    if (normalizedEnv.includes('://ais-dev-')) {
      origins.push(normalizedEnv.replace('://ais-dev-', '://ais-pre-'));
    } else if (normalizedEnv.includes('://ais-pre-')) {
      origins.push(normalizedEnv.replace('://ais-pre-', '://ais-dev-'));
    }
  }

  const extrasList = Array.isArray(extraOriginsRaw)
    ? extraOriginsRaw
    : typeof extraOriginsRaw === 'string'
    ? extraOriginsRaw.split(',')
    : [];
  for (const item of [PRODUCTION_CUSTOM_OAUTH_ORIGIN, ...extrasList]) {
    const norm = normalizeOriginUrl(item);
    if (norm) origins.push(norm);
  }

  return Array.from(new Set(origins));
}

/**
 * Validates and resolves the exact OAuth origin to prevent redirect_uri mismatch
 * and open redirects by checking candidate hosts strictly against trusted origins and local dev origins.
 */
export function resolveAllowedOAuthOrigin(
  requestedOrigin: string | null | undefined,
  fallbackOrigin: string,
  envAppUrl?: string,
  extraOriginsRaw?: string | string[]
): string {
  const trustedFromEnv = getTrustedOAuthOrigins(envAppUrl, extraOriginsRaw);
  const trustedHosts = new Set(trustedFromEnv.map((o) => new URL(o).host));

  const fbNorm = normalizeOriginUrl(fallbackOrigin);
  const fbHost = fbNorm ? new URL(fbNorm).hostname : '';
  const isLocalFallback = fbHost === 'localhost' || fbHost === '127.0.0.1';

  const isTrusted = (candidate: string | null): boolean => {
    if (!candidate) return false;
    try {
      const parsed = new URL(candidate);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (trustedHosts.size > 0) {
        if (trustedHosts.has(parsed.host)) return true;
        // Allow localhost ONLY when the HTTP request itself originated locally
        if (isLocal && isLocalFallback && fbNorm === candidate) return true;
        return false;
      }
      if (isLocal) return true;
      if (fbNorm && new URL(fbNorm).host === parsed.host) return true;
      return false;
    } catch {
      return false;
    }
  };

  const reqNorm = normalizeOriginUrl(requestedOrigin);
  if (isTrusted(reqNorm)) return reqNorm!;

  if (isTrusted(fbNorm)) return fbNorm!;

  if (trustedFromEnv.length > 0) return trustedFromEnv[0];

  return fbNorm || fallbackOrigin.trim().replace(/\/+$/, '');
}

/**
 * Computes the exact Discord OAuth2 redirect_uri accounting for explicit DISCORD_REDIRECT_URI,
 * validated request host, environment APP_URL, and configured extra allowed origins.
 */
export function resolveDiscordRedirectUri(opts: {
  requestedOrigin?: string | null;
  fallbackOrigin: string;
  envAppUrl?: string;
  extraOriginsRaw?: string | string[];
  explicitRedirectUri?: string;
}): string {
  const explicit = (opts.explicitRedirectUri || '').trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return explicit;
      }
    } catch {
      // fall through to computed callback URI if malformed
    }
  }
  const origin = resolveAllowedOAuthOrigin(
    opts.requestedOrigin,
    opts.fallbackOrigin,
    opts.envAppUrl,
    opts.extraOriginsRaw
  );
  return `${origin}/auth/callback`;
}

/**
 * Normalizes question text for deterministic duplicate detection in unified Question Bank.
 */
export function normalizeQuestionHash(questionText: string): string {
  return questionText
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”"'`]/g, '')
    .trim();
}

/**
 * Groups Try Out questions into dynamic subtests based on question_number ranges or subtest_temp_id.
 */
export function assignTryoutSubtestBoundaries(
  questions: PdfImportDraftItem[],
  subtests: TryoutDraftSubtest[]
): {
  grouped: Array<TryoutDraftSubtest & { questions: PdfImportDraftItem[] }>;
  unassignedCount: number;
} {
  const orderedSubtests = [...subtests].sort((a, b) => a.sort_order - b.sort_order);
  const buckets = new Map<string, PdfImportDraftItem[]>();
  for (const st of orderedSubtests) {
    buckets.set(st.temp_id, []);
  }

  let unassignedCount = 0;

  for (const q of questions) {
    let matched: TryoutDraftSubtest | undefined;

    if (q.subtest_temp_id && buckets.has(q.subtest_temp_id)) {
      matched = orderedSubtests.find((s) => s.temp_id === q.subtest_temp_id);
    }

    if (!matched) {
      matched = orderedSubtests.find(
        (s) => q.question_number >= s.start_number && q.question_number <= s.end_number
      );
    }

    if (matched) {
      buckets.get(matched.temp_id)!.push({ ...q, subtest: matched.subtest_name, subtest_temp_id: matched.temp_id });
    } else if (orderedSubtests.length > 0) {
      unassignedCount += 1;
      const fallback = orderedSubtests[orderedSubtests.length - 1];
      buckets.get(fallback.temp_id)!.push({ ...q, subtest: fallback.subtest_name, subtest_temp_id: fallback.temp_id });
    } else {
      unassignedCount += 1;
    }
  }

  return {
    grouped: orderedSubtests.map((st) => ({
      ...st,
      questions: (buckets.get(st.temp_id) || []).sort((a, b) => a.question_number - b.question_number),
    })),
    unassignedCount,
  };
}

/**
 * Validates draft PDF questions before Admin approval & commit.
 * Ensures missing answer keys always stay flagged for manual review (never fabricated).
 */
export function validatePdfDraftBeforeCommit(
  items: PdfImportDraftItem[],
  existingHashes: Set<string> = new Set(),
  opts: { allowMissingKeys?: boolean } = {}
): {
  valid: boolean;
  blockingErrors: string[];
  reviewCount: number;
  duplicateCount: number;
  itemsWithFlags: PdfImportDraftItem[];
} {
  const blockingErrors: string[] = [];
  const seen = new Set<string>();
  let reviewCount = 0;
  let duplicateCount = 0;

  if (!Array.isArray(items) || items.length === 0) {
    return {
      valid: false,
      blockingErrors: ['Minimal harus ada 1 soal yang disetujui sebelum disimpan.'],
      reviewCount: 0,
      duplicateCount: 0,
      itemsWithFlags: [],
    };
  }

  const itemsWithFlags = items.map((item, idx) => {
    const label = `Soal No. ${item.question_number || idx + 1}`;
    const qText = (item.question_text || '').trim();
    const notes: string[] = [];
    let isDuplicate = false;

    if (!qText) {
      blockingErrors.push(`${label}: teks pertanyaan tidak boleh kosong.`);
    }

    const hash = normalizeQuestionHash(qText);
    if (hash && (existingHashes.has(hash) || seen.has(hash))) {
      isDuplicate = true;
      duplicateCount += 1;
      notes.push('Terindikasi duplikat dengan soal yang sudah ada di bank.');
    }
    if (hash) seen.add(hash);

    const cleanOptions = (item.options || []).filter((o) => o.content && o.content.trim().length > 0);
    if (cleanOptions.length < 2) {
      blockingErrors.push(`${label}: minimal harus memiliki 2 pilihan jawaban.`);
    }

    const cleanCorrect = (item.correct_answer || []).map((k) => k.trim().toUpperCase()).filter(Boolean);
    if (cleanCorrect.length === 0) {
      notes.push('Kunci jawaban belum tersedia di PDF — perlu diisi Admin sebelum publikasi.');
      if (!opts.allowMissingKeys) {
        blockingErrors.push(`${label}: kunci jawaban belum diisi.`);
      }
    } else {
      const optSet = new Set(cleanOptions.map((o) => o.key.trim().toUpperCase()));
      const invalidKeys = cleanCorrect.filter((k) => !optSet.has(k));
      if (invalidKeys.length > 0) {
        blockingErrors.push(`${label}: kunci jawaban (${invalidKeys.join(', ')}) tidak cocok dengan opsi tersedia.`);
      }
    }

    if (!item.explanation_text || !item.explanation_text.trim()) {
      notes.push('Pembahasan belum tersedia di sumber.');
    }

    const needsReview = Boolean(item.needs_review || notes.length > 0);
    if (needsReview) reviewCount += 1;

    return {
      ...item,
      options: cleanOptions,
      correct_answer: cleanCorrect,
      is_duplicate: isDuplicate,
      needs_review: needsReview,
      review_note: item.review_note || notes.join(' '),
    };
  });

  return {
    valid: blockingErrors.length === 0,
    blockingErrors,
    reviewCount,
    duplicateCount,
    itemsWithFlags,
  };
}

/**
 * Builds nested Drilling catalog structure (Subtest -> Topic -> Subtopics) from flat rows.
 */
export function buildDrillingCatalogTree(
  rows: Array<{ subtest: string; topic: string; subtopic?: string; question_count: number }>
): Array<{
  subtest: string;
  totalQuestions: number;
  topics: Array<{
    topic: string;
    totalQuestions: number;
    subtopics: Array<{ subtopic: string; question_count: number }>;
  }>;
}> {
  const bySubtest = new Map<
    string,
    Map<string, { total: number; subtopics: Array<{ subtopic: string; question_count: number }> }>
  >();

  for (const r of rows) {
    if (!bySubtest.has(r.subtest)) bySubtest.set(r.subtest, new Map());
    const topicMap = bySubtest.get(r.subtest)!;
    if (!topicMap.has(r.topic)) topicMap.set(r.topic, { total: 0, subtopics: [] });
    const entry = topicMap.get(r.topic)!;
    entry.total += r.question_count;
    const subName = (r.subtopic || '').trim();
    if (subName) {
      const existingSub = entry.subtopics.find((s) => s.subtopic === subName);
      if (existingSub) {
        existingSub.question_count += r.question_count;
      } else {
        entry.subtopics.push({ subtopic: subName, question_count: r.question_count });
      }
    }
  }

  return Array.from(bySubtest.entries()).map(([subtest, topicMap]) => {
    const topics = Array.from(topicMap.entries()).map(([topic, info]) => ({
      topic,
      totalQuestions: info.total,
      subtopics: info.subtopics.sort((a, b) => a.subtopic.localeCompare(b.subtopic)),
    }));
    const totalQuestions = topics.reduce((sum, t) => sum + t.totalQuestions, 0);
    return { subtest, totalQuestions, topics };
  });
}

/**
 * Server-authoritative remaining seconds calculation.
 * Prevents timer manipulation from browser refresh or client clock tampering.
 */
export function computeRemainingSeconds(
  startedAtIso: string,
  durationSeconds: number,
  nowMs: number = Date.now()
): number {
  const startedMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedMs)) return 0;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  return Math.max(0, durationSeconds - elapsedSeconds);
}

/**
 * Computes countdown breakdown (days, hours, minutes, seconds) relative to server time.
 */
export function computeCountdownParts(
  targetIso: string,
  nowMs: number = Date.now()
): { days: number; hours: number; minutes: number; seconds: number; isExpired: boolean } {
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(targetMs) || targetMs <= nowMs) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }
  const totalSeconds = Math.floor((targetMs - nowMs) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, isExpired: false };
}

/**
 * Evaluates raw answers separately from configurable UTBK score scaling.
 * Does NOT fabricate official LTMPT/SNPMB IRT curves; uses transparent configurable community formula.
 */
export function calculateTryoutScore(
  items: AnswerEvaluationInput[],
  formula: ScoringFormulaConfig = { baseScore: 300, maxScore: 1000, wrongPenalty: 0 }
): ScoreResult {
  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;

  const subtestBuckets: Record<string, { correct: number; wrong: number; blank: number; total: number }> = {};

  for (const item of items) {
    if (!subtestBuckets[item.subtest]) {
      subtestBuckets[item.subtest] = { correct: 0, wrong: 0, blank: 0, total: 0 };
    }
    const bucket = subtestBuckets[item.subtest];
    bucket.total += 1;

    const sel = [...item.selected].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
    const cor = [...item.correct].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();

    if (sel.length === 0) {
      blankCount += 1;
      bucket.blank += 1;
    } else if (sel.length === cor.length && sel.every((v, idx) => v === cor[idx])) {
      correctCount += 1;
      bucket.correct += 1;
    } else {
      wrongCount += 1;
      bucket.wrong += 1;
    }
  }

  const totalQuestions = items.length;
  const scoreRange = Math.max(0, formula.maxScore - formula.baseScore);

  const computeScaled = (c: number, w: number, total: number): number => {
    if (total <= 0) return formula.baseScore;
    const rawNet = Math.max(0, c - w * formula.wrongPenalty);
    const ratio = Math.min(1, rawNet / total);
    return Math.round(formula.baseScore + ratio * scoreRange);
  };

  const subtestScores: ScoreResult['subtestScores'] = {};
  for (const [subtest, b] of Object.entries(subtestBuckets)) {
    subtestScores[subtest] = {
      ...b,
      score: computeScaled(b.correct, b.wrong, b.total),
    };
  }

  return {
    correctCount,
    wrongCount,
    blankCount,
    totalQuestions,
    utbkScore: computeScaled(correctCount, wrongCount, totalQuestions),
    subtestScores,
  };
}

/**
 * Ranks leaderboard entries for a single package regardless of mode (Simulation vs Staged).
 * Keeps best score per user; tie-breaks by fastest active_duration_seconds.
 */
export function rankLeaderboardEntries(entries: LeaderboardRawEntry[]): LeaderboardRankedEntry[] {
  const bestByUser = new Map<number, LeaderboardRawEntry>();

  for (const entry of entries) {
    const existing = bestByUser.get(entry.userId);
    if (!existing) {
      bestByUser.set(entry.userId, entry);
      continue;
    }
    if (
      entry.utbkScore > existing.utbkScore ||
      (entry.utbkScore === existing.utbkScore && entry.activeDurationSeconds < existing.activeDurationSeconds)
    ) {
      bestByUser.set(entry.userId, entry);
    }
  }

  const sorted = Array.from(bestByUser.values()).sort((a, b) => {
    if (b.utbkScore !== a.utbkScore) return b.utbkScore - a.utbkScore;
    if (a.activeDurationSeconds !== b.activeDurationSeconds) {
      return a.activeDurationSeconds - b.activeDurationSeconds;
    }
    return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
  });

  return sorted.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Updates personal mastery when answering or toggling ragu.
 * CRITICAL RULE: Answering correctly NEVER removes an active ragu flag!
 * Only explicit user confirmation ("Saya Sudah Paham") clears isRaguActive.
 */
export function applyAnswerToMastery(
  prev: MasteryState,
  opts: { isCorrect?: boolean; markRagu?: boolean }
): MasteryState {
  const next: MasteryState = { ...prev };
  if (opts.isCorrect === true) {
    next.correctCount += 1;
  } else if (opts.isCorrect === false) {
    next.wrongCount += 1;
  }

  if (opts.markRagu === true) {
    if (!next.isRaguActive) {
      next.raguCount += 1;
    }
    next.isRaguActive = true;
    next.wasEverRagu = true;
    next.status = 'ragu';
  } else if (opts.markRagu === false && !next.isRaguActive && next.status !== 'understood') {
    next.status = 'learned';
  }

  return next;
}

/**
 * Clears active ragu ONLY when user explicitly confirms "Saya Sudah Paham".
 * Preserves wasEverRagu and raguCount history forever.
 */
export function confirmUnderstoodMastery(
  prev: MasteryState,
  confirmedAtIso: string = new Date().toISOString()
): MasteryState {
  return {
    ...prev,
    isRaguActive: false,
    wasEverRagu: prev.wasEverRagu || prev.raguCount > 0 || prev.isRaguActive,
    status: 'understood',
    understoodAt: confirmedAtIso,
  };
}

/**
 * Validates JSON question import payloads (manual JSON or AI-extracted JSON).
 */
export function validateQuestionImportPayload(
  payload: unknown,
  existingQuestionTexts: Set<string> = new Set()
): QuestionImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedQuestions: QuestionImportValidationResult['normalizedQuestions'] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload harus berupa objek JSON yang valid.'], warnings, normalizedQuestions };
  }

  const obj = payload as Record<string, unknown>;
  const defaultSubject = typeof obj.subject === 'string' && obj.subject.trim() ? obj.subject.trim() : 'Penalaran Umum';
  const rawList = Array.isArray(obj.questions) ? obj.questions : Array.isArray(payload) ? payload : null;

  if (!rawList || rawList.length === 0) {
    return {
      valid: false,
      errors: ['Array "questions" wajib ada dan minimal berisi 1 soal.'],
      warnings,
      normalizedQuestions,
    };
  }

  const seenInBatch = new Set<string>();

  rawList.forEach((raw, idx) => {
    const q = (raw || {}) as QuestionImportItem;
    const itemWarnings: string[] = [];
    const label = `Soal #${idx + 1}`;

    const questionText = typeof q.question === 'string' ? q.question.trim() : '';
    if (!questionText) {
      errors.push(`${label}: teks pertanyaan kosong.`);
    }

    const normalizedKey = normalizeQuestionHash(questionText);
    if (normalizedKey && (existingQuestionTexts.has(normalizedKey) || seenInBatch.has(normalizedKey))) {
      itemWarnings.push('Terindikasi duplikat dengan soal yang sudah ada.');
    }
    if (normalizedKey) seenInBatch.add(normalizedKey);

    const options = Array.isArray(q.options)
      ? q.options
          .map((o, optIdx) => ({
            key: typeof o?.key === 'string' && o.key.trim() ? o.key.trim().toUpperCase() : String.fromCharCode(65 + optIdx),
            content: typeof o?.content === 'string' ? o.content.trim() : '',
          }))
          .filter((o) => o.content.length > 0)
      : [];

    if (options.length < 2) {
      errors.push(`${label}: minimal harus memiliki 2 pilihan jawaban.`);
    }

    const correctAnswer = Array.isArray(q.correct_answer)
      ? q.correct_answer.map((a) => String(a).trim().toUpperCase()).filter(Boolean)
      : [];

    if (correctAnswer.length === 0) {
      itemWarnings.push('Kunci jawaban belum tersedia — perlu verifikasi manual Admin.');
    } else {
      const optionKeys = new Set(options.map((o) => o.key));
      const missingKeys = correctAnswer.filter((k) => !optionKeys.has(k));
      if (missingKeys.length > 0) {
        errors.push(`${label}: kunci jawaban (${missingKeys.join(', ')}) tidak cocok dengan pilihan yang tersedia.`);
      }
    }

    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    if (!explanation) {
      itemWarnings.push('Pembahasan belum tersedia — disarankan dilengkapi.');
    }

    const dollarCount = (questionText.match(/\$/g) || []).length + (explanation.match(/\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
      itemWarnings.push('Delimitasi LaTeX ($) tidak seimbang, periksa penulisan rumus.');
    }

    if (q.needs_manual_review) {
      itemWarnings.push(q.review_note || 'Ditandai AI untuk pemeriksaan manual Admin.');
    }

    const difficultyRaw = typeof q.difficulty === 'string' ? q.difficulty.toLowerCase() : 'medium';
    const difficulty =
      difficultyRaw === 'easy' || difficultyRaw === 'hard' || difficultyRaw === 'medium'
        ? difficultyRaw
        : 'medium';

    const questionType =
      q.type === 'multiple_choice' || correctAnswer.length > 1 ? 'multiple_choice' : 'single_choice';

    if (itemWarnings.length > 0) {
      warnings.push(`${label}: ${itemWarnings.join(' ')}`);
    }

    normalizedQuestions.push({
      externalCode: typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `Q-${Date.now()}-${idx + 1}`,
      subtest: typeof q.subtest === 'string' && q.subtest.trim() ? q.subtest.trim() : defaultSubject,
      topic: typeof q.topic === 'string' && q.topic.trim() ? q.topic.trim() : 'Umum',
      subtopic: typeof q.subtopic === 'string' ? q.subtopic.trim() : '',
      difficulty,
      questionType,
      questionText,
      imageUrl: typeof q.image_url === 'string' && q.image_url.trim() ? q.image_url.trim() : null,
      options,
      correctAnswer,
      explanation,
      solution: typeof q.solution === 'string' ? q.solution.trim() : '',
      needsReview: itemWarnings.length > 0 || Boolean(q.needs_manual_review),
      warnings: itemWarnings,
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedQuestions,
  };
}

/**
 * Clamps normalized [ymin, xmin, ymax, xmax] (0..1000) and expands by generous safety padding
 * so graph axes, labels, vertex letters, and visual boundaries are never clipped.
 */
export function normalizeCropBoxWithPadding(
  bbox: [number, number, number, number],
  padding: number = 28
): [number, number, number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  const rawY1 = Number(bbox[0]) || 0;
  const rawX1 = Number(bbox[1]) || 0;
  const rawY2 = Number(bbox[2]) || 0;
  const rawX2 = Number(bbox[3]) || 0;

  let ymin = Math.min(rawY1, rawY2);
  let ymax = Math.max(rawY1, rawY2);
  let xmin = Math.min(rawX1, rawX2);
  let xmax = Math.max(rawX1, rawX2);

  if (ymax - ymin < 20) ymax = Math.min(1000, ymin + 120);
  if (xmax - xmin < 20) xmax = Math.min(1000, xmin + 120);

  const pad = Math.max(0, padding);
  ymin = clamp(ymin - pad);
  xmin = clamp(xmin - pad);
  ymax = clamp(ymax + pad);
  xmax = clamp(xmax + pad);

  if (ymax <= ymin) ymax = Math.min(1000, ymin + 40);
  if (xmax <= xmin) xmax = Math.min(1000, xmin + 40);

  return [ymin, xmin, ymax, xmax];
}

/**
 * Computes Intersection-over-Union of two [ymin, xmin, ymax, xmax] bounding boxes.
 */
export function bboxIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const interY1 = Math.max(a[0], b[0]);
  const interX1 = Math.max(a[1], b[1]);
  const interY2 = Math.min(a[2], b[2]);
  const interX2 = Math.min(a[3], b[3]);
  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - interArea;
  return union > 0 ? interArea / union : 0;
}

/**
 * Normalizes and deduplicates multi-image assets per question while preserving explicit display order.
 */
export function deduplicateAndOrderDraftAssets(assets: QuestionAsset[]): QuestionAsset[] {
  const seenUrls = new Set<string>();
  const sorted = [...assets].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  const result: QuestionAsset[] = [];
  for (const asset of sorted) {
    const cleanUrl = (asset.asset_url || '').trim();
    if (!cleanUrl || seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);
    result.push({
      ...asset,
      asset_url: cleanUrl,
      display_order: result.length,
    });
  }
  return result;
}

/**
 * Returns warning strings for draft questions flagged as having visual content yet missing extracted images.
 */
export function findVisualMissingWarnings(items: PdfImportDraftItem[]): string[] {
  const warnings: string[] = [];
  items.forEach((item, idx) => {
    const hasAsset = (item.assets && item.assets.length > 0) || Boolean(item.image_url);
    if (item.has_visual && !hasAsset) {
      warnings.push(
        `Soal No. ${item.question_number || idx + 1} (${item.external_code}) ditandai memuat gambar/diagram namun belum memiliki aset gambar.`
      );
    }
  });
  return warnings;
}

/**
 * Filters Dashboard Tryout Carousel cards according to active status and user package access.
 */
export function filterCarouselCardsForPackages(
  cards: TryoutCarouselCard[],
  packages: TryoutPackage[],
  isAdmin: boolean = false
): TryoutCarouselCard[] {
  const accessiblePackageIds = new Set(
    packages.filter((p) => isAdmin || p.is_published !== false).map((p) => p.id)
  );
  return cards
    .filter((card) => {
      if (card.is_active === false) return false;
      if (card.package_id != null && !accessiblePackageIds.has(card.package_id)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from LLM text output.
 */
export function stripMarkdownCodeFences(raw: string): string {
  let text = String(raw || '').trim();
  const fencedMatch = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fencedMatch && fencedMatch[1]) {
    text = fencedMatch[1].trim();
  } else {
    text = text.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return text;
}

/**
 * Extracts the outermost JSON object or array from text that may contain prose or prefixes.
 */
export function extractJsonSubstring(raw: string): string {
  const cleaned = stripMarkdownCodeFences(raw);
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return cleaned;

  const startIdx =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  const openChar = cleaned[startIdx];
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastBalancedEnd = -1;

  for (let i = startIdx; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        lastBalancedEnd = i;
        break;
      }
    }
  }

  if (lastBalancedEnd !== -1) {
    return cleaned.slice(startIdx, lastBalancedEnd + 1);
  }
  return cleaned.slice(startIdx);
}

/**
 * Repairs common LLM JSON issues: trailing commas, raw newlines inside strings, and truncated closing delimiters.
 */
export function repairTruncatedOrMalformedJson(raw: string): string {
  let text = extractJsonSubstring(raw);
  if (!text) return text;

  // Escape unescaped literal control newlines/tabs inside quoted strings
  let normalized = '';
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        normalized += ch;
        escaped = false;
      } else if (ch === '\\') {
        normalized += ch;
        escaped = true;
      } else if (ch === '"') {
        normalized += ch;
        inString = false;
      } else if (ch === '\n') {
        normalized += '\\n';
      } else if (ch === '\r') {
        normalized += '\\r';
      } else if (ch === '\t') {
        normalized += '\\t';
      } else {
        normalized += ch;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      normalized += ch;
    } else if (ch === '{') {
      stack.push('}');
      normalized += ch;
    } else if (ch === '[') {
      stack.push(']');
      normalized += ch;
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
      normalized += ch;
    } else {
      normalized += ch;
    }
  }

  if (inString) {
    if (escaped) normalized += '\\';
    normalized += '"';
  }

  // Strip dangling trailing colon/comma property fragments when truncated mid-object
  normalized = normalized.replace(/,\s*"[^"]*"\s*:\s*$/g, '').replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/g, '');

  while (stack.length > 0) {
    normalized += stack.pop();
  }

  // Clean trailing commas again after closing brackets
  normalized = normalized.replace(/,\s*([}\]])/g, '$1');
  return normalized;
}

/**
 * Parses AI JSON safely using strict parse first, then fence/prose extraction + structural repair.
 */
export function parseAndRepairAiJson<T>(raw: string): { ok: true; data: T; repaired: boolean } | { ok: false; error: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Respons AI kosong dan tidak berisi JSON.' };
  }

  try {
    return { ok: true, data: JSON.parse(trimmed) as T, repaired: false };
  } catch {
    // try fence + substring extraction
  }

  const extracted = extractJsonSubstring(trimmed);
  try {
    return { ok: true, data: JSON.parse(extracted) as T, repaired: extracted !== trimmed };
  } catch {
    // try structural repair
  }

  const repaired = repairTruncatedOrMalformedJson(trimmed);
  try {
    return { ok: true, data: JSON.parse(repaired) as T, repaired: true };
  } catch (err) {
    return {
      ok: false,
      error: `Output AI bukan JSON valid bahkan setelah perbaikan otomatis: ${
        err instanceof Error ? err.message : 'SyntaxError'
      }`,
    };
  }
}

/**
 * Classifies whether an AI provider failure should trigger fallback to backup provider.
 * NEVER triggers on invalid PDF, bad user input, or schema validation errors.
 */
export function isRetryableProviderError(statusCode?: number, message: string = ''): boolean {
  const lower = message.toLowerCase();
  if (
    lower.includes('invalid pdf') ||
    lower.includes('validation') ||
    lower.includes('minimal harus') ||
    lower.includes('tidak boleh kosong') ||
    lower.includes('tidak ditemukan file')
  ) {
    return false;
  }
  if (typeof statusCode === 'number') {
    if (statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
      return true;
    }
    if (statusCode >= 400 && statusCode < 500) {
      return false;
    }
  }
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('429') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable')
  );
}

export const REVIEW_CHECKLIST_ITEMS: Array<{ key: keyof AuditChecklistState; label: string; requiredForApproval?: boolean }> = [
  { key: 'clear_wording', label: 'Teks soal jelas & mudah dipahami', requiredForApproval: true },
  { key: 'valid_subtest', label: 'Subtes sudah sesuai', requiredForApproval: true },
  { key: 'valid_topic_subtopic', label: 'Materi / submateri sesuai', requiredForApproval: true },
  { key: 'complete_options', label: 'Pilihan jawaban lengkap (A–E / sesuai tipe)', requiredForApproval: true },
  { key: 'valid_answer_key', label: 'Kunci jawaban tersedia & terverifikasi', requiredForApproval: true },
  { key: 'valid_explanation', label: 'Pembahasan lengkap & akurat', requiredForApproval: true },
  { key: 'clear_image_crop', label: 'Gambar terbaca jelas & crop presisi (jika ada visual)' },
  { key: 'no_duplicate', label: 'Tidak terdeteksi duplikasi soal', requiredForApproval: true },
  { key: 'valid_latex', label: 'Rumus LaTeX / tabel ter-render sempurna' },
  { key: 'accurate_difficulty', label: 'Tingkat kesulitan akurat' },
  { key: 'ready_for_students', label: 'Layak tampil ke siswa (Latsol / Try Out)', requiredForApproval: true },
];

export function canApproveChecklist(checklist: AuditChecklistState | undefined): {
  ok: boolean;
  missingLabels: string[];
} {
  const c = checklist || {};
  const missingLabels = REVIEW_CHECKLIST_ITEMS.filter((item) => item.requiredForApproval && !c[item.key]).map(
    (item) => item.label
  );
  return { ok: missingLabels.length === 0, missingLabels };
}

export function detectMajorQuestionChange(
  before: {
    question_text?: string;
    options?: Array<{ key: string; content: string }>;
    correct_answer?: string[];
    image_url?: string | null;
    subtest?: string;
  },
  after: {
    question_text?: string;
    options?: Array<{ key: string; content: string }>;
    correct_answer?: string[];
    image_url?: string | null;
    subtest?: string;
  }
): boolean {
  if ((before.question_text || '').trim() !== (after.question_text || '').trim()) return true;
  if ((before.image_url || '') !== (after.image_url || '')) return true;
  if ((before.subtest || '') !== (after.subtest || '')) return true;
  if (JSON.stringify(before.options || []) !== JSON.stringify(after.options || [])) return true;
  const bKey = [...(before.correct_answer || [])].sort().join(',');
  const aKey = [...(after.correct_answer || [])].sort().join(',');
  return bKey !== aKey;
}

export function formatDurationMinutes(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours === 0) return `${mins} mnt`;
  if (mins === 0) return `${hours} jam`;
  return `${hours} jam ${mins} mnt`;
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function getMondayOfWeekYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDaysYmd(ymd, diffToMonday);
}

/**
 * Aggregates user study logs cleanly by daily (last 14 days), weekly (last 8 weeks), or monthly (last 6 months),
 * plus current vs previous period comparison metrics.
 */
export function aggregateStudyTimeLogs(
  logs: StudyTimeLog[],
  view: 'daily' | 'weekly' | 'monthly',
  referenceDateYmd: string = new Date().toISOString().slice(0, 10)
): StudyTimeSummary {
  const totalAllTimeMinutes = logs.reduce((sum, l) => sum + Math.max(0, Number(l.duration_minutes || 0)), 0);
  const buckets: StudyTimePeriodBucket[] = [];

  if (view === 'daily') {
    for (let i = 13; i >= 0; i -= 1) {
      const ymd = addDaysYmd(referenceDateYmd, -i);
      const dayLogs = logs.filter((l) => l.study_date === ymd);
      const totalMinutes = dayLogs.reduce((s, l) => s + Math.max(0, Number(l.duration_minutes || 0)), 0);
      const [, mm, dd] = ymd.split('-');
      buckets.push({
        key: ymd,
        label: `${dd}/${mm}`,
        totalMinutes,
        sessionCount: dayLogs.length,
      });
    }
    const currentWeekStart = getMondayOfWeekYmd(referenceDateYmd);
    const prevWeekStart = addDaysYmd(currentWeekStart, -7);
    const currentPeriodMinutes = logs
      .filter((l) => l.study_date >= currentWeekStart && l.study_date <= referenceDateYmd)
      .reduce((s, l) => s + Number(l.duration_minutes || 0), 0);
    const previousPeriodMinutes = logs
      .filter((l) => l.study_date >= prevWeekStart && l.study_date < currentWeekStart)
      .reduce((s, l) => s + Number(l.duration_minutes || 0), 0);
    const deltaMinutes = currentPeriodMinutes - previousPeriodMinutes;
    const deltaPercent =
      previousPeriodMinutes > 0 ? Math.round((deltaMinutes / previousPeriodMinutes) * 100) : currentPeriodMinutes > 0 ? 100 : null;
    return {
      view,
      buckets,
      totalAllTimeMinutes,
      currentPeriodMinutes,
      previousPeriodMinutes,
      deltaMinutes,
      deltaPercent,
    };
  }

  if (view === 'weekly') {
    const thisMonday = getMondayOfWeekYmd(referenceDateYmd);
    for (let w = 7; w >= 0; w -= 1) {
      const startYmd = addDaysYmd(thisMonday, -w * 7);
      const endYmd = addDaysYmd(startYmd, 6);
      const weekLogs = logs.filter((l) => l.study_date >= startYmd && l.study_date <= endYmd);
      const totalMinutes = weekLogs.reduce((s, l) => s + Number(l.duration_minutes || 0), 0);
      const [, mm, dd] = startYmd.split('-');
      buckets.push({
        key: startYmd,
        label: `M-${dd}/${mm}`,
        totalMinutes,
        sessionCount: weekLogs.length,
      });
    }
    const currentPeriodMinutes = buckets[buckets.length - 1]?.totalMinutes || 0;
    const previousPeriodMinutes = buckets[buckets.length - 2]?.totalMinutes || 0;
    const deltaMinutes = currentPeriodMinutes - previousPeriodMinutes;
    const deltaPercent =
      previousPeriodMinutes > 0 ? Math.round((deltaMinutes / previousPeriodMinutes) * 100) : currentPeriodMinutes > 0 ? 100 : null;
    return {
      view,
      buckets,
      totalAllTimeMinutes,
      currentPeriodMinutes,
      previousPeriodMinutes,
      deltaMinutes,
      deltaPercent,
    };
  }

  // monthly (last 6 months)
  const [refY, refM] = referenceDateYmd.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const dt = new Date(Date.UTC(refY, (refM || 1) - 1 - offset, 1));
    const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    const mLogs = logs.filter((l) => l.study_date.startsWith(ym));
    const totalMinutes = mLogs.reduce((s, l) => s + Number(l.duration_minutes || 0), 0);
    buckets.push({
      key: ym,
      label: `${monthNames[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(-2)}`,
      totalMinutes,
      sessionCount: mLogs.length,
    });
  }
  const currentPeriodMinutes = buckets[buckets.length - 1]?.totalMinutes || 0;
  const previousPeriodMinutes = buckets[buckets.length - 2]?.totalMinutes || 0;
  const deltaMinutes = currentPeriodMinutes - previousPeriodMinutes;
  const deltaPercent =
    previousPeriodMinutes > 0 ? Math.round((deltaMinutes / previousPeriodMinutes) * 100) : currentPeriodMinutes > 0 ? 100 : null;
  return {
    view,
    buckets,
    totalAllTimeMinutes,
    currentPeriodMinutes,
    previousPeriodMinutes,
    deltaMinutes,
    deltaPercent,
  };
}

/**
 * Enforces user privacy flags cleanly so hidden sections never leak to public profile responses.
 */
export function buildPublicProfilePayload(input: {
  user: { id: number; username: string; avatar_url: string; joined_at: string; target_score: number };
  privacy: UserPrivacySettings;
  tryoutStats: PublicProfileResponse['tryoutStats'];
  studyTimeStats: PublicProfileResponse['studyTimeStats'];
  subtestMastery: PublicProfileResponse['subtestMastery'];
}): PublicProfileResponse {
  const { user, privacy } = input;
  if (!privacy.profile_visible) {
    return {
      profileVisible: false,
      user: {
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
      },
      privacy,
      targetScore: null,
      tryoutStats: null,
      studyTimeStats: null,
      subtestMastery: null,
    };
  }

  return {
    profileVisible: true,
    user: {
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      joined_at: user.joined_at,
    },
    privacy,
    targetScore: privacy.show_target_score ? user.target_score : null,
    tryoutStats: privacy.show_tryout_stats ? input.tryoutStats : null,
    studyTimeStats: privacy.show_study_time ? input.studyTimeStats : null,
    subtestMastery: privacy.show_subtest_mastery ? input.subtestMastery : null,
  };
}

/**
 * Verifies postMessage origins strictly against current window origin or trusted callback origins.
 */
export function isTrustedPostMessageOrigin(
  eventOrigin: string,
  windowOrigin: string,
  trustedCallbacks: string[] = []
): boolean {
  const normEvent = normalizeOriginUrl(eventOrigin);
  if (!normEvent) return false;
  const normWindow = normalizeOriginUrl(windowOrigin);
  if (normWindow && normEvent === normWindow) return true;
  if (normWindow && normWindow.includes('://ais-dev-') && normEvent === normWindow.replace('://ais-dev-', '://ais-pre-')) {
    return true;
  }
  if (normWindow && normWindow.includes('://ais-pre-') && normEvent === normWindow.replace('://ais-pre-', '://ais-dev-')) {
    return true;
  }
  for (const cb of trustedCallbacks) {
    const normCb = normalizeOriginUrl(cb);
    if (normCb && normCb === normEvent) return true;
  }
  return false;
}


