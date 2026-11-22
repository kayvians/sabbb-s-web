import { Router } from 'express';
import { buildQuestionSnapshot, db, getQuestionAssetsMap } from '../db';
import { AuthenticatedRequest, requireAuth, rateLimit } from '../auth';
import {
  aggregateStudyTimeLogs,
  applyAnswerToMastery,
  buildDrillingCatalogTree,
  buildPublicProfilePayload,
  calculateTryoutScore,
  computeRemainingSeconds,
  confirmUnderstoodMastery,
  rankLeaderboardEntries,
  type MasteryState,
  type ScoringFormulaConfig,
} from '../../src/lib/utbkLogic';
import type { StudyTimeLog, UserPrivacySettings } from '../../src/types';

export const learningRouter = Router();

function getScoringConfig(): ScoringFormulaConfig {
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'scoring_config'").get() as { value_json: string } | undefined;
  if (!row) return { baseScore: 300, maxScore: 1000, wrongPenalty: 0 };
  try {
    const parsed = JSON.parse(row.value_json);
    return {
      baseScore: Number(parsed.baseScore ?? 300),
      maxScore: Number(parsed.maxScore ?? 1000),
      wrongPenalty: Number(parsed.wrongPenalty ?? 0),
    };
  } catch {
    return { baseScore: 300, maxScore: 1000, wrongPenalty: 0 };
  }
}

function getMasteryRow(userId: number, questionId: number, sourceType: 'drill' | 'tryout' = 'drill'): MasteryState {
  const row = db
    .prepare(
      'SELECT is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, understood_at FROM user_question_mastery WHERE user_id = ? AND source_type = ? AND question_id = ?'
    )
    .get(userId, sourceType, questionId) as
    | {
        is_ragu_active: number;
        was_ever_ragu: number;
        ragu_count: number;
        correct_count: number;
        wrong_count: number;
        status: 'ragu' | 'learned' | 'understood';
        understood_at: string | null;
      }
    | undefined;
  if (!row) {
    return {
      isRaguActive: false,
      wasEverRagu: false,
      raguCount: 0,
      correctCount: 0,
      wrongCount: 0,
      status: 'learned',
      understoodAt: null,
    };
  }
  return {
    isRaguActive: Boolean(row.is_ragu_active),
    wasEverRagu: Boolean(row.was_ever_ragu),
    raguCount: row.ragu_count,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    status: row.status,
    understoodAt: row.understood_at,
  };
}

function saveMasteryRow(
  userId: number,
  questionId: number,
  state: MasteryState,
  source: string,
  actionLabel: string,
  sourceType: 'drill' | 'tryout' = 'drill'
): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_question_mastery (user_id, source_type, question_id, is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, last_studied_at, understood_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source_type, question_id) DO UPDATE SET
       is_ragu_active = excluded.is_ragu_active,
       was_ever_ragu = excluded.was_ever_ragu,
       ragu_count = excluded.ragu_count,
       correct_count = excluded.correct_count,
       wrong_count = excluded.wrong_count,
       status = excluded.status,
       last_studied_at = excluded.last_studied_at,
       understood_at = excluded.understood_at`
  ).run(
    userId,
    sourceType,
    questionId,
    state.isRaguActive ? 1 : 0,
    state.wasEverRagu ? 1 : 0,
    state.raguCount,
    state.correctCount,
    state.wrongCount,
    state.status,
    nowIso,
    state.understoodAt
  );

  db.prepare(
    'INSERT INTO user_question_history (user_id, source_type, question_id, action, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, sourceType, questionId, actionLabel, source, nowIso);
}

// ==========================================
// DASHBOARD & PROFILE DATA
// ==========================================
learningRouter.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;

  const tryoutHistory = db
    .prepare(
      `SELECT ts.id, ts.package_id, tp.title as package_title, ts.mode, ts.utbk_score, ts.raw_correct, ts.raw_wrong, ts.raw_blank, ts.active_duration_seconds, ts.subtest_scores_json, ts.completed_at
       FROM tryout_sessions ts
       JOIN tryout_packages tp ON tp.id = ts.package_id
       WHERE ts.user_id = ? AND ts.status = 'completed'
       ORDER BY ts.completed_at ASC`
    )
    .all(uid) as Array<{
    id: number;
    package_id: number;
    package_title: string;
    mode: string;
    utbk_score: number;
    raw_correct: number;
    raw_wrong: number;
    raw_blank: number;
    active_duration_seconds: number;
    subtest_scores_json: string;
    completed_at: string;
  }>;

  const drillStats = db
    .prepare(
      `SELECT COUNT(*) as total_answered,
              SUM(CASE WHEN da.is_correct = 1 THEN 1 ELSE 0 END) as total_correct
       FROM drill_answers da
       JOIN drill_sessions ds ON ds.id = da.session_id
       WHERE ds.user_id = ?`
    )
    .get(uid) as { total_answered: number; total_correct: number | null };

  const activeRaguCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM user_question_mastery WHERE user_id = ? AND is_ragu_active = 1')
      .get(uid) as { c: number }
  ).c;

  const understoodCount = (
    db
      .prepare("SELECT COUNT(*) as c FROM user_question_mastery WHERE user_id = ? AND status = 'understood'")
      .get(uid) as { c: number }
  ).c;

  const studyTargets = db
    .prepare('SELECT id, user_id, topic, subtest, status, updated_at FROM study_targets WHERE user_id = ? ORDER BY updated_at DESC')
    .all(uid);

  // Subtest learning progress indicator from tryout + drill + mastery
  const drillBySubtest = db
    .prepare(
      `SELECT q.subtest,
              COUNT(*) as total,
              SUM(CASE WHEN da.is_correct = 1 THEN 1 ELSE 0 END) as correct
       FROM drill_answers da
       JOIN drill_sessions ds ON ds.id = da.session_id
       JOIN questions q ON q.id = da.question_id
       WHERE ds.user_id = ?
       GROUP BY q.subtest`
    )
    .all(uid) as Array<{ subtest: string; total: number; correct: number }>;

  const tryoutBySubtest: Record<string, { sumRatio: number; count: number }> = {};
  for (const row of tryoutHistory) {
    try {
      const parsed = JSON.parse(row.subtest_scores_json || '{}') as Record<
        string,
        { correct: number; total: number }
      >;
      for (const [st, info] of Object.entries(parsed)) {
        if (!tryoutBySubtest[st]) tryoutBySubtest[st] = { sumRatio: 0, count: 0 };
        if (info.total > 0) {
          tryoutBySubtest[st].sumRatio += info.correct / info.total;
          tryoutBySubtest[st].count += 1;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const allSubtests = [
    'Penalaran Umum',
    'Penalaran Kuantitatif',
    'PBM',
    'PPU',
    'LBE',
    'Literasi Bahasa Inggris',
    'PM',
  ];

  const subtestMastery = allSubtests.map((subtest) => {
    const d = drillBySubtest.find((x) => x.subtest === subtest);
    const t = tryoutBySubtest[subtest];
    let pct: number | null = null;
    if (d && t && t.count > 0) {
      pct = Math.round(((d.correct / d.total + t.sumRatio / t.count) / 2) * 100);
    } else if (d && d.total > 0) {
      pct = Math.round((d.correct / d.total) * 100);
    } else if (t && t.count > 0) {
      pct = Math.round((t.sumRatio / t.count) * 100);
    }
    return { subtest, percentage: pct };
  });

  const masteryRecords = db
    .prepare(
      `SELECT m.question_id, m.source_type,
              COALESCE(q.external_code, tq.external_code, 'Q') as external_code,
              COALESCE(q.subtest, tq.subtest, 'Umum') as subtest,
              COALESCE(q.topic, tq.topic, 'Umum') as topic,
              COALESCE(q.question_text, tq.question_text, '') as question_text,
              m.is_ragu_active, m.was_ever_ragu, m.ragu_count, m.correct_count, m.wrong_count,
              m.status, m.last_studied_at, m.understood_at
       FROM user_question_mastery m
       LEFT JOIN questions q ON m.source_type = 'drill' AND q.id = m.question_id
       LEFT JOIN tryout_questions tq ON m.source_type = 'tryout' AND tq.id = m.question_id
       WHERE m.user_id = ? AND (q.id IS NOT NULL OR tq.id IS NOT NULL)
       ORDER BY m.is_ragu_active DESC, m.last_studied_at DESC`
    )
    .all(uid) as Array<Record<string, unknown>>;

  const dwuSchedules = db
    .prepare('SELECT id, subtest_label, scheduled_date, topic, notes FROM dwu_schedules ORDER BY scheduled_date ASC')
    .all();

  const lastActivity = db
    .prepare('SELECT action, details, created_at FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(uid) as { action: string; details: string; created_at: string } | undefined;

  res.json({
    tryoutHistory: tryoutHistory.map((h) => ({
      ...h,
      subtest_scores: JSON.parse(h.subtest_scores_json || '{}'),
    })),
    stats: {
      completedTryouts: tryoutHistory.length,
      drilledQuestions: drillStats.total_answered || 0,
      drilledCorrect: drillStats.total_correct || 0,
      activeRaguCount,
      understoodCount,
      lastActivity: lastActivity || null,
    },
    studyTargets,
    subtestMastery,
    masteryRecords: masteryRecords.map((r) => ({
      ...r,
      is_ragu_active: Boolean(r.is_ragu_active),
      was_ever_ragu: Boolean(r.was_ever_ragu),
    })),
    dwuSchedules,
  });
});

learningRouter.put('/profile/target-score', requireAuth, (req: AuthenticatedRequest, res) => {
  const score = Number(req.body?.target_score);
  if (!Number.isInteger(score) || score < 200 || score > 1000) {
    res.status(400).json({ error: 'Target skor harus berupa angka bulat antara 200 dan 1000.' });
    return;
  }
  db.prepare('UPDATE users SET target_score = ?, last_active_at = ? WHERE id = ?').run(
    score,
    new Date().toISOString(),
    req.user!.id
  );
  res.json({ target_score: score });
});

learningRouter.post('/profile/study-targets', requireAuth, (req: AuthenticatedRequest, res) => {
  const topic = String(req.body?.topic || '').trim();
  const subtest = String(req.body?.subtest || 'Umum').trim();
  if (!topic) {
    res.status(400).json({ error: 'Nama materi wajib diisi.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO study_targets (user_id, topic, subtest, status, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user!.id, topic, subtest, 'not_started', nowIso);
  res.status(201).json({
    id: info.lastInsertRowid,
    user_id: req.user!.id,
    topic,
    subtest,
    status: 'not_started',
    updated_at: nowIso,
  });
});

learningRouter.patch('/profile/study-targets/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['not_started', 'ongoing', 'done'].includes(status)) {
    res.status(400).json({ error: 'Status materi tidak valid.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const result = db
    .prepare('UPDATE study_targets SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(status, nowIso, id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Target materi tidak ditemukan.' });
    return;
  }
  res.json({ id, status, updated_at: nowIso });
});

learningRouter.delete('/profile/study-targets/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM study_targets WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  res.json({ deleted: true });
});

// Explicit user confirmation "Saya Sudah Paham"
learningRouter.post('/mastery/:questionId/understand', requireAuth, (req: AuthenticatedRequest, res) => {
  const questionId = Number(req.params.questionId);
  const sourceType = req.body?.source_type === 'tryout' ? 'tryout' : 'drill';
  const current = getMasteryRow(req.user!.id, questionId, sourceType);
  const next = confirmUnderstoodMastery(current);
  saveMasteryRow(req.user!.id, questionId, next, 'user_confirmation', 'confirmed_understood', sourceType);
  res.json({ question_id: questionId, source_type: sourceType, mastery: next });
});

// ==========================================
// STUDY TIME / TIME BLOCKING TRACKER
// ==========================================
learningRouter.get('/profile/study-time', requireAuth, (req: AuthenticatedRequest, res) => {
  const viewRaw = String(req.query.view || 'daily');
  const view: 'daily' | 'weekly' | 'monthly' =
    viewRaw === 'weekly' || viewRaw === 'monthly' ? viewRaw : 'daily';

  const logs = db
    .prepare(
      'SELECT id, user_id, study_date, duration_minutes, note, created_at, updated_at FROM study_time_logs WHERE user_id = ? ORDER BY study_date DESC, id DESC'
    )
    .all(req.user!.id) as StudyTimeLog[];

  const summary = aggregateStudyTimeLogs(logs, view);
  res.json({ logs, summary });
});

learningRouter.post('/profile/study-time', requireAuth, (req: AuthenticatedRequest, res) => {
  const studyDate = String(req.body?.study_date || '').trim();
  const durationMinutes = Math.round(Number(req.body?.duration_minutes || 0));
  const note = String(req.body?.note || '').trim().slice(0, 300);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDate)) {
    res.status(400).json({ error: 'Format tanggal belajar harus YYYY-MM-DD.' });
    return;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
    res.status(400).json({ error: 'Durasi belajar harus antara 1 menit hingga 24 jam (1440 menit).' });
    return;
  }

  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO study_time_logs (user_id, study_date, duration_minutes, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.user!.id, studyDate, durationMinutes, note, nowIso, nowIso);

  const created = db.prepare('SELECT * FROM study_time_logs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ log: created });
});

learningRouter.put('/profile/study-time/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const studyDate = String(req.body?.study_date || '').trim();
  const durationMinutes = Math.round(Number(req.body?.duration_minutes || 0));
  const note = String(req.body?.note || '').trim().slice(0, 300);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDate)) {
    res.status(400).json({ error: 'Format tanggal belajar harus YYYY-MM-DD.' });
    return;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
    res.status(400).json({ error: 'Durasi belajar harus antara 1 menit hingga 24 jam (1440 menit).' });
    return;
  }

  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      'UPDATE study_time_logs SET study_date = ?, duration_minutes = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    )
    .run(studyDate, durationMinutes, note, nowIso, id, req.user!.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Catatan waktu belajar tidak ditemukan.' });
    return;
  }
  const updated = db.prepare('SELECT * FROM study_time_logs WHERE id = ?').get(id);
  res.json({ log: updated });
});

learningRouter.delete('/profile/study-time/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM study_time_logs WHERE id = ? AND user_id = ?').run(id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Catatan waktu belajar tidak ditemukan.' });
    return;
  }
  res.json({ deleted: true });
});

// ==========================================
// PRIVACY SETTINGS & PUBLIC PROFILE (READ-ONLY)
// ==========================================
learningRouter.put('/profile/privacy', requireAuth, (req: AuthenticatedRequest, res) => {
  const body = req.body || {};
  const nextPrivacy: UserPrivacySettings = {
    profile_visible: body.profile_visible !== false,
    show_tryout_stats: body.show_tryout_stats !== false,
    show_study_time: Boolean(body.show_study_time),
    show_subtest_mastery: Boolean(body.show_subtest_mastery),
    show_target_score: Boolean(body.show_target_score),
  };

  db.prepare(
    `UPDATE users
     SET profile_visible = ?, show_tryout_stats = ?, show_study_time = ?, show_subtest_mastery = ?, show_target_score = ?, last_active_at = ?
     WHERE id = ?`
  ).run(
    nextPrivacy.profile_visible ? 1 : 0,
    nextPrivacy.show_tryout_stats ? 1 : 0,
    nextPrivacy.show_study_time ? 1 : 0,
    nextPrivacy.show_subtest_mastery ? 1 : 0,
    nextPrivacy.show_target_score ? 1 : 0,
    new Date().toISOString(),
    req.user!.id
  );

  res.json({ privacy: nextPrivacy });
});

learningRouter.get('/users/:id/public-profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'ID pengguna tidak valid.' });
    return;
  }

  const targetRow = db
    .prepare(
      `SELECT id, username, avatar_url, joined_at, target_score,
              profile_visible, show_tryout_stats, show_study_time, show_subtest_mastery, show_target_score
       FROM users WHERE id = ?`
    )
    .get(targetUserId) as
    | {
        id: number;
        username: string;
        avatar_url: string;
        joined_at: string;
        target_score: number;
        profile_visible: number;
        show_tryout_stats: number;
        show_study_time: number;
        show_subtest_mastery: number;
        show_target_score: number;
      }
    | undefined;

  if (!targetRow) {
    res.status(404).json({ error: 'Profil pengguna tidak ditemukan.' });
    return;
  }

  const privacy: UserPrivacySettings = {
    profile_visible: targetRow.profile_visible !== 0,
    show_tryout_stats: targetRow.show_tryout_stats !== 0,
    show_study_time: Boolean(targetRow.show_study_time),
    show_subtest_mastery: Boolean(targetRow.show_subtest_mastery),
    show_target_score: Boolean(targetRow.show_target_score),
  };

  let tryoutStats: {
    completedCount: number;
    bestScore: number | null;
    averageScore: number | null;
    recentScores: Array<{ packageTitle: string; utbkScore: number; completedAt: string }>;
  } | null = null;

  if (privacy.profile_visible && privacy.show_tryout_stats) {
    const completed = db
      .prepare(
        `SELECT ts.utbk_score, ts.completed_at, tp.title as package_title
         FROM tryout_sessions ts
         JOIN tryout_packages tp ON tp.id = ts.package_id
         WHERE ts.user_id = ? AND ts.status = 'completed' AND ts.utbk_score IS NOT NULL
         ORDER BY ts.completed_at DESC`
      )
      .all(targetUserId) as Array<{ utbk_score: number; completed_at: string; package_title: string }>;

    const scores = completed.map((c) => Number(c.utbk_score));
    tryoutStats = {
      completedCount: completed.length,
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      averageScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      recentScores: completed.slice(0, 5).map((c) => ({
        packageTitle: c.package_title,
        utbkScore: Number(c.utbk_score),
        completedAt: c.completed_at,
      })),
    };
  }

  let studyTimeStats: { totalMinutes: number; thisWeekMinutes: number; sessionsCount: number } | null = null;
  if (privacy.profile_visible && privacy.show_study_time) {
    const logs = db
      .prepare('SELECT id, user_id, study_date, duration_minutes, note, created_at, updated_at FROM study_time_logs WHERE user_id = ?')
      .all(targetUserId) as StudyTimeLog[];
    const agg = aggregateStudyTimeLogs(logs, 'daily');
    studyTimeStats = {
      totalMinutes: agg.totalAllTimeMinutes,
      thisWeekMinutes: agg.currentPeriodMinutes,
      sessionsCount: logs.length,
    };
  }

  let subtestMastery: Array<{
    subtest: string;
    total: number;
    understood: number;
    learned: number;
    ragu: number;
    masteryPct: number;
  }> | null = null;
  if (privacy.profile_visible && privacy.show_subtest_mastery) {
    const rows = db
      .prepare(
        `SELECT COALESCE(q.subtest, tq.subtest, 'Umum') as subtest, m.status
         FROM user_question_mastery m
         LEFT JOIN questions q ON m.source_type = 'drill' AND q.id = m.question_id
         LEFT JOIN tryout_questions tq ON m.source_type = 'tryout' AND tq.id = m.question_id
         WHERE m.user_id = ? AND (q.id IS NOT NULL OR tq.id IS NOT NULL)`
      )
      .all(targetUserId) as Array<{ subtest: string; status: string }>;

    const bySub = new Map<string, { total: number; understood: number; learned: number; ragu: number }>();
    for (const r of rows) {
      if (!bySub.has(r.subtest)) bySub.set(r.subtest, { total: 0, understood: 0, learned: 0, ragu: 0 });
      const b = bySub.get(r.subtest)!;
      b.total += 1;
      if (r.status === 'understood') b.understood += 1;
      else if (r.status === 'ragu') b.ragu += 1;
      else b.learned += 1;
    }
    subtestMastery = Array.from(bySub.entries()).map(([subtest, b]) => ({
      subtest,
      ...b,
      masteryPct: b.total > 0 ? Math.round(((b.understood + b.learned * 0.5) / b.total) * 100) : 0,
    }));
  }

  const payload = buildPublicProfilePayload({
    user: {
      id: targetRow.id,
      username: targetRow.username,
      avatar_url: targetRow.avatar_url,
      joined_at: targetRow.joined_at,
      target_score: targetRow.target_score,
    },
    privacy,
    tryoutStats,
    studyTimeStats,
    subtestMastery,
  });

  res.json(payload);
});

// ==========================================
// TRY OUT PACKAGES, SESSIONS & SERVER TIMER
// ==========================================
learningRouter.get('/tryout/packages', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
  const packages = db
    .prepare(
      isAdmin
        ? 'SELECT * FROM tryout_packages ORDER BY id ASC'
        : 'SELECT * FROM tryout_packages WHERE is_published = 1 ORDER BY id ASC'
    )
    .all() as Array<Record<string, unknown>>;

  const enriched = packages.map((pkg) => {
    const subtests = db
      .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
      .all(pkg.id) as Array<Record<string, unknown>>;

    const activeSession = db
      .prepare(
        "SELECT id, package_id, mode, status, current_subtest_index, active_duration_seconds, utbk_score, started_at, completed_at FROM tryout_sessions WHERE user_id = ? AND package_id = ? AND status != 'completed' ORDER BY id DESC LIMIT 1"
      )
      .get(uid, pkg.id);

    const bestRow = db
      .prepare("SELECT MAX(utbk_score) as best FROM tryout_sessions WHERE user_id = ? AND package_id = ? AND status = 'completed'")
      .get(uid, pkg.id) as { best: number | null };

    return {
      ...pkg,
      is_published: Boolean(pkg.is_published),
      subtests: subtests.map((s) => ({
        ...s,
        question_ids: JSON.parse(String(s.question_ids_json || '[]')),
      })),
      user_active_session: activeSession || null,
      user_best_score: bestRow?.best ?? null,
    };
  });

  res.json(enriched);
});

learningRouter.post('/tryout/sessions/start', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const packageId = Number(req.body?.package_id);
  const mode = req.body?.mode === 'staged' ? 'staged' : 'simulation';

  const pkg = db.prepare('SELECT * FROM tryout_packages WHERE id = ?').get(packageId) as Record<string, unknown> | undefined;
  if (!pkg) {
    res.status(404).json({ error: 'Paket Try Out tidak ditemukan.' });
    return;
  }

  // Check if there's an existing unfinished session for this package
  const existing = db
    .prepare("SELECT * FROM tryout_sessions WHERE user_id = ? AND package_id = ? AND status != 'completed' ORDER BY id DESC LIMIT 1")
    .get(uid, packageId) as Record<string, unknown> | undefined;

  if (existing) {
    res.json({ session_id: existing.id, resumed: true });
    return;
  }

  const subtests = db
    .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(packageId) as Array<{ id: number; duration_seconds: number }>;

  if (subtests.length === 0) {
    res.status(400).json({ error: 'Paket Try Out belum memiliki subtest dan soal.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const initialStates: Record<string, { status: string; started_at: string | null; locked_at: string | null }> = {};
  subtests.forEach((s, idx) => {
    initialStates[String(s.id)] = {
      status: idx === 0 ? 'active' : 'pending',
      started_at: idx === 0 ? nowIso : null,
      locked_at: null,
    };
  });

  // Snapshot all tryout_questions for this package so later admin edits never alter active or historical sessions
  const pkgQuestions = db
    .prepare('SELECT * FROM tryout_questions WHERE package_id = ?')
    .all(packageId) as Array<Record<string, unknown>>;
  const pkgAssetsMap = getQuestionAssetsMap(
    'tryout',
    pkgQuestions.map((q) => Number(q.id))
  );
  const questionSnapshots: Record<string, Record<string, unknown>> = {};
  for (const qRow of pkgQuestions) {
    const qid = Number(qRow.id);
    questionSnapshots[String(qid)] = buildQuestionSnapshot('tryout', qRow, pkgAssetsMap.get(qid) || []);
  }

  const info = db
    .prepare(
      `INSERT INTO tryout_sessions (user_id, package_id, mode, status, current_subtest_index, subtest_started_at, subtest_states_json, active_duration_seconds, question_snapshots_json, impact_flag_json, started_at)
       VALUES (?, ?, ?, 'in_progress', 0, ?, ?, 0, ?, '{}', ?)`
    )
    .run(uid, packageId, mode, nowIso, JSON.stringify(initialStates), JSON.stringify(questionSnapshots), nowIso);

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    uid,
    'tryout_started',
    `Memulai ${pkg.title} (${mode === 'simulation' ? 'Mode Simulasi' : 'Mode Bertahap'})`,
    nowIso
  );

  res.status(201).json({ session_id: info.lastInsertRowid, resumed: false });
});

function finalizeTryoutSession(sessionId: number, userId: number): void {
  const session = db.prepare('SELECT * FROM tryout_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) as Record<string, unknown>;
  if (!session || session.status === 'completed') return;

  let snapshots: Record<string, Record<string, unknown>> = {};
  try {
    snapshots = JSON.parse(String(session.question_snapshots_json || '{}'));
  } catch {
    snapshots = {};
  }

  const subtests = db
    .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(session.package_id) as Array<{ id: number; subtest_name: string; question_ids_json: string }>;

  const answers = db
    .prepare('SELECT subtest_id, question_id, selected_json, is_ragu FROM tryout_answers WHERE session_id = ?')
    .all(sessionId) as Array<{ subtest_id: number; question_id: number; selected_json: string; is_ragu: number }>;

  const answerMap = new Map<string, { selected: string[]; isRagu: boolean }>();
  for (const a of answers) {
    answerMap.set(`${a.subtest_id}:${a.question_id}`, {
      selected: JSON.parse(a.selected_json || '[]'),
      isRagu: Boolean(a.is_ragu),
    });
  }

  const evalInputs: Array<{ questionId: number; subtest: string; selected: string[]; correct: string[] }> = [];
  for (const st of subtests) {
    const qIds = JSON.parse(st.question_ids_json || '[]') as number[];
    for (const qid of qIds) {
      const snap = snapshots[String(qid)];
      let correct: string[] | null = null;
      if (snap && Array.isArray(snap.correct_answer)) {
        correct = snap.correct_answer.map(String);
      } else {
        const q = db.prepare('SELECT id, subtest, correct_answer_json FROM tryout_questions WHERE id = ?').get(qid) as
          | { id: number; subtest: string; correct_answer_json: string }
          | undefined;
        if (q) {
          correct = JSON.parse(q.correct_answer_json || '[]') as string[];
        }
      }
      if (!correct) continue;
      const ans = answerMap.get(`${st.id}:${qid}`);
      const selected = ans ? ans.selected : [];

      evalInputs.push({
        questionId: qid,
        subtest: st.subtest_name,
        selected,
        correct,
      });

      // Update mastery without clearing active ragu!
      const selSorted = [...selected].sort();
      const corSorted = [...correct].sort();
      const isCorrect = selSorted.length > 0 && selSorted.length === corSorted.length && selSorted.every((v, i) => v === corSorted[i]);
      if (selected.length > 0 || ans?.isRagu) {
        const cur = getMasteryRow(userId, qid, 'tryout');
        const next = applyAnswerToMastery(cur, {
          isCorrect: selected.length > 0 ? isCorrect : undefined,
          markRagu: ans?.isRagu ? true : undefined,
        });
        saveMasteryRow(userId, qid, next, 'tryout', isCorrect ? 'answered_correct' : 'answered_wrong', 'tryout');
      }
    }
  }

  const formula = getScoringConfig();
  const scoreResult = calculateTryoutScore(evalInputs, formula);
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE tryout_sessions
     SET status = 'completed', raw_correct = ?, raw_wrong = ?, raw_blank = ?, utbk_score = ?, subtest_scores_json = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    scoreResult.correctCount,
    scoreResult.wrongCount,
    scoreResult.blankCount,
    scoreResult.utbkScore,
    JSON.stringify(scoreResult.subtestScores),
    nowIso,
    sessionId
  );

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'tryout_completed',
    `Menyelesaikan Try Out dengan skor ${scoreResult.utbkScore}`,
    nowIso
  );
}

learningRouter.get('/tryout/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const session = db.prepare('SELECT * FROM tryout_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi Try Out tidak ditemukan.' });
    return;
  }

  const pkg = db.prepare('SELECT * FROM tryout_packages WHERE id = ?').get(session.package_id) as Record<string, unknown>;
  const subtests = db
    .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(session.package_id) as Array<{
    id: number;
    package_id: number;
    subtest_code: string;
    subtest_name: string;
    duration_seconds: number;
    sort_order: number;
    question_ids_json: string;
  }>;

  const states = JSON.parse(String(session.subtest_states_json || '{}')) as Record<
    string,
    { status: string; started_at: string | null; locked_at: string | null }
  >;

  const idx = Number(session.current_subtest_index || 0);
  const currentSubtest = subtests[idx];
  let remainingSeconds = 0;

  if (session.status === 'in_progress' && currentSubtest && session.subtest_started_at) {
    remainingSeconds = computeRemainingSeconds(String(session.subtest_started_at), currentSubtest.duration_seconds);
    // Auto-lock expired subtest on server if time ran out!
    if (remainingSeconds <= 0) {
      const elapsed = currentSubtest.duration_seconds;
      const newActiveDuration = Number(session.active_duration_seconds || 0) + elapsed;
      const nowIso = new Date().toISOString();
      states[String(currentSubtest.id)] = {
        ...states[String(currentSubtest.id)],
        status: 'locked',
        locked_at: nowIso,
      };

      if (idx + 1 >= subtests.length) {
        db.prepare(
          'UPDATE tryout_sessions SET subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?'
        ).run(JSON.stringify(states), newActiveDuration, sessionId);
        finalizeTryoutSession(sessionId, uid);
        session.status = 'completed';
      } else if (session.mode === 'simulation') {
        const nextSub = subtests[idx + 1];
        states[String(nextSub.id)] = { status: 'active', started_at: nowIso, locked_at: null };
        db.prepare(
          'UPDATE tryout_sessions SET current_subtest_index = ?, subtest_started_at = ?, subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?'
        ).run(idx + 1, nowIso, JSON.stringify(states), newActiveDuration, sessionId);
        session.current_subtest_index = idx + 1;
        session.subtest_started_at = nowIso;
        remainingSeconds = nextSub.duration_seconds;
      } else {
        // Staged mode: rest allowed between subtests!
        db.prepare(
          "UPDATE tryout_sessions SET status = 'between_subtests', current_subtest_index = ?, subtest_started_at = NULL, subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?"
        ).run(idx + 1, JSON.stringify(states), newActiveDuration, sessionId);
        session.status = 'between_subtests';
        session.current_subtest_index = idx + 1;
        remainingSeconds = 0;
      }
    }
  }

  const refreshedSession = db.prepare('SELECT * FROM tryout_sessions WHERE id = ?').get(sessionId) as Record<string, unknown>;
  const isCompleted = refreshedSession.status === 'completed';

  const answersRows = db
    .prepare('SELECT subtest_id, question_id, selected_json, is_ragu FROM tryout_answers WHERE session_id = ?')
    .all(sessionId) as Array<{ subtest_id: number; question_id: number; selected_json: string; is_ragu: number }>;

  const answersMap: Record<string, { selected: string[]; is_ragu: boolean }> = {};
  for (const a of answersRows) {
    answersMap[`${a.subtest_id}:${a.question_id}`] = {
      selected: JSON.parse(a.selected_json || '[]'),
      is_ragu: Boolean(a.is_ragu),
    };
  }

  // Only reveal correct_answer & explanations AFTER session completed (prevents key leak during subtest!)
  let sessionSnapshots: Record<string, Record<string, unknown>> = {};
  try {
    sessionSnapshots = JSON.parse(String(refreshedSession.question_snapshots_json || '{}'));
  } catch {
    sessionSnapshots = {};
  }
  let impactFlag: Record<string, unknown> = {};
  try {
    impactFlag = JSON.parse(String(refreshedSession.impact_flag_json || '{}'));
  } catch {
    impactFlag = {};
  }

  const activeIdx = Number(refreshedSession.current_subtest_index || 0);
  const subtestsWithQuestions = subtests.map((st, sIdx) => {
    const qIds = JSON.parse(st.question_ids_json || '[]') as number[];
    const canSeeQuestions = isCompleted || (refreshedSession.status === 'in_progress' && sIdx === activeIdx);
    const tryoutAssetsMap = canSeeQuestions ? getQuestionAssetsMap('tryout', qIds) : new Map();
    const questions = canSeeQuestions
      ? qIds
          .map((qid) => {
            const snap = sessionSnapshots[String(qid)];
            const mastery = getMasteryRow(uid, qid, 'tryout');
            if (snap) {
              const snapAssets = Array.isArray(snap.assets) ? snap.assets : [];
              const base = {
                id: qid,
                external_code: snap.external_code,
                subtest: snap.subtest,
                topic: snap.topic,
                difficulty: snap.difficulty,
                question_type: snap.question_type,
                question_text: snap.question_text,
                image_url: snap.image_url,
                assets:
                  snapAssets.length > 0
                    ? snapAssets
                    : snap.image_url
                    ? [{ asset_url: String(snap.image_url), asset_type: 'manual', display_order: 0 }]
                    : [],
                visual_description: snap.visual_description || '',
                options: Array.isArray(snap.options) ? snap.options : [],
                mastery,
              };
              if (isCompleted) {
                return {
                  ...base,
                  correct_answer: Array.isArray(snap.correct_answer) ? snap.correct_answer : [],
                  explanation_text: snap.explanation_text || '',
                  solution_text: snap.solution_text || '',
                };
              }
              return base;
            }

            const q = db.prepare('SELECT * FROM tryout_questions WHERE id = ?').get(qid) as Record<string, unknown> | undefined;
            if (!q) return null;
            const assets = tryoutAssetsMap.get(qid) || [];
            const base = {
              id: q.id,
              external_code: q.external_code,
              subtest: q.subtest,
              topic: q.topic,
              difficulty: q.difficulty,
              question_type: q.question_type,
              question_text: q.question_text,
              image_url: q.image_url,
              assets:
                assets.length > 0
                  ? assets
                  : q.image_url
                  ? [{ asset_url: String(q.image_url), asset_type: 'manual', display_order: 0 }]
                  : [],
              visual_description: q.visual_description || '',
              options: JSON.parse(String(q.options_json || '[]')),
              mastery,
            };
            if (isCompleted) {
              return {
                ...base,
                correct_answer: JSON.parse(String(q.correct_answer_json || '[]')),
                explanation_text: q.explanation_text,
                solution_text: q.solution_text,
              };
            }
            return base;
          })
          .filter(Boolean)
      : [];

    return {
      id: st.id,
      subtest_code: st.subtest_code,
      subtest_name: st.subtest_name,
      duration_seconds: st.duration_seconds,
      sort_order: st.sort_order,
      question_count: qIds.length,
      state: states[String(st.id)] || { status: 'pending', started_at: null, locked_at: null },
      questions,
    };
  });

  res.json({
    session: {
      ...refreshedSession,
      subtest_states: JSON.parse(String(refreshedSession.subtest_states_json || '{}')),
      subtest_scores: JSON.parse(String(refreshedSession.subtest_scores_json || '{}')),
      impact_flag: impactFlag,
    },
    package: pkg,
    subtests: subtestsWithQuestions,
    answers: answersMap,
    server_now: new Date().toISOString(),
    remaining_seconds: remainingSeconds,
  });
});

// Autosave answer & ragu state
learningRouter.post('/tryout/sessions/:sessionId/answer', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const subtestId = Number(req.body?.subtest_id);
  const questionId = Number(req.body?.question_id);
  const selected = Array.isArray(req.body?.selected) ? req.body.selected.map(String) : [];
  const isRagu = Boolean(req.body?.is_ragu);

  const session = db.prepare('SELECT * FROM tryout_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;

  if (!session || session.status !== 'in_progress') {
    res.status(400).json({ error: 'Sesi Try Out tidak aktif atau subtest sudah dikunci.' });
    return;
  }

  const subtests = db
    .prepare('SELECT id, duration_seconds FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(session.package_id) as Array<{ id: number; duration_seconds: number }>;

  const activeSubtest = subtests[Number(session.current_subtest_index || 0)];
  if (!activeSubtest || activeSubtest.id !== subtestId) {
    res.status(403).json({ error: 'Subtest ini sudah dikunci dan jawabannya tidak dapat diubah.' });
    return;
  }

  const rem = computeRemainingSeconds(String(session.subtest_started_at), activeSubtest.duration_seconds);
  if (rem <= 0) {
    res.status(400).json({ error: 'Waktu subtest telah habis.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO tryout_answers (session_id, subtest_id, question_id, selected_json, is_ragu, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, subtest_id, question_id) DO UPDATE SET
       selected_json = excluded.selected_json,
       is_ragu = excluded.is_ragu,
       updated_at = excluded.updated_at`
  ).run(sessionId, subtestId, questionId, JSON.stringify(selected), isRagu ? 1 : 0, nowIso);

  // Immediately persist ragu flag in personal mastery so it survives across sessions
  if (isRagu) {
    const cur = getMasteryRow(uid, questionId, 'tryout');
    const next = applyAnswerToMastery(cur, { markRagu: true });
    saveMasteryRow(uid, questionId, next, 'tryout_autosave', 'marked_ragu', 'tryout');
  }

  res.json({ saved: true, updated_at: nowIso, remaining_seconds: rem });
});

// Finish current subtest (locks subtest; moves to next or pauses in Staged mode, or finishes Try Out)
learningRouter.post('/tryout/sessions/:sessionId/finish-subtest', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const session = db.prepare('SELECT * FROM tryout_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;

  if (!session || session.status !== 'in_progress') {
    res.status(400).json({ error: 'Tidak ada subtest aktif untuk diselesaikan.' });
    return;
  }

  const subtests = db
    .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(session.package_id) as Array<{ id: number; duration_seconds: number }>;

  const idx = Number(session.current_subtest_index || 0);
  const currentSubtest = subtests[idx];
  const nowIso = new Date().toISOString();
  const startedMs = new Date(String(session.subtest_started_at || nowIso)).getTime();
  const spent = Math.min(currentSubtest.duration_seconds, Math.max(1, Math.floor((Date.now() - startedMs) / 1000)));
  const newActiveDuration = Number(session.active_duration_seconds || 0) + spent;

  const states = JSON.parse(String(session.subtest_states_json || '{}'));
  states[String(currentSubtest.id)] = {
    ...states[String(currentSubtest.id)],
    status: 'locked',
    locked_at: nowIso,
  };

  if (idx + 1 >= subtests.length) {
    db.prepare('UPDATE tryout_sessions SET subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?').run(
      JSON.stringify(states),
      newActiveDuration,
      sessionId
    );
    finalizeTryoutSession(sessionId, uid);
    res.json({ status: 'completed' });
    return;
  }

  if (session.mode === 'simulation') {
    const nextSub = subtests[idx + 1];
    states[String(nextSub.id)] = { status: 'active', started_at: nowIso, locked_at: null };
    db.prepare(
      'UPDATE tryout_sessions SET current_subtest_index = ?, subtest_started_at = ?, subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?'
    ).run(idx + 1, nowIso, JSON.stringify(states), newActiveDuration, sessionId);
    res.json({ status: 'in_progress', next_subtest_index: idx + 1 });
  } else {
    db.prepare(
      "UPDATE tryout_sessions SET status = 'between_subtests', current_subtest_index = ?, subtest_started_at = NULL, subtest_states_json = ?, active_duration_seconds = ? WHERE id = ?"
    ).run(idx + 1, JSON.stringify(states), newActiveDuration, sessionId);
    res.json({ status: 'between_subtests', next_subtest_index: idx + 1 });
  }
});

// Resume next subtest in Mode Bertahap after resting
learningRouter.post('/tryout/sessions/:sessionId/next-subtest', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const session = db.prepare('SELECT * FROM tryout_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;

  if (!session || session.mode !== 'staged' || session.status !== 'between_subtests') {
    res.status(400).json({ error: 'Sesi tidak berada dalam status istirahat antar-subtest.' });
    return;
  }

  const subtests = db
    .prepare('SELECT * FROM tryout_subtests WHERE package_id = ? ORDER BY sort_order ASC')
    .all(session.package_id) as Array<{ id: number }>;

  const idx = Number(session.current_subtest_index || 0);
  const targetSub = subtests[idx];
  if (!targetSub) {
    finalizeTryoutSession(sessionId, uid);
    res.json({ status: 'completed' });
    return;
  }

  const nowIso = new Date().toISOString();
  const states = JSON.parse(String(session.subtest_states_json || '{}'));
  states[String(targetSub.id)] = { status: 'active', started_at: nowIso, locked_at: null };

  db.prepare(
    "UPDATE tryout_sessions SET status = 'in_progress', subtest_started_at = ?, subtest_states_json = ? WHERE id = ?"
  ).run(nowIso, JSON.stringify(states), sessionId);

  res.json({ status: 'in_progress' });
});

// ==========================================
// LEADERBOARD (PACKAGE-BASED, MODE-AGNOSTIC)
// ==========================================
learningRouter.get('/leaderboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const packages = db.prepare('SELECT id, title, provider FROM tryout_packages WHERE is_published = 1 ORDER BY id ASC').all() as Array<{
    id: number;
    title: string;
    provider: string;
  }>;

  const packageId = Number(req.query.packageId) || packages[0]?.id || 0;

  const rawRows = db
    .prepare(
      `SELECT ts.user_id, u.username, u.avatar_url, ts.utbk_score, ts.active_duration_seconds, ts.completed_at
       FROM tryout_sessions ts
       JOIN users u ON u.id = ts.user_id
       WHERE ts.package_id = ? AND ts.status = 'completed' AND ts.utbk_score IS NOT NULL`
    )
    .all(packageId) as Array<{
    user_id: number;
    username: string;
    avatar_url: string;
    utbk_score: number;
    active_duration_seconds: number;
    completed_at: string;
  }>;

  const ranked = rankLeaderboardEntries(
    rawRows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      avatarUrl: r.avatar_url,
      utbkScore: r.utbk_score,
      activeDurationSeconds: r.active_duration_seconds,
      completedAt: r.completed_at,
    }))
  );

  res.json({
    packages,
    selectedPackageId: packageId,
    entries: ranked,
  });
});

// ==========================================
// LATSOL / DRILLING SOAL (APPROVED QUESTIONS ONLY)
// ==========================================
learningRouter.get('/drill/catalog', requireAuth, (req: AuthenticatedRequest, res) => {
  const rawRows = db
    .prepare(
      `SELECT subtest, topic, subtopic, COUNT(*) as question_count
       FROM questions
       WHERE is_published = 1 AND review_status = 'approved'
       GROUP BY subtest, topic, subtopic
       ORDER BY subtest, topic, subtopic`
    )
    .all() as Array<{ subtest: string; topic: string; subtopic: string; question_count: number }>;

  const catalog = db
    .prepare(
      `SELECT subtest, topic, COUNT(*) as question_count
       FROM questions
       WHERE is_published = 1 AND review_status = 'approved'
       GROUP BY subtest, topic
       ORDER BY subtest, topic`
    )
    .all() as Array<{ subtest: string; topic: string; question_count: number }>;

  const tree = buildDrillingCatalogTree(rawRows);
  const totalPublished = catalog.reduce((s, r) => s + r.question_count, 0);

  const history = db
    .prepare(
      `SELECT ds.id, ds.subtest, ds.topic, ds.mode, ds.started_at, ds.completed_at, ds.status,
              COUNT(da.id) as answered_count,
              SUM(CASE WHEN da.is_correct = 1 THEN 1 ELSE 0 END) as correct_count
       FROM drill_sessions ds
       LEFT JOIN drill_answers da ON da.session_id = ds.id
       WHERE ds.user_id = ?
       GROUP BY ds.id
       ORDER BY ds.started_at DESC
       LIMIT 20`
    )
    .all(req.user!.id);

  res.json({ catalog, tree, totalPublished, history });
});

learningRouter.post('/drill/sessions/start', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const subtest = String(req.body?.subtest || 'ALL');
  const topic = String(req.body?.topic || 'ALL');
  const subtopic = String(req.body?.subtopic || 'ALL');
  const count = Math.min(40, Math.max(1, Number(req.body?.count) || 10));
  const mode = String(req.body?.mode || 'topic'); // 'topic' | 'random' | 'retry_ragu_wrong'
  const showInstant = req.body?.show_instant_explanation !== false;

  let questionRows: Array<Record<string, unknown>> = [];

  if (mode === 'retry_ragu_wrong') {
    questionRows = db
      .prepare(
        `SELECT q.* FROM questions q
         JOIN user_question_mastery m ON m.source_type = 'drill' AND m.question_id = q.id
         WHERE q.is_published = 1 AND q.review_status = 'approved' AND m.user_id = ? AND (m.is_ragu_active = 1 OR m.wrong_count > 0)
         ORDER BY m.is_ragu_active DESC, RANDOM()
         LIMIT ?`
      )
      .all(uid, count) as Array<Record<string, unknown>>;
  } else {
    let sql = "SELECT * FROM questions WHERE is_published = 1 AND review_status = 'approved'";
    const params: unknown[] = [];
    if (subtest !== 'ALL') {
      sql += ' AND subtest = ?';
      params.push(subtest);
    }
    if (topic !== 'ALL') {
      sql += ' AND topic = ?';
      params.push(topic);
    }
    if (subtopic !== 'ALL' && subtopic.trim() !== '') {
      sql += ' AND subtopic = ?';
      params.push(subtopic);
    }
    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(count);
    questionRows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  if (questionRows.length === 0) {
    res.status(404).json({ error: 'Tidak ditemukan soal terverifikasi yang sesuai kriteria pilihan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const qIds = questionRows.map((r) => Number(r.id));
  const assetsMap = getQuestionAssetsMap('drill', qIds);
  const snapshots: Record<string, Record<string, unknown>> = {};
  for (const r of questionRows) {
    const qid = Number(r.id);
    snapshots[String(qid)] = buildQuestionSnapshot('drill', r, assetsMap.get(qid) || []);
  }

  const topicLabel = subtopic !== 'ALL' && subtopic ? `${topic} (${subtopic})` : topic;
  const info = db
    .prepare(
      `INSERT INTO drill_sessions (user_id, subtest, topic, mode, show_instant_explanation, question_ids_json, question_snapshots_json, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)`
    )
    .run(uid, subtest, topicLabel, mode, showInstant ? 1 : 0, JSON.stringify(qIds), JSON.stringify(snapshots), nowIso);

  res.status(201).json({ session_id: info.lastInsertRowid });
});

learningRouter.get('/drill/sessions/:sessionId', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const session = db.prepare('SELECT * FROM drill_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi Latsol tidak ditemukan.' });
    return;
  }

  let snapshots: Record<string, Record<string, unknown>> = {};
  try {
    snapshots = JSON.parse(String(session.question_snapshots_json || '{}'));
  } catch {
    snapshots = {};
  }

  const qIds = JSON.parse(String(session.question_ids_json || '[]')) as number[];
  const answersRows = db
    .prepare('SELECT question_id, selected_json, is_correct, is_ragu, answered_at FROM drill_answers WHERE session_id = ?')
    .all(sessionId) as Array<{ question_id: number; selected_json: string; is_correct: number; is_ragu: number; answered_at: string }>;

  const answersMap: Record<number, { selected: string[]; is_correct: boolean; is_ragu: boolean; answered_at: string }> = {};
  for (const a of answersRows) {
    answersMap[a.question_id] = {
      selected: JSON.parse(a.selected_json || '[]'),
      is_correct: Boolean(a.is_correct),
      is_ragu: Boolean(a.is_ragu),
      answered_at: a.answered_at,
    };
  }

  const showInstant = Boolean(session.show_instant_explanation);
  const isCompleted = session.status === 'completed';
  const drillAssetsMap = getQuestionAssetsMap('drill', qIds);

  const questions = qIds
    .map((qid) => {
      const snap = snapshots[String(qid)];
      const ans = answersMap[qid];
      const revealSolution = isCompleted || (showInstant && Boolean(ans && ans.selected.length > 0));
      const mastery = getMasteryRow(uid, qid);
      if (snap) {
        const snapAssets = Array.isArray(snap.assets) ? snap.assets : [];
        return {
          id: qid,
          external_code: snap.external_code,
          subtest: snap.subtest,
          topic: snap.topic,
          subtopic: snap.subtopic || '',
          difficulty: snap.difficulty,
          question_type: snap.question_type,
          question_text: snap.question_text,
          image_url: snap.image_url,
          assets:
            snapAssets.length > 0
              ? snapAssets
              : snap.image_url
              ? [{ asset_url: String(snap.image_url), asset_type: 'manual', display_order: 0 }]
              : [],
          visual_description: snap.visual_description || '',
          options: Array.isArray(snap.options) ? snap.options : [],
          mastery,
          ...(revealSolution
            ? {
                correct_answer: Array.isArray(snap.correct_answer) ? snap.correct_answer : [],
                explanation_text: snap.explanation_text || '',
                solution_text: snap.solution_text || '',
              }
            : {}),
        };
      }

      const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(qid) as Record<string, unknown> | undefined;
      if (!q) return null;
      const assets = drillAssetsMap.get(qid) || [];
      return {
        id: q.id,
        external_code: q.external_code,
        subtest: q.subtest,
        topic: q.topic,
        subtopic: q.subtopic || '',
        difficulty: q.difficulty,
        question_type: q.question_type,
        question_text: q.question_text,
        image_url: q.image_url,
        assets:
          assets.length > 0
            ? assets
            : q.image_url
            ? [{ asset_url: String(q.image_url), asset_type: 'manual', display_order: 0 }]
            : [],
        visual_description: q.visual_description || '',
        options: JSON.parse(String(q.options_json || '[]')),
        mastery,
        ...(revealSolution
          ? {
              correct_answer: JSON.parse(String(q.correct_answer_json || '[]')),
              explanation_text: q.explanation_text,
              solution_text: q.solution_text,
            }
          : {}),
      };
    })
    .filter(Boolean);

  res.json({
    session: {
      ...session,
      show_instant_explanation: showInstant,
    },
    questions,
    answers: answersMap,
  });
});

learningRouter.post('/drill/sessions/:sessionId/answer', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const questionId = Number(req.body?.question_id);
  const selected: string[] = Array.isArray(req.body?.selected) ? req.body.selected.map(String) : [];
  const isRagu = Boolean(req.body?.is_ragu);

  const session = db.prepare('SELECT * FROM drill_sessions WHERE id = ? AND user_id = ?').get(sessionId, uid) as
    | Record<string, unknown>
    | undefined;
  if (!session) {
    res.status(404).json({ error: 'Sesi Latsol tidak ditemukan.' });
    return;
  }

  let snapshots: Record<string, Record<string, unknown>> = {};
  try {
    snapshots = JSON.parse(String(session.question_snapshots_json || '{}'));
  } catch {
    snapshots = {};
  }

  let correctArr: string[] | null = null;
  const snap = snapshots[String(questionId)];
  if (snap && Array.isArray(snap.correct_answer)) {
    correctArr = snap.correct_answer.map(String);
  } else {
    const q = db.prepare('SELECT correct_answer_json FROM questions WHERE id = ?').get(questionId) as
      | { correct_answer_json: string }
      | undefined;
    if (q) {
      correctArr = JSON.parse(q.correct_answer_json || '[]') as string[];
    }
  }

  if (!correctArr) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  const correct = correctArr.map((s) => s.toUpperCase()).sort();
  const selSorted = selected.map((s) => s.toUpperCase()).sort();
  const isCorrect = selSorted.length > 0 && selSorted.length === correct.length && selSorted.every((v, i) => v === correct[i]);
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO drill_answers (session_id, question_id, selected_json, is_correct, is_ragu, answered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, question_id) DO UPDATE SET
       selected_json = excluded.selected_json,
       is_correct = excluded.is_correct,
       is_ragu = excluded.is_ragu,
       answered_at = excluded.answered_at`
  ).run(sessionId, questionId, JSON.stringify(selected), isCorrect ? 1 : 0, isRagu ? 1 : 0, nowIso);

  const curMastery = getMasteryRow(uid, questionId);
  const nextMastery = applyAnswerToMastery(curMastery, {
    isCorrect: selected.length > 0 ? isCorrect : undefined,
    markRagu: isRagu ? true : undefined,
  });
  saveMasteryRow(uid, questionId, nextMastery, 'drill', isRagu ? 'marked_ragu' : isCorrect ? 'answered_correct' : 'answered_wrong');

  res.json({ saved: true, is_correct: isCorrect, mastery: nextMastery });
});

learningRouter.post('/drill/sessions/:sessionId/finish', requireAuth, (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const uid = req.user!.id;
  const nowIso = new Date().toISOString();
  db.prepare("UPDATE drill_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND user_id = ?").run(
    nowIso,
    sessionId,
    uid
  );
  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    uid,
    'drill_completed',
    `Menyelesaikan sesi Latsol #${sessionId}`,
    nowIso
  );
  res.json({ completed: true });
});

// ==========================================
// LIBRARY, DWU REVIEW, QUESTION REPORTS
// ==========================================
learningRouter.get('/library', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM library_links ORDER BY subtest ASC, created_at DESC').all();
  res.json(rows);
});

learningRouter.get('/dwu', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';

  const schedules = db.prepare('SELECT * FROM dwu_schedules ORDER BY scheduled_date ASC').all();
  const tutorsAndMembers = db.prepare('SELECT id, username, role, avatar_url FROM users ORDER BY username ASC').all();

  // Privacy rule: Members see reviews they authored OR reviews directed to them; Admins/Super Admins see all
  const reviews = db
    .prepare(
      isAdmin
        ? `SELECT r.*, a.username as author_name, t.username as target_username
           FROM dwu_reviews r
           JOIN users a ON a.id = r.author_id
           LEFT JOIN users t ON t.id = r.target_user_id
           ORDER BY r.created_at DESC`
        : `SELECT r.*, a.username as author_name, t.username as target_username
           FROM dwu_reviews r
           JOIN users a ON a.id = r.author_id
           LEFT JOIN users t ON t.id = r.target_user_id
           WHERE r.author_id = ? OR r.target_user_id = ?
           ORDER BY r.created_at DESC`
    )
    .all(...(isAdmin ? [] : [uid, uid])) as Array<Record<string, unknown>>;

  res.json({
    schedules,
    users: tutorsAndMembers,
    reviews: reviews.map((r) => ({
      ...r,
      ratings: JSON.parse(String(r.ratings_json || '{}')),
      weak_topics: JSON.parse(String(r.weak_topics_json || '[]')),
    })),
  });
});

learningRouter.post('/dwu/reviews', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
  const direction = req.body?.direction === 'tutor_to_member' ? 'tutor_to_member' : 'member_to_tutor';

  if (direction === 'tutor_to_member' && !isAdmin) {
    res.status(403).json({ error: 'Hanya Admin/Tutor yang dapat mengirim evaluasi tutor ke anggota.' });
    return;
  }

  const targetUserId = req.body?.target_user_id ? Number(req.body.target_user_id) : null;
  const subtest = String(req.body?.subtest || '').trim();
  const topic = String(req.body?.topic || '').trim();
  const comment = String(req.body?.comment || '').trim();
  const ratings = typeof req.body?.ratings === 'object' && req.body.ratings ? req.body.ratings : {};
  const weakTopics = Array.isArray(req.body?.weak_topics) ? req.body.weak_topics.map(String) : [];

  if (!subtest || !comment) {
    res.status(400).json({ error: 'Subtest dan komentar evaluasi wajib diisi.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO dwu_reviews (direction, author_id, target_user_id, subtest, topic, ratings_json, comment, weak_topics_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(direction, uid, targetUserId, subtest, topic, JSON.stringify(ratings), comment, JSON.stringify(weakTopics), nowIso);

  res.status(201).json({ id: info.lastInsertRowid });
});

learningRouter.get('/reports', requireAuth, (req: AuthenticatedRequest, res) => {
  const uid = req.user!.id;
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';

  const rows = db
    .prepare(
      isAdmin
        ? `SELECT qr.*,
                  COALESCE(q.external_code, tq.external_code, 'SOAL') as question_code,
                  COALESCE(q.subtest, tq.subtest, 'Try Out') as question_subtest,
                  COALESCE(q.question_text, tq.question_text, '') as question_excerpt,
                  u.username as reporter_name, rev.username as reviewed_by_name
           FROM question_reports qr
           LEFT JOIN questions q ON qr.source_type = 'drill' AND q.id = qr.question_id
           LEFT JOIN tryout_questions tq ON qr.source_type = 'tryout' AND tq.id = qr.question_id
           JOIN users u ON u.id = qr.reporter_id
           LEFT JOIN users rev ON rev.id = qr.reviewed_by
           ORDER BY qr.created_at DESC`
        : `SELECT qr.*,
                  COALESCE(q.external_code, tq.external_code, 'SOAL') as question_code,
                  COALESCE(q.subtest, tq.subtest, 'Try Out') as question_subtest,
                  COALESCE(q.question_text, tq.question_text, '') as question_excerpt,
                  u.username as reporter_name, rev.username as reviewed_by_name
           FROM question_reports qr
           LEFT JOIN questions q ON qr.source_type = 'drill' AND q.id = qr.question_id
           LEFT JOIN tryout_questions tq ON qr.source_type = 'tryout' AND tq.id = qr.question_id
           JOIN users u ON u.id = qr.reporter_id
           LEFT JOIN users rev ON rev.id = qr.reviewed_by
           WHERE qr.reporter_id = ?
           ORDER BY qr.created_at DESC`
    )
    .all(...(isAdmin ? [] : [uid]));

  res.json(rows);
});

learningRouter.post('/reports', requireAuth, rateLimit(20, 60_000), (req: AuthenticatedRequest, res) => {
  const questionId = Number(req.body?.question_id);
  const sourceType = req.body?.source_type === 'tryout' ? 'tryout' : 'drill';
  const issueType = String(req.body?.issue_type || '').trim();
  const description = String(req.body?.description || '').trim();

  if (!questionId || !issueType || !description) {
    res.status(400).json({ error: 'Pilih soal, jenis masalah, dan deskripsi laporan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO question_reports (question_id, source_type, reporter_id, issue_type, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(questionId, sourceType, req.user!.id, issueType, description, nowIso, nowIso);

  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
});

// Question list for Unified Drilling Question Bank & Feedback selector
learningRouter.get('/questions', requireAuth, (req: AuthenticatedRequest, res) => {
  const subtest = String(req.query.subtest || '').trim();
  const topic = String(req.query.topic || '').trim();
  const uploadMode = String(req.query.upload_mode || '').trim();
  const search = String(req.query.q || '').trim();
  const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';

  let sql = 'SELECT * FROM questions WHERE 1=1';
  const params: unknown[] = [];
  if (!isAdmin) {
    sql += " AND is_published = 1 AND review_status = 'approved'";
  }
  if (subtest && subtest !== 'ALL') {
    sql += ' AND subtest = ?';
    params.push(subtest);
  }
  if (topic && topic !== 'ALL') {
    sql += ' AND topic = ?';
    params.push(topic);
  }
  if (uploadMode && uploadMode !== 'ALL') {
    sql += ' AND upload_mode = ?';
    params.push(uploadMode);
  }
  if (search) {
    sql += ' AND (question_text LIKE ? OR topic LIKE ? OR subtopic LIKE ? OR external_code LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY id DESC LIMIT 250';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const qBankAssetsMap = getQuestionAssetsMap(
    'drill',
    rows.map((r) => Number(r.id))
  );

  res.json(
    rows.map((q) => {
      const qid = Number(q.id);
      const assets = qBankAssetsMap.get(qid) || [];
      return {
        id: q.id,
        external_code: q.external_code,
        subtest: q.subtest,
        topic: q.topic,
        subtopic: q.subtopic || '',
        upload_mode: q.upload_mode || 'manual',
        question_number: q.question_number ?? null,
        has_visual: Boolean(q.has_visual),
        visual_description: q.visual_description || '',
        needs_review: Boolean(q.needs_review),
        review_note: q.review_note || '',
        review_status: String(q.review_status || 'pending_review'),
        input_source: String(q.input_source || 'manual'),
        version: Number(q.version || 1),
        is_published: Boolean(q.is_published ?? 1),
        difficulty: q.difficulty,
        question_type: q.question_type,
        question_text: q.question_text,
        image_url: q.image_url,
        assets:
          assets.length > 0
            ? assets
            : q.image_url
            ? [{ asset_url: String(q.image_url), asset_type: 'manual', display_order: 0 }]
            : [],
        options: JSON.parse(String(q.options_json || '[]')),
        ...(isAdmin
          ? {
              correct_answer: JSON.parse(String(q.correct_answer_json || '[]')),
              explanation_text: q.explanation_text,
              solution_text: q.solution_text,
            }
          : {}),
        created_at: q.created_at,
      };
    })
  );
});
