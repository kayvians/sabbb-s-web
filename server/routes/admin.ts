import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import multer from 'multer';
import { Router } from 'express';
import { Type } from '@google/genai';
import {
  buildQuestionSnapshot,
  db,
  getQuestionAssets,
  getQuestionAssetsMap,
  getQuestionUsageCount,
  PDF_UPLOADS_DIR,
  QUESTION_ASSETS_DIR,
  recordQuestionVersion,
  replaceQuestionAssets,
  UPLOADS_DIR,
} from '../db';
import { syncSiteAssetsToLegacySettings } from '../seed';
import { AuthenticatedRequest, bumpUserTokenVersion, rateLimit, requireAdmin, requireSuperAdmin } from '../auth';
import {
  assignTryoutSubtestBoundaries,
  canApproveChecklist,
  detectMajorQuestionChange,
  normalizeCropBoxWithPadding,
  normalizeQuestionHash,
  validatePdfDraftBeforeCommit,
  validateQuestionImportPayload,
} from '../../src/lib/utbkLogic';
import {
  encryptApiKey,
  listAiProviders,
  listRecentAiRequestLogs,
  maskApiKey,
  PROVIDER_MODELS,
  ProviderKey,
  runStructuredAiExtraction,
  testAiProviderConnection,
} from '../services/aiProviderService';
import {
  createAndRunPdfImportJob,
  formatPdfJobRow,
  recropPdfJobQuestionAsset,
  reextractPdfImportJob,
} from '../services/pdfImportService';
import type { AuditChecklistState, PdfImportDraftItem, ReviewStatus, TryoutDraftSubtest } from '../../src/types';

const execFileAsync = promisify(execFile);
export const adminRouter = Router();

const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PDF_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`);
  },
});

const uploadPdfs = multer({
  storage: pdfStorage,
  limits: { fileSize: 32 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file PDF (.pdf) yang diperbolehkan untuk import soal.'));
    }
  },
});

function saveBase64Image(prefix: string, dataUrl: string): string {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Format gambar harus PNG, JPG, WEBP, atau SVG.');
  }
  const mime = match[1];
  const buf = Buffer.from(match[2], 'base64');
  if (buf.byteLength > 3 * 1024 * 1024) {
    throw new Error('Ukuran gambar maksimal 3 MB.');
  }
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/svg+xml' ? 'svg' : 'jpg';
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
  return `/uploads/${filename}`;
}

// ==========================================
// ADMIN OVERVIEW
// ==========================================
adminRouter.get('/overview', requireAdmin, (_req, res) => {
  const memberCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const questionCount = (db.prepare('SELECT COUNT(*) as c FROM questions').get() as { c: number }).c;
  const tryoutQuestionCount = (db.prepare('SELECT COUNT(*) as c FROM tryout_questions').get() as { c: number }).c;
  const packageCount = (db.prepare('SELECT COUNT(*) as c FROM tryout_packages').get() as { c: number }).c;
  const completedTryoutCount = (db.prepare("SELECT COUNT(*) as c FROM tryout_sessions WHERE status = 'completed'").get() as { c: number }).c;
  const pendingReportsCount = (db.prepare("SELECT COUNT(*) as c FROM question_reports WHERE status IN ('pending', 'reviewing')").get() as { c: number }).c;
  const pendingReviewDrill = (db.prepare("SELECT COUNT(*) as c FROM questions WHERE review_status != 'approved'").get() as { c: number }).c;
  const pendingReviewTryout = (db.prepare("SELECT COUNT(*) as c FROM tryout_questions WHERE review_status != 'approved'").get() as { c: number }).c;
  const recentLogs =
    db
      .prepare(
        `SELECT al.id, al.action, al.details, al.created_at, u.username
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT 15`
      )
      .all();

  res.json({
    memberCount,
    questionCount,
    tryoutQuestionCount,
    packageCount,
    completedTryoutCount,
    pendingReportsCount,
    pendingReviewCount: pendingReviewDrill + pendingReviewTryout,
    recentLogs,
  });
});

// ==========================================
// USER & ROLE MANAGEMENT (RBAC ENFORCED)
// ==========================================
adminRouter.get('/users', requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.discord_id, u.username, u.avatar_url, u.role, u.target_score, u.joined_at, u.last_active_at,
              (SELECT COUNT(*) FROM tryout_sessions ts WHERE ts.user_id = u.id AND ts.status = 'completed') as completed_tryouts,
              (SELECT COUNT(*) FROM drill_answers da JOIN drill_sessions ds ON ds.id = da.session_id WHERE ds.user_id = u.id) as drill_count
       FROM users u
       ORDER BY CASE u.role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.username ASC`
    )
    .all();
  res.json(users);
});

adminRouter.patch('/users/:id/role', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  const newRole = String(req.body?.role || '');
  if (!['user', 'admin', 'super_admin'].includes(newRole)) {
    res.status(400).json({ error: 'Role tidak valid.' });
    return;
  }
  if (targetId === req.user!.id && newRole !== 'super_admin') {
    res.status(400).json({ error: 'Super Admin tidak dapat menurunkan perannya sendiri.' });
    return;
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetId);
  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'role_changed',
    `Mengubah role user #${targetId} menjadi ${newRole}`,
    new Date().toISOString()
  );
  res.json({ updated: true, role: newRole });
});

adminRouter.post('/users/:id/kick', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    res.status(400).json({ error: 'ID pengguna tidak valid.' });
    return;
  }
  if (targetId === req.user!.id) {
    res.status(400).json({ error: 'Super Admin tidak dapat mengeluarkan dirinya sendiri.' });
    return;
  }

  const targetUser = db
    .prepare('SELECT id, username, role FROM users WHERE id = ?')
    .get(targetId) as { id: number; username: string; role: string } | undefined;

  if (!targetUser) {
    res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    return;
  }

  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Invalidate all active sessions immediately via token_version bump & reset personal score target
    bumpUserTokenVersion(targetId);
    db.prepare('UPDATE users SET target_score = 760 WHERE id = ?').run(targetId);

    // 2. Wipe personal learning history, tryout scores/leaderboard entries, mastery, reviews, reports & activity logs
    // IMPORTANT: Keep questions, tryout_packages, tryout_subtests, tryout_questions, library_links, and pdf_import_jobs intact!
    db.prepare('DELETE FROM tryout_sessions WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM drill_sessions WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM user_question_mastery WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM user_question_history WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM study_targets WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM dwu_reviews WHERE author_id = ?').run(targetId);
    db.prepare('UPDATE dwu_reviews SET target_user_id = NULL WHERE target_user_id = ?').run(targetId);
    db.prepare('DELETE FROM question_reports WHERE reporter_id = ?').run(targetId);
    db.prepare('DELETE FROM activity_logs WHERE user_id = ?').run(targetId);

    db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
      req.user!.id,
      'user_kicked',
      `Super Admin mengeluarkan akun "${targetUser.username}" (#${targetId}) dan membersihkan seluruh aktivitas & riwayat belajarnya.`,
      nowIso
    );
  });

  tx();
  res.json({
    kicked: true,
    userId: targetId,
    username: targetUser.username,
    message: `Pengguna "${targetUser.username}" berhasil dikeluarkan. Sesi aktif segera diakhiri dan riwayat/leaderboard dihapus; soal serta materi yang pernah dibuat tetap tersimpan.`,
  });
});

// ==========================================
// PDF-ONLY AI IMPORT (DRILLING & TRYOUT)
// ==========================================
adminRouter.post(
  '/import/drill/pdf',
  requireAdmin,
  rateLimit(20, 60_000),
  uploadPdfs.array('pdfs', 10),
  async (req: AuthenticatedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Unggah minimal 1 file PDF soal drilling.' });
      return;
    }

    const uploadMode = req.body?.upload_mode === 'by_topic' ? 'by_topic' : 'random';
    const defaultSubtest = String(req.body?.default_subtest || 'Penalaran Umum').trim();
    const defaultTopic = String(req.body?.default_topic || '').trim();
    const defaultSubtopic = String(req.body?.default_subtopic || '').trim();

    try {
      const job = await createAndRunPdfImportJob({
        targetType: 'drill',
        uploadMode,
        defaultSubtest,
        defaultTopic,
        defaultSubtopic,
        uploadedFiles: files.map((f) => ({ originalname: f.originalname, path: f.path })),
        userId: req.user!.id,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memproses PDF.' });
    }
  }
);

adminRouter.post(
  '/import/tryout/pdf',
  requireAdmin,
  rateLimit(15, 60_000),
  uploadPdfs.array('pdfs', 10),
  async (req: AuthenticatedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Unggah minimal 1 file PDF paket Try Out.' });
      return;
    }

    const packageTitle = String(req.body?.package_title || '').trim() || files[0].originalname.replace(/\.pdf$/i, '');
    const packageProvider = String(req.body?.package_provider || 'Komunitas').trim();
    const packageDescription = String(req.body?.package_description || '').trim();

    try {
      const job = await createAndRunPdfImportJob({
        targetType: 'tryout',
        uploadMode: 'tryout',
        defaultSubtest: 'Penalaran Umum',
        defaultTopic: 'Umum',
        defaultSubtopic: '',
        packageTitle,
        packageProvider,
        packageDescription,
        uploadedFiles: files.map((f) => ({ originalname: f.originalname, path: f.path })),
        userId: req.user!.id,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memproses PDF Try Out.' });
    }
  }
);

adminRouter.get('/import/jobs', requireAdmin, (req, res) => {
  const targetType = typeof req.query.target_type === 'string' ? req.query.target_type : '';
  const rows = (
    targetType
      ? db.prepare('SELECT * FROM pdf_import_jobs WHERE target_type = ? ORDER BY id DESC LIMIT 20').all(targetType)
      : db.prepare('SELECT * FROM pdf_import_jobs ORDER BY id DESC LIMIT 20').all()
  ) as Array<Record<string, unknown>>;
  res.json(rows.map(formatPdfJobRow));
});

adminRouter.get('/import/jobs/:jobId', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(Number(req.params.jobId)) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Job import PDF tidak ditemukan.' });
    return;
  }
  res.json({ job: formatPdfJobRow(row) });
});

adminRouter.put('/import/jobs/:jobId', requireAdmin, (req, res) => {
  const jobId = Number(req.params.jobId);
  const existing = db.prepare('SELECT id FROM pdf_import_jobs WHERE id = ?').get(jobId);
  if (!existing) {
    res.status(404).json({ error: 'Job import PDF tidak ditemukan.' });
    return;
  }
  const { draft_questions, draft_subtests, package_title, package_provider, package_description } = req.body || {};
  const nowIso = new Date().toISOString();

  db.prepare(
    `UPDATE pdf_import_jobs
     SET draft_questions_json = COALESCE(?, draft_questions_json),
         draft_subtests_json = COALESCE(?, draft_subtests_json),
         package_title = COALESCE(?, package_title),
         package_provider = COALESCE(?, package_provider),
         package_description = COALESCE(?, package_description),
         updated_at = ?
     WHERE id = ?`
  ).run(
    Array.isArray(draft_questions) ? JSON.stringify(draft_questions) : null,
    Array.isArray(draft_subtests) ? JSON.stringify(draft_subtests) : null,
    typeof package_title === 'string' ? package_title : null,
    typeof package_provider === 'string' ? package_provider : null,
    typeof package_description === 'string' ? package_description : null,
    nowIso,
    jobId
  );

  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
  res.json({ job: formatPdfJobRow(row) });
});

adminRouter.post('/import/jobs/:jobId/reextract', requireAdmin, async (req, res) => {
  try {
    const job = await reextractPdfImportJob(Number(req.params.jobId));
    res.json({ job });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengekstrak ulang PDF.' });
  }
});

adminRouter.post('/import/jobs/:jobId/recrop', requireAdmin, async (req, res) => {
  const jobId = Number(req.params.jobId);
  const tempId = String(req.body?.temp_id || '').trim();
  const page = Number(req.body?.page || 1);
  const rawBbox = req.body?.bbox;
  if (!tempId || !Array.isArray(rawBbox) || rawBbox.length !== 4) {
    res.status(400).json({ error: 'Parameter temp_id, page, dan bbox [ymin, xmin, ymax, xmax] wajib valid.' });
    return;
  }
  const bbox: [number, number, number, number] = [
    Number(rawBbox[0]),
    Number(rawBbox[1]),
    Number(rawBbox[2]),
    Number(rawBbox[3]),
  ];
  try {
    const result = await recropPdfJobQuestionAsset(jobId, {
      temp_id: tempId,
      asset_index: typeof req.body?.asset_index === 'number' ? req.body.asset_index : undefined,
      page,
      bbox,
      caption: typeof req.body?.caption === 'string' ? req.body.caption : undefined,
      padding: typeof req.body?.padding === 'number' ? req.body.padding : 8,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal melakukan crop ulang gambar PDF.' });
  }
});

// Commit Drilling PDF draft into unified `questions` DB (no duplicates, requires review completion)
adminRouter.post('/import/jobs/:jobId/commit-drill', requireAdmin, (req: AuthenticatedRequest, res) => {
  const jobId = Number(req.params.jobId);
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row || row.target_type !== 'drill') {
    res.status(404).json({ error: 'Job import Drilling PDF tidak ditemukan.' });
    return;
  }

  const draftItems = Array.isArray(req.body?.draft_questions)
    ? (req.body.draft_questions as PdfImportDraftItem[])
    : (JSON.parse(String(row.draft_questions_json || '[]')) as PdfImportDraftItem[]);

  const skipDuplicates = req.body?.skip_duplicates !== false;
  const allowMissingKeys = Boolean(req.body?.allow_missing_keys);

  const existingHashes = new Set(
    (
      db
        .prepare("SELECT content_hash FROM questions WHERE content_hash IS NOT NULL AND content_hash != ''")
        .all() as Array<{ content_hash: string }>
    ).map((r) => r.content_hash)
  );

  const validation = validatePdfDraftBeforeCommit(draftItems, existingHashes, { allowMissingKeys });
  if (!validation.valid) {
    res.status(400).json({ error: validation.blockingErrors.join(' '), validation });
    return;
  }

  const nowIso = new Date().toISOString();
  const uploadMode = row.upload_mode === 'by_topic' ? 'by_topic' : 'random';
  const insertQ = db.prepare(
    `INSERT INTO questions
     (external_code, subtest, topic, subtopic, upload_mode, source_batch_id, question_number, has_visual, visual_description, needs_review, review_note, is_published, review_status, input_source, version, content_hash, difficulty, question_type, question_text, image_url, options_json, correct_answer_json, explanation_text, solution_text, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 'pending_review', 'ai_pdf', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let insertedCount = 0;
  let skippedDuplicates = 0;

  const tx = db.transaction(() => {
    for (const q of validation.itemsWithFlags) {
      if (skipDuplicates && q.is_duplicate) {
        skippedDuplicates += 1;
        continue;
      }
      const hash = normalizeQuestionHash(q.question_text);
      const draftAssets = Array.isArray(q.assets) && q.assets.length > 0
        ? q.assets
        : q.image_url
        ? [{ asset_url: q.image_url, asset_type: 'manual' as const, display_order: 0 }]
        : [];
      const primaryImage = draftAssets[0]?.asset_url || q.image_url || null;

      const info = insertQ.run(
        q.external_code || `PDF-${jobId}-${q.question_number}`,
        q.subtest || 'Penalaran Umum',
        q.topic || 'Umum',
        q.subtopic || '',
        uploadMode,
        jobId,
        q.question_number || null,
        q.has_visual || draftAssets.length > 0 ? 1 : 0,
        q.visual_description || '',
        q.review_note || 'Menunggu review Admin sebelum dipublikasikan ke Latsol.',
        hash,
        q.difficulty || 'medium',
        q.question_type || 'single_choice',
        q.question_text,
        primaryImage,
        JSON.stringify(q.options),
        JSON.stringify(q.correct_answer),
        q.explanation_text || '',
        q.solution_text || '',
        req.user!.id,
        nowIso,
        nowIso
      );
      const newQId = Number(info.lastInsertRowid);
      if (draftAssets.length > 0) {
        replaceQuestionAssets('drill', newQId, draftAssets);
      }
      const createdRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(newQId) as Record<string, unknown>;
      recordQuestionVersion({
        sourceType: 'drill',
        questionId: newQId,
        versionNumber: 1,
        changedBy: req.user!.id,
        changedByUsername: req.user!.username,
        changedByRole: req.user!.role,
        changedFields: ['initial_import'],
        beforeSnapshot: {},
        afterSnapshot: buildQuestionSnapshot('drill', createdRow),
        changeReason: `Import AI PDF (Job #${jobId})`,
      });
      insertedCount += 1;
    }

    db.prepare(
      "UPDATE pdf_import_jobs SET status = 'completed', draft_questions_json = ?, updated_at = ? WHERE id = ?"
    ).run(JSON.stringify(validation.itemsWithFlags), nowIso, jobId);
  });

  tx();

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'pdf_drill_imported',
    `Mengimpor ${insertedCount} soal Drilling dari PDF ke antrean Review (${uploadMode}, ${skippedDuplicates} duplikat dilewati).`,
    nowIso
  );

  res.status(201).json({ insertedCount, skippedDuplicates, reviewStatus: 'pending_review' });
});

// Commit Tryout PDF draft into ISOLATED tryout_packages + tryout_subtests + tryout_questions tables!
adminRouter.post('/import/jobs/:jobId/commit-tryout', requireAdmin, (req: AuthenticatedRequest, res) => {
  const jobId = Number(req.params.jobId);
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row || row.target_type !== 'tryout') {
    res.status(404).json({ error: 'Job import Try Out PDF tidak ditemukan.' });
    return;
  }

  const packageTitle = String(req.body?.package_title || row.package_title || '').trim();
  const packageProvider = String(req.body?.package_provider || row.package_provider || 'Komunitas').trim();
  const packageDescription = String(req.body?.package_description || row.package_description || '').trim();
  const isPublished = req.body?.is_published !== false;

  if (!packageTitle) {
    res.status(400).json({ error: 'Judul paket Try Out wajib diisi.' });
    return;
  }

  const draftQuestions = Array.isArray(req.body?.draft_questions)
    ? (req.body.draft_questions as PdfImportDraftItem[])
    : (JSON.parse(String(row.draft_questions_json || '[]')) as PdfImportDraftItem[]);

  const draftSubtests = Array.isArray(req.body?.draft_subtests)
    ? (req.body.draft_subtests as TryoutDraftSubtest[])
    : (JSON.parse(String(row.draft_subtests_json || '[]')) as TryoutDraftSubtest[]);

  if (draftSubtests.length === 0) {
    res.status(400).json({ error: 'Minimal harus ada 1 subtest pada paket Try Out.' });
    return;
  }

  const allowMissingKeys = Boolean(req.body?.allow_missing_keys);
  const validation = validatePdfDraftBeforeCommit(draftQuestions, new Set(), { allowMissingKeys });
  if (!validation.valid) {
    res.status(400).json({ error: validation.blockingErrors.join(' '), validation });
    return;
  }

  const { grouped } = assignTryoutSubtestBoundaries(validation.itemsWithFlags, draftSubtests);
  const nonEmptySubtests = grouped.filter((g) => g.questions.length > 0);
  if (nonEmptySubtests.length === 0) {
    res.status(400).json({ error: 'Tidak ada soal yang terpetakan ke dalam subtest.' });
    return;
  }

  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    // New PDF-imported tryout packages start unpublished (draft) until questions pass Review & Audit
    const packageId = Number(
      db
        .prepare(
          'INSERT INTO tryout_packages (title, provider, description, cover_url, is_published, created_at) VALUES (?, ?, ?, NULL, 0, ?)'
        )
        .run(packageTitle, packageProvider, packageDescription, nowIso).lastInsertRowid
    );

    const insertSub = db.prepare(
      'INSERT INTO tryout_subtests (package_id, subtest_code, subtest_name, duration_seconds, sort_order, question_ids_json) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const updateSubQIds = db.prepare('UPDATE tryout_subtests SET question_ids_json = ? WHERE id = ?');
    const insertToQ = db.prepare(
      `INSERT INTO tryout_questions
       (package_id, subtest_id, question_number, external_code, subtest, topic, subtopic, difficulty, question_type, question_text, image_url, has_visual, visual_description, options_json, correct_answer_json, explanation_text, solution_text, needs_review, review_note, review_status, input_source, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending_review', 'ai_pdf', 1, ?, ?)`
    );

    let totalQuestionsInserted = 0;

    nonEmptySubtests.forEach((sub, sIdx) => {
      const subtestId = Number(
        insertSub.run(
          packageId,
          sub.subtest_code || sub.subtest_name.slice(0, 4).toUpperCase(),
          sub.subtest_name,
          Math.max(60, Number(sub.duration_seconds) || 900),
          sIdx + 1,
          '[]'
        ).lastInsertRowid
      );

      const createdQIds: number[] = [];
      sub.questions.forEach((q, qIdx) => {
        const draftAssets = Array.isArray(q.assets) && q.assets.length > 0
          ? q.assets
          : q.image_url
          ? [{ asset_url: q.image_url, asset_type: 'manual' as const, display_order: 0 }]
          : [];
        const primaryImage = draftAssets[0]?.asset_url || q.image_url || null;

        const toQId = Number(
          insertToQ.run(
            packageId,
            subtestId,
            q.question_number || qIdx + 1,
            q.external_code || `TO${packageId}-${q.question_number || qIdx + 1}`,
            sub.subtest_name,
            q.topic || 'Umum',
            q.subtopic || '',
            q.difficulty || 'medium',
            q.question_type || 'single_choice',
            q.question_text,
            primaryImage,
            q.has_visual || draftAssets.length > 0 ? 1 : 0,
            q.visual_description || '',
            JSON.stringify(q.options),
            JSON.stringify(q.correct_answer),
            q.explanation_text || '',
            q.solution_text || '',
            q.review_note || 'Menunggu review Admin sebelum paket dipublikasikan.',
            nowIso,
            nowIso
          ).lastInsertRowid
        );
        if (draftAssets.length > 0) {
          replaceQuestionAssets('tryout', toQId, draftAssets);
        }
        const createdRow = db.prepare('SELECT * FROM tryout_questions WHERE id = ?').get(toQId) as Record<string, unknown>;
        recordQuestionVersion({
          sourceType: 'tryout',
          questionId: toQId,
          versionNumber: 1,
          changedBy: req.user!.id,
          changedByUsername: req.user!.username,
          changedByRole: req.user!.role,
          changedFields: ['initial_import'],
          beforeSnapshot: {},
          afterSnapshot: buildQuestionSnapshot('tryout', createdRow),
          changeReason: `Import Try Out AI PDF "${packageTitle}"`,
        });
        createdQIds.push(toQId);
        totalQuestionsInserted += 1;
      });

      updateSubQIds.run(JSON.stringify(createdQIds), subtestId);
    });

    db.prepare(
      "UPDATE pdf_import_jobs SET status = 'completed', package_title = ?, package_provider = ?, package_description = ?, draft_questions_json = ?, draft_subtests_json = ?, updated_at = ? WHERE id = ?"
    ).run(
      packageTitle,
      packageProvider,
      packageDescription,
      JSON.stringify(validation.itemsWithFlags),
      JSON.stringify(draftSubtests),
      nowIso,
      jobId
    );

    return { packageId, totalQuestionsInserted, subtestCount: nonEmptySubtests.length };
  });

  const result = tx();

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'pdf_tryout_imported_draft',
    `Mengimpor draft paket Try Out "${packageTitle}" (${result.subtestCount} subtest, ${result.totalQuestionsInserted} soal masuk Review & Audit).`,
    nowIso
  );

  res.status(201).json({ ...result, isPublished: false, reviewStatus: 'pending_review' });
});

adminRouter.post('/questions/upload-image', requireAdmin, (req, res) => {
  try {
    const url = saveBase64Image('qimg', String(req.body?.data_url || ''));
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengunggah gambar soal.' });
  }
});

// Standalone manual image crop endpoint (does NOT require a PDF import job; keeps original image intact)
adminRouter.post('/questions/crop-image', requireAdmin, async (req, res) => {
  const imageUrl = String(req.body?.image_url || '').trim();
  const rawBbox = req.body?.bbox;
  if (!imageUrl || !Array.isArray(rawBbox) || rawBbox.length !== 4) {
    res.status(400).json({ error: 'Parameter image_url dan bbox [ymin, xmin, ymax, xmax] wajib valid.' });
    return;
  }
  if (!imageUrl.startsWith('/uploads/')) {
    res.status(400).json({ error: 'Hanya gambar lokal di /uploads/ yang dapat di-crop di server.' });
    return;
  }

  const relPath = imageUrl.replace(/^\/uploads\//, '');
  const resolvedSource = path.resolve(UPLOADS_DIR, relPath);
  const uploadsRootWithSep = UPLOADS_DIR.endsWith(path.sep) ? UPLOADS_DIR : `${UPLOADS_DIR}${path.sep}`;
  if (!resolvedSource.startsWith(uploadsRootWithSep) || !fs.existsSync(resolvedSource)) {
    res.status(404).json({ error: 'File gambar sumber tidak ditemukan atau path tidak valid.' });
    return;
  }

  try {
    const { stdout } = await execFileAsync('identify', ['-format', '%w %h', resolvedSource]);
    const parts = stdout.trim().split(/\s+/);
    const naturalW = Number(parts[0]) || 0;
    const naturalH = Number(parts[1]) || 0;
    if (naturalW <= 0 || naturalH <= 0) {
      res.status(400).json({ error: 'Gagal membaca dimensi gambar sumber.' });
      return;
    }

    const bbox = normalizeCropBoxWithPadding(
      [Number(rawBbox[0]), Number(rawBbox[1]), Number(rawBbox[2]), Number(rawBbox[3])],
      0
    );
    const [ymin, xmin, ymax, xmax] = bbox;
    const pxX = Math.max(0, Math.floor((xmin / 1000) * naturalW));
    const pxY = Math.max(0, Math.floor((ymin / 1000) * naturalH));
    const pxW = Math.max(16, Math.min(naturalW - pxX, Math.ceil(((xmax - xmin) / 1000) * naturalW)));
    const pxH = Math.max(16, Math.min(naturalH - pxY, Math.ceil(((ymax - ymin) / 1000) * naturalH)));

    const outName = `mcrop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
    const outPath = path.join(QUESTION_ASSETS_DIR, outName);
    await execFileAsync('convert', [resolvedSource, '-crop', `${pxW}x${pxH}+${pxX}+${pxY}`, '+repage', outPath]);

    res.json({
      asset_url: `/uploads/question_assets/${outName}`,
      crop_box: bbox,
      width: pxW,
      height: pxH,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Gagal memotong gambar.' });
  }
});

function flagImpactedSessionsForKeyChange(sourceType: 'drill' | 'tryout', questionId: number, externalCode: string): void {
  const nowIso = new Date().toISOString();
  if (sourceType === 'tryout') {
    const impacted = db
      .prepare('SELECT DISTINCT session_id FROM tryout_answers WHERE question_id = ?')
      .all(questionId) as Array<{ session_id: number }>;
    const upd = db.prepare('UPDATE tryout_sessions SET impact_flag_json = ? WHERE id = ?');
    for (const row of impacted) {
      const sess = db.prepare('SELECT impact_flag_json FROM tryout_sessions WHERE id = ?').get(row.session_id) as
        | { impact_flag_json?: string }
        | undefined;
      let existing: { affected_question_codes?: string[] } = {};
      try {
        existing = JSON.parse(String(sess?.impact_flag_json || '{}'));
      } catch {
        existing = {};
      }
      const codes = Array.from(new Set([...(existing.affected_question_codes || []), externalCode]));
      upd.run(
        JSON.stringify({
          key_corrected: true,
          updated_at: nowIso,
          affected_question_codes: codes,
          note: `Kunci jawaban soal (${codes.join(', ')}) diperbarui setelah sesi dibuat. Skor sesi historis tetap menggunakan snapshot saat pengerjaan.`,
        }),
        row.session_id
      );
    }
  }
}

// ==========================================
// QUESTION BANK CRUD (UNIFIED DRILLING DB)
// ==========================================
adminRouter.post('/questions', requireAdmin, (req: AuthenticatedRequest, res) => {
  const {
    external_code,
    subtest,
    topic,
    subtopic,
    difficulty,
    question_type,
    question_text,
    image_url,
    assets,
    visual_description,
    options,
    correct_answer,
    explanation_text,
    solution_text,
  } = req.body || {};

  if (!subtest || !question_text || !Array.isArray(options) || options.length < 2 || !Array.isArray(correct_answer) || correct_answer.length === 0) {
    res.status(400).json({ error: 'Data soal belum lengkap (subtest, pertanyaan, minimal 2 opsi, dan kunci jawaban wajib diisi).' });
    return;
  }

  const nowIso = new Date().toISOString();
  const draftAssets = Array.isArray(assets) && assets.length > 0
    ? assets
    : image_url
    ? [{ asset_url: String(image_url), asset_type: 'manual', display_order: 0 }]
    : [];
  const primaryImg = draftAssets[0]?.asset_url || image_url || null;

  const info = db
    .prepare(
      `INSERT INTO questions (external_code, subtest, topic, subtopic, upload_mode, has_visual, visual_description, needs_review, review_note, review_status, input_source, version, difficulty, question_type, question_text, image_url, options_json, correct_answer_json, explanation_text, solution_text, content_hash, is_published, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, 1, 'Menunggu verifikasi di Question Review', 'pending_review', 'manual', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(
      external_code || `M-${Date.now().toString().slice(-6)}`,
      subtest,
      topic || 'Umum',
      subtopic || '',
      primaryImg ? 1 : 0,
      String(visual_description || ''),
      difficulty || 'medium',
      question_type || 'single_choice',
      question_text,
      primaryImg,
      JSON.stringify(options),
      JSON.stringify(correct_answer),
      explanation_text || '',
      solution_text || '',
      normalizeQuestionHash(question_text),
      req.user!.id,
      nowIso,
      nowIso
    );

  const newId = Number(info.lastInsertRowid);
  if (draftAssets.length > 0) {
    replaceQuestionAssets('drill', newId, draftAssets);
  }
  const createdRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(newId) as Record<string, unknown>;
  recordQuestionVersion({
    sourceType: 'drill',
    questionId: newId,
    versionNumber: 1,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields: ['initial_create'],
    beforeSnapshot: {},
    afterSnapshot: buildQuestionSnapshot('drill', createdRow),
    changeReason: 'Input soal manual baru (masuk antrean Review)',
  });

  res.status(201).json({ id: newId, review_status: 'pending_review' });
});

adminRouter.put('/questions/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existingRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  const {
    external_code,
    subtest,
    topic,
    subtopic,
    difficulty,
    question_type,
    question_text,
    image_url,
    options,
    correct_answer,
    explanation_text,
    solution_text,
    needs_review,
    is_published,
    assets,
    change_reason,
  } = req.body || {};

  const beforeSnap = buildQuestionSnapshot('drill', existingRow);
  const primaryImg = Array.isArray(assets) && assets.length > 0 ? assets[0]?.asset_url || null : image_url ?? existingRow.image_url ?? null;
  const nowIso = new Date().toISOString();
  const nextVersion = Number(existingRow.version || 1) + 1;

  const isMajor = detectMajorQuestionChange(
    {
      question_text: String(existingRow.question_text || ''),
      options: JSON.parse(String(existingRow.options_json || '[]')),
      correct_answer: JSON.parse(String(existingRow.correct_answer_json || '[]')),
      image_url: existingRow.image_url ? String(existingRow.image_url) : null,
      subtest: String(existingRow.subtest || ''),
    },
    {
      question_text: String(question_text ?? existingRow.question_text),
      options: Array.isArray(options) ? options : JSON.parse(String(existingRow.options_json || '[]')),
      correct_answer: Array.isArray(correct_answer) ? correct_answer : JSON.parse(String(existingRow.correct_answer_json || '[]')),
      image_url: primaryImg,
      subtest: String(subtest ?? existingRow.subtest),
    }
  );

  // If an already-approved question gets major content changes, return it to 'under_review' for QC
  let nextReviewStatus = String(existingRow.review_status || 'pending_review') as ReviewStatus;
  let nextPublished = is_published === false ? 0 : Number(existingRow.is_published || 0);
  let nextNeedsReview = needs_review ? 1 : Number(existingRow.needs_review || 0);
  if (isMajor && nextReviewStatus === 'approved') {
    nextReviewStatus = 'under_review';
    nextPublished = 0;
    nextNeedsReview = 1;
  }

  db.prepare(
    `UPDATE questions
     SET external_code = ?, subtest = ?, topic = ?, subtopic = ?, difficulty = ?, question_type = ?, question_text = ?, image_url = ?, options_json = ?, correct_answer_json = ?, explanation_text = ?, solution_text = ?, content_hash = ?, needs_review = ?, is_published = ?, review_status = ?, version = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    external_code ?? existingRow.external_code,
    subtest ?? existingRow.subtest,
    topic ?? existingRow.topic,
    subtopic ?? existingRow.subtopic ?? '',
    difficulty ?? existingRow.difficulty,
    question_type ?? existingRow.question_type,
    question_text ?? existingRow.question_text,
    primaryImg,
    JSON.stringify(Array.isArray(options) ? options : JSON.parse(String(existingRow.options_json || '[]'))),
    JSON.stringify(Array.isArray(correct_answer) ? correct_answer : JSON.parse(String(existingRow.correct_answer_json || '[]'))),
    explanation_text ?? existingRow.explanation_text ?? '',
    solution_text ?? existingRow.solution_text ?? '',
    normalizeQuestionHash(String(question_text ?? existingRow.question_text ?? '')),
    nextNeedsReview,
    nextPublished,
    nextReviewStatus,
    nextVersion,
    nowIso,
    id
  );
  if (Array.isArray(assets)) {
    replaceQuestionAssets('drill', id, assets);
  }

  const updatedRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Record<string, unknown>;
  const afterSnap = buildQuestionSnapshot('drill', updatedRow);
  const changedFields = Object.keys(afterSnap).filter(
    (k) => JSON.stringify(beforeSnap[k]) !== JSON.stringify(afterSnap[k])
  );
  recordQuestionVersion({
    sourceType: 'drill',
    questionId: id,
    versionNumber: nextVersion,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields,
    beforeSnapshot: beforeSnap,
    afterSnapshot: afterSnap,
    changeReason: String(change_reason || (isMajor ? 'Perubahan substansial soal (kembali ke review)' : 'Pembaruan metadata soal')),
  });

  res.json({ updated: true, review_status: nextReviewStatus, version: nextVersion });
});

adminRouter.delete('/questions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM question_assets WHERE source_type = 'drill' AND question_id = ?").run(id);
  db.prepare('DELETE FROM questions WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// Keep legacy JSON & text-AI endpoints available cleanly if called directly
adminRouter.post('/questions/validate-json', requireAdmin, (req, res) => {
  const existingRows = db.prepare('SELECT question_text FROM questions').all() as Array<{ question_text: string }>;
  const existingSet = new Set(existingRows.map((r) => normalizeQuestionHash(r.question_text)));
  const validation = validateQuestionImportPayload(req.body?.payload, existingSet);
  res.json(validation);
});

adminRouter.post('/questions/bulk-commit', requireAdmin, (req: AuthenticatedRequest, res) => {
  const existingRows = db.prepare('SELECT question_text FROM questions').all() as Array<{ question_text: string }>;
  const existingSet = new Set(existingRows.map((r) => normalizeQuestionHash(r.question_text)));
  const validation = validateQuestionImportPayload(req.body?.payload, existingSet);

  if (!validation.valid) {
    res.status(400).json({ error: validation.errors.join(' '), validation });
    return;
  }

  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT INTO questions (external_code, subtest, topic, subtopic, upload_mode, needs_review, review_note, review_status, input_source, version, difficulty, question_type, question_text, image_url, options_json, correct_answer_json, explanation_text, solution_text, content_hash, is_published, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', 1, 'Menunggu verifikasi di Question Review', 'pending_review', 'json', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const insertedIds: number[] = [];
    for (const q of validation.normalizedQuestions) {
      if (q.correctAnswer.length === 0) {
        throw new Error(`Soal "${q.externalCode}" belum memiliki kunci jawaban. Lengkapi di preview sebelum menyimpan.`);
      }
      const info = insertStmt.run(
        q.externalCode,
        q.subtest,
        q.topic,
        q.subtopic || '',
        q.difficulty,
        q.questionType,
        q.questionText,
        q.imageUrl,
        JSON.stringify(q.options),
        JSON.stringify(q.correctAnswer),
        q.explanation,
        q.solution,
        normalizeQuestionHash(q.questionText),
        req.user!.id,
        nowIso,
        nowIso
      );
      const qid = Number(info.lastInsertRowid);
      const createdRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(qid) as Record<string, unknown>;
      recordQuestionVersion({
        sourceType: 'drill',
        questionId: qid,
        versionNumber: 1,
        changedBy: req.user!.id,
        changedByUsername: req.user!.username,
        changedByRole: req.user!.role,
        changedFields: ['initial_json_import'],
        beforeSnapshot: {},
        afterSnapshot: buildQuestionSnapshot('drill', createdRow),
        changeReason: 'Import JSON ke antrean Review',
      });
      insertedIds.push(qid);
    }
    return insertedIds;
  });

  try {
    const insertedIds = tx();
    res.status(201).json({ insertedCount: insertedIds.length, insertedIds, reviewStatus: 'pending_review' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menyimpan soal.' });
  }
});

adminRouter.post('/questions/ai-extract', requireAdmin, rateLimit(15, 60_000), async (req, res) => {
  const rawText = String(req.body?.raw_text || '').trim();
  const defaultSubtest = String(req.body?.default_subtest || 'Penalaran Umum').trim();
  if (!rawText) {
    res.status(400).json({ error: 'Tempel teks/Markdown materi soal terlebih dahulu.' });
    return;
  }
  const prompt = `Ekstrak seluruh soal UTBK/SNBT dari materi berikut menjadi JSON terstruktur. Jangan mengarang kunci jawaban jika tidak ada di sumber. Subtest default "${defaultSubtest}".\n\nMateri:\n${rawText}`;
  try {
    const result = await runStructuredAiExtraction<Record<string, unknown>>({
      operation: 'text_ai_extract',
      geminiParts: [{ text: prompt }],
      openAiMessages: [
        { role: 'system', content: 'Extract structured Indonesian UTBK questions into strict JSON object with title, subject, and questions array.' },
        { role: 'user', content: prompt },
      ],
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subject: { type: Type.STRING },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING },
                subtest: { type: Type.STRING },
                topic: { type: Type.STRING },
                subtopic: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: { key: { type: Type.STRING }, content: { type: Type.STRING } },
                  },
                },
                correct_answer: { type: Type.ARRAY, items: { type: Type.STRING } },
                explanation: { type: Type.STRING },
                solution: { type: Type.STRING },
                needs_manual_review: { type: Type.BOOLEAN },
                review_note: { type: Type.STRING },
              },
            },
          },
        },
      },
    });
    const existingRows = db.prepare('SELECT question_text FROM questions').all() as Array<{ question_text: string }>;
    const existingSet = new Set(existingRows.map((r) => normalizeQuestionHash(r.question_text)));
    const validation = validateQuestionImportPayload(result.data, existingSet);
    res.json({ extracted: result.data, validation, provider: result.providerKey, usedFallback: result.usedFallback });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Gagal mengekstrak soal dengan AI.' });
  }
});

// ==========================================
// TRY OUT PACKAGE & ISOLATED TRYOUT QUESTIONS
// ==========================================
adminRouter.post('/tryout-packages', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { title, provider, description, is_published, subtests } = req.body || {};
  if (!title || !provider || !Array.isArray(subtests) || subtests.length === 0) {
    res.status(400).json({ error: 'Judul paket, penyedia, dan minimal 1 subtest wajib diisi.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    const pkgId = Number(
      db
        .prepare('INSERT INTO tryout_packages (title, provider, description, cover_url, is_published, created_at) VALUES (?, ?, ?, NULL, ?, ?)')
        .run(title, provider, description || '', is_published === false ? 0 : 1, nowIso).lastInsertRowid
    );

    const insertSub = db.prepare(
      'INSERT INTO tryout_subtests (package_id, subtest_code, subtest_name, duration_seconds, sort_order, question_ids_json) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const updateSubQIds = db.prepare('UPDATE tryout_subtests SET question_ids_json = ? WHERE id = ?');
    const insertToQ = db.prepare(
      `INSERT INTO tryout_questions (package_id, subtest_id, question_number, external_code, subtest, topic, subtopic, difficulty, question_type, question_text, image_url, has_visual, visual_description, options_json, correct_answer_json, explanation_text, solution_text, needs_review, review_note, review_status, input_source, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, 0, '', 'approved', 'manual', 1, ?, ?)`
    );

    subtests.forEach(
      (st: { subtest_code?: string; subtest_name: string; duration_seconds: number; question_ids: number[] }, idx: number) => {
        const subId = Number(
          insertSub.run(
            pkgId,
            st.subtest_code || st.subtest_name.slice(0, 4).toUpperCase(),
            st.subtest_name,
            Math.max(60, Number(st.duration_seconds) || 900),
            idx + 1,
            '[]'
          ).lastInsertRowid
        );

        const pickedIds = Array.isArray(st.question_ids) ? st.question_ids : [];
        const srcAssetsMap = getQuestionAssetsMap('drill', pickedIds);
        const clonedToIds: number[] = [];
        pickedIds.forEach((qid, qIdx) => {
          const srcQ = db
            .prepare("SELECT * FROM questions WHERE id = ? AND is_published = 1 AND review_status = 'approved'")
            .get(qid) as Record<string, unknown> | undefined;
          if (!srcQ) return;
          const newToQId = Number(
            insertToQ.run(
              pkgId,
              subId,
              qIdx + 1,
              `TO${pkgId}-${srcQ.external_code}`,
              st.subtest_name,
              srcQ.topic,
              srcQ.subtopic || '',
              srcQ.difficulty,
              srcQ.question_type,
              srcQ.question_text,
              srcQ.image_url,
              srcQ.options_json,
              srcQ.correct_answer_json,
              srcQ.explanation_text,
              srcQ.solution_text,
              nowIso,
              nowIso
            ).lastInsertRowid
          );
          const srcAssets = srcAssetsMap.get(qid) || [];
          if (srcAssets.length > 0) {
            replaceQuestionAssets('tryout', newToQId, srcAssets);
          }
          clonedToIds.push(newToQId);
        });
        updateSubQIds.run(JSON.stringify(clonedToIds), subId);
      }
    );
    return pkgId;
  });

  const pkgId = tx();
  res.status(201).json({ id: pkgId });
});

adminRouter.get('/tryout-packages/:id/questions', requireAdmin, (req, res) => {
  const pkgId = Number(req.params.id);
  const rows = db
    .prepare('SELECT * FROM tryout_questions WHERE package_id = ? ORDER BY subtest_id ASC, question_number ASC, id ASC')
    .all(pkgId) as Array<Record<string, unknown>>;
  const assetsMap = getQuestionAssetsMap(
    'tryout',
    rows.map((r) => Number(r.id))
  );
  res.json(
    rows.map((q) => {
      const qid = Number(q.id);
      const assets = assetsMap.get(qid) || [];
      return {
        ...q,
        assets,
        options: JSON.parse(String(q.options_json || '[]')),
        correct_answer: JSON.parse(String(q.correct_answer_json || '[]')),
        has_visual: Boolean(q.has_visual),
        needs_review: Boolean(q.needs_review),
      };
    })
  );
});

adminRouter.put('/tryout-questions/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existingRow = db.prepare('SELECT * FROM tryout_questions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Soal Try Out tidak ditemukan.' });
    return;
  }

  const { question_text, options, correct_answer, explanation_text, solution_text, image_url, assets, change_reason } =
    req.body || {};
  const beforeSnap = buildQuestionSnapshot('tryout', existingRow);
  const nextImg = Array.isArray(assets) ? assets[0]?.asset_url ?? null : image_url ?? existingRow.image_url ?? null;
  const nowIso = new Date().toISOString();
  const nextVersion = Number(existingRow.version || 1) + 1;

  const prevCorrect = JSON.parse(String(existingRow.correct_answer_json || '[]')) as string[];
  const nextCorrect = Array.isArray(correct_answer) ? correct_answer : prevCorrect;
  const keyChanged =
    [...prevCorrect].map((s) => s.toUpperCase()).sort().join(',') !==
    [...nextCorrect].map((s) => String(s).toUpperCase()).sort().join(',');

  db.prepare(
    `UPDATE tryout_questions
     SET question_text = COALESCE(?, question_text),
         options_json = COALESCE(?, options_json),
         correct_answer_json = COALESCE(?, correct_answer_json),
         explanation_text = COALESCE(?, explanation_text),
         solution_text = COALESCE(?, solution_text),
         image_url = ?,
         version = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    question_text ?? null,
    Array.isArray(options) ? JSON.stringify(options) : null,
    Array.isArray(correct_answer) ? JSON.stringify(correct_answer) : null,
    explanation_text ?? null,
    solution_text ?? null,
    nextImg,
    nextVersion,
    nowIso,
    id
  );
  if (Array.isArray(assets)) {
    replaceQuestionAssets('tryout', id, assets);
  }

  const updatedRow = db.prepare('SELECT * FROM tryout_questions WHERE id = ?').get(id) as Record<string, unknown>;
  const afterSnap = buildQuestionSnapshot('tryout', updatedRow);
  const changedFields = Object.keys(afterSnap).filter(
    (k) => JSON.stringify(beforeSnap[k]) !== JSON.stringify(afterSnap[k])
  );
  recordQuestionVersion({
    sourceType: 'tryout',
    questionId: id,
    versionNumber: nextVersion,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields,
    beforeSnapshot: beforeSnap,
    afterSnapshot: afterSnap,
    changeReason: String(change_reason || 'Pembaruan soal Try Out'),
  });

  if (keyChanged) {
    flagImpactedSessionsForKeyChange('tryout', id, String(existingRow.external_code || `TO#${id}`));
  }

  res.json({ updated: true, version: nextVersion });
});

adminRouter.patch('/tryout-packages/:id/publish', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const isPublished = Boolean(req.body?.is_published);
  if (isPublished) {
    const unapproved = db
      .prepare("SELECT COUNT(*) as c FROM tryout_questions WHERE package_id = ? AND review_status != 'approved'")
      .get(id) as { c: number };
    if (unapproved.c > 0) {
      res.status(400).json({
        error: `Paket Try Out belum dapat dipublikasikan karena masih ada ${unapproved.c} soal yang belum disetujui di Review & Audit.`,
      });
      return;
    }
  }
  db.prepare('UPDATE tryout_packages SET is_published = ? WHERE id = ?').run(isPublished ? 1 : 0, id);
  res.json({ updated: true, is_published: isPublished });
});

adminRouter.delete('/tryout-packages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tryout_packages WHERE id = ?').run(Number(req.params.id));
  res.json({ deleted: true });
});

// ==========================================
// UNIFIED QUESTION REVIEW, AUDIT & VERSION HISTORY
// ==========================================
adminRouter.get('/review/questions', requireAdmin, (req, res) => {
  const sourceFilter = String(req.query.source_type || 'all');
  const statusFilter = String(req.query.status || 'all');
  const inputSourceFilter = String(req.query.input_source || 'all');
  const subtestFilter = String(req.query.subtest || 'all');
  const diffFilter = String(req.query.difficulty || 'all');
  const search = String(req.query.q || '').trim().toLowerCase();
  const sortBy = String(req.query.sort || 'newest');

  const items: Array<Record<string, unknown>> = [];

  if (sourceFilter === 'all' || sourceFilter === 'drill') {
    const drillRows = db.prepare('SELECT * FROM questions ORDER BY id DESC').all() as Array<Record<string, unknown>>;
    const assetsMap = getQuestionAssetsMap(
      'drill',
      drillRows.map((r) => Number(r.id))
    );
    for (const r of drillRows) {
      const qid = Number(r.id);
      let checklist: AuditChecklistState = {};
      try {
        checklist = JSON.parse(String(r.audit_checklist_json || '{}'));
      } catch {
        checklist = {};
      }
      items.push({
        id: qid,
        source_type: 'drill',
        external_code: String(r.external_code || ''),
        subtest: String(r.subtest || ''),
        topic: String(r.topic || ''),
        subtopic: String(r.subtopic || ''),
        difficulty: String(r.difficulty || 'medium'),
        question_type: String(r.question_type || 'single_choice'),
        question_text: String(r.question_text || ''),
        image_url: r.image_url ? String(r.image_url) : null,
        assets: assetsMap.get(qid) || [],
        options: JSON.parse(String(r.options_json || '[]')),
        correct_answer: JSON.parse(String(r.correct_answer_json || '[]')),
        explanation_text: String(r.explanation_text || ''),
        solution_text: String(r.solution_text || ''),
        review_status: String(r.review_status || 'pending_review'),
        input_source: String(r.input_source || 'manual'),
        version: Number(r.version || 1),
        audit_checklist: checklist,
        reviewer_notes: String(r.reviewer_notes || ''),
        review_note: String(r.review_note || ''),
        is_published: Boolean(r.is_published),
        has_visual: Boolean(r.has_visual),
        usage_count: getQuestionUsageCount('drill', qid),
        package_title: null,
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || r.created_at || ''),
      });
    }
  }

  if (sourceFilter === 'all' || sourceFilter === 'tryout') {
    const toRows = db
      .prepare(
        `SELECT tq.*, tp.title as package_title
         FROM tryout_questions tq
         LEFT JOIN tryout_packages tp ON tp.id = tq.package_id
         ORDER BY tq.id DESC`
      )
      .all() as Array<Record<string, unknown>>;
    const assetsMap = getQuestionAssetsMap(
      'tryout',
      toRows.map((r) => Number(r.id))
    );
    for (const r of toRows) {
      const qid = Number(r.id);
      let checklist: AuditChecklistState = {};
      try {
        checklist = JSON.parse(String(r.audit_checklist_json || '{}'));
      } catch {
        checklist = {};
      }
      items.push({
        id: qid,
        source_type: 'tryout',
        package_id: Number(r.package_id),
        package_title: String(r.package_title || ''),
        external_code: String(r.external_code || ''),
        subtest: String(r.subtest || ''),
        topic: String(r.topic || ''),
        subtopic: String(r.subtopic || ''),
        difficulty: String(r.difficulty || 'medium'),
        question_type: String(r.question_type || 'single_choice'),
        question_text: String(r.question_text || ''),
        image_url: r.image_url ? String(r.image_url) : null,
        assets: assetsMap.get(qid) || [],
        options: JSON.parse(String(r.options_json || '[]')),
        correct_answer: JSON.parse(String(r.correct_answer_json || '[]')),
        explanation_text: String(r.explanation_text || ''),
        solution_text: String(r.solution_text || ''),
        review_status: String(r.review_status || 'pending_review'),
        input_source: String(r.input_source || 'ai_pdf'),
        version: Number(r.version || 1),
        audit_checklist: checklist,
        reviewer_notes: String(r.reviewer_notes || ''),
        review_note: String(r.review_note || ''),
        is_published: r.review_status === 'approved',
        has_visual: Boolean(r.has_visual),
        usage_count: getQuestionUsageCount('tryout', qid),
        created_at: String(r.created_at || ''),
        updated_at: String(r.updated_at || r.created_at || ''),
      });
    }
  }

  const filtered = items.filter((item) => {
    if (statusFilter !== 'all' && item.review_status !== statusFilter) return false;
    if (inputSourceFilter !== 'all' && item.input_source !== inputSourceFilter) return false;
    if (subtestFilter !== 'all' && item.subtest !== subtestFilter) return false;
    if (diffFilter !== 'all' && item.difficulty !== diffFilter) return false;
    if (search) {
      const hay = `${item.id} ${item.external_code} ${item.subtest} ${item.topic} ${item.subtopic} ${item.question_text}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'oldest') return String(a.created_at).localeCompare(String(b.created_at));
    if (sortBy === 'code') return String(a.external_code).localeCompare(String(b.external_code));
    if (sortBy === 'most_used') return Number(b.usage_count) - Number(a.usage_count);
    return String(b.updated_at).localeCompare(String(a.updated_at));
  });

  res.json(filtered);
});

adminRouter.put('/review/questions/:sourceType/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const sourceType = req.params.sourceType === 'tryout' ? 'tryout' : 'drill';
  const id = Number(req.params.id);
  const table = sourceType === 'tryout' ? 'tryout_questions' : 'questions';

  const existingRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  const {
    external_code,
    subtest,
    topic,
    subtopic,
    difficulty,
    question_type,
    question_text,
    image_url,
    assets,
    options,
    correct_answer,
    explanation_text,
    solution_text,
    reviewer_notes,
    audit_checklist,
    change_reason,
  } = req.body || {};

  const beforeSnap = buildQuestionSnapshot(sourceType, existingRow);
  const primaryImg = Array.isArray(assets)
    ? assets[0]?.asset_url || null
    : image_url !== undefined
    ? image_url || null
    : existingRow.image_url
    ? String(existingRow.image_url)
    : null;

  const prevOptions = JSON.parse(String(existingRow.options_json || '[]'));
  const prevCorrect = JSON.parse(String(existingRow.correct_answer_json || '[]')) as string[];
  const nextOptions = Array.isArray(options) ? options : prevOptions;
  const nextCorrect = Array.isArray(correct_answer) ? correct_answer : prevCorrect;
  const nextQText = String(question_text ?? existingRow.question_text);
  const nextSubtest = String(subtest ?? existingRow.subtest);

  const isMajor = detectMajorQuestionChange(
    {
      question_text: String(existingRow.question_text || ''),
      options: prevOptions,
      correct_answer: prevCorrect,
      image_url: existingRow.image_url ? String(existingRow.image_url) : null,
      subtest: String(existingRow.subtest || ''),
    },
    {
      question_text: nextQText,
      options: nextOptions,
      correct_answer: nextCorrect,
      image_url: primaryImg,
      subtest: nextSubtest,
    }
  );

  const keyChanged =
    [...prevCorrect].map((s) => String(s).toUpperCase()).sort().join(',') !==
    [...nextCorrect].map((s) => String(s).toUpperCase()).sort().join(',');

  const nowIso = new Date().toISOString();
  const nextVersion = Number(existingRow.version || 1) + 1;

  let nextReviewStatus = String(existingRow.review_status || 'pending_review') as ReviewStatus;
  if (isMajor && nextReviewStatus === 'approved') {
    nextReviewStatus = 'under_review';
  }

  const nextChecklistJson = audit_checklist
    ? JSON.stringify(audit_checklist)
    : String(existingRow.audit_checklist_json || '{}');

  if (sourceType === 'drill') {
    const nextPub = nextReviewStatus === 'approved' ? 1 : 0;
    db.prepare(
      `UPDATE questions
       SET external_code = ?, subtest = ?, topic = ?, subtopic = ?, difficulty = ?, question_type = ?,
           question_text = ?, image_url = ?, has_visual = ?, options_json = ?, correct_answer_json = ?,
           explanation_text = ?, solution_text = ?, content_hash = ?, review_status = ?, is_published = ?,
           needs_review = ?, reviewer_notes = ?, audit_checklist_json = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      external_code ?? existingRow.external_code,
      nextSubtest,
      topic ?? existingRow.topic,
      subtopic ?? existingRow.subtopic ?? '',
      difficulty ?? existingRow.difficulty,
      question_type ?? existingRow.question_type,
      nextQText,
      primaryImg,
      primaryImg ? 1 : Number(existingRow.has_visual || 0),
      JSON.stringify(nextOptions),
      JSON.stringify(nextCorrect),
      explanation_text ?? existingRow.explanation_text ?? '',
      solution_text ?? existingRow.solution_text ?? '',
      normalizeQuestionHash(nextQText),
      nextReviewStatus,
      nextPub,
      nextPub ? 0 : 1,
      reviewer_notes ?? existingRow.reviewer_notes ?? '',
      nextChecklistJson,
      nextVersion,
      nowIso,
      id
    );
  } else {
    db.prepare(
      `UPDATE tryout_questions
       SET external_code = ?, subtest = ?, topic = ?, subtopic = ?, difficulty = ?, question_type = ?,
           question_text = ?, image_url = ?, has_visual = ?, options_json = ?, correct_answer_json = ?,
           explanation_text = ?, solution_text = ?, review_status = ?, needs_review = ?,
           reviewer_notes = ?, audit_checklist_json = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      external_code ?? existingRow.external_code,
      nextSubtest,
      topic ?? existingRow.topic,
      subtopic ?? existingRow.subtopic ?? '',
      difficulty ?? existingRow.difficulty,
      question_type ?? existingRow.question_type,
      nextQText,
      primaryImg,
      primaryImg ? 1 : Number(existingRow.has_visual || 0),
      JSON.stringify(nextOptions),
      JSON.stringify(nextCorrect),
      explanation_text ?? existingRow.explanation_text ?? '',
      solution_text ?? existingRow.solution_text ?? '',
      nextReviewStatus,
      nextReviewStatus === 'approved' ? 0 : 1,
      reviewer_notes ?? existingRow.reviewer_notes ?? '',
      nextChecklistJson,
      nextVersion,
      nowIso,
      id
    );
  }

  if (Array.isArray(assets)) {
    replaceQuestionAssets(sourceType, id, assets);
  }

  const updatedRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
  const afterSnap = buildQuestionSnapshot(sourceType, updatedRow);
  const changedFields = Object.keys(afterSnap).filter(
    (k) => JSON.stringify(beforeSnap[k]) !== JSON.stringify(afterSnap[k])
  );
  recordQuestionVersion({
    sourceType,
    questionId: id,
    versionNumber: nextVersion,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields,
    beforeSnapshot: beforeSnap,
    afterSnapshot: afterSnap,
    changeReason: String(change_reason || (isMajor ? 'Revisi substansial dari Review Console' : 'Perbaikan ringan dari Review Console')),
  });

  if (keyChanged && sourceType === 'tryout') {
    flagImpactedSessionsForKeyChange('tryout', id, String(updatedRow.external_code || `TO#${id}`));
  }

  res.json({ updated: true, review_status: nextReviewStatus, version: nextVersion });
});

adminRouter.patch('/review/questions/:sourceType/:id/status', requireAdmin, (req: AuthenticatedRequest, res) => {
  const sourceType = req.params.sourceType === 'tryout' ? 'tryout' : 'drill';
  const id = Number(req.params.id);
  const table = sourceType === 'tryout' ? 'tryout_questions' : 'questions';

  const nextStatus = String(req.body?.review_status || '') as ReviewStatus;
  if (!['pending_review', 'under_review', 'needs_correction', 'approved', 'rejected'].includes(nextStatus)) {
    res.status(400).json({ error: 'Status review tidak valid.' });
    return;
  }

  const existingRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!existingRow) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  let checklist: AuditChecklistState = {};
  try {
    checklist = req.body?.audit_checklist || JSON.parse(String(existingRow.audit_checklist_json || '{}'));
  } catch {
    checklist = {};
  }

  const reviewerNotes = String(req.body?.reviewer_notes ?? existingRow.reviewer_notes ?? '').trim();

  if (nextStatus === 'approved') {
    const check = canApproveChecklist(checklist);
    if (!check.ok) {
      res.status(400).json({
        error: `Checklist QC wajib dilengkapi sebelum menyetujui soal: ${check.missingLabels.join('; ')}`,
      });
      return;
    }
    const correctAns = JSON.parse(String(existingRow.correct_answer_json || '[]')) as string[];
    if (correctAns.length === 0) {
      res.status(400).json({ error: 'Soal belum memiliki kunci jawaban dan tidak dapat disetujui.' });
      return;
    }
  }

  const beforeSnap = buildQuestionSnapshot(sourceType, existingRow);
  const nowIso = new Date().toISOString();
  const nextVersion = Number(existingRow.version || 1) + 1;

  if (sourceType === 'drill') {
    const publishFlag = nextStatus === 'approved' ? 1 : 0;
    db.prepare(
      `UPDATE questions
       SET review_status = ?, is_published = ?, needs_review = ?, audit_checklist_json = ?, reviewer_notes = ?, last_reviewed_by = ?, last_reviewed_at = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      publishFlag,
      publishFlag ? 0 : 1,
      JSON.stringify(checklist),
      reviewerNotes,
      req.user!.id,
      nowIso,
      nextVersion,
      nowIso,
      id
    );
  } else {
    db.prepare(
      `UPDATE tryout_questions
       SET review_status = ?, needs_review = ?, audit_checklist_json = ?, reviewer_notes = ?, last_reviewed_by = ?, last_reviewed_at = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      nextStatus === 'approved' ? 0 : 1,
      JSON.stringify(checklist),
      reviewerNotes,
      req.user!.id,
      nowIso,
      nextVersion,
      nowIso,
      id
    );
  }

  const updatedRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
  recordQuestionVersion({
    sourceType,
    questionId: id,
    versionNumber: nextVersion,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields: ['review_status', 'audit_checklist', 'reviewer_notes'],
    beforeSnapshot: beforeSnap,
    afterSnapshot: buildQuestionSnapshot(sourceType, updatedRow),
    changeReason: `Status Review -> ${nextStatus}${reviewerNotes ? `: ${reviewerNotes}` : ''}`,
  });

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'question_review_status',
    `${sourceType.toUpperCase()} #${id} (${existingRow.external_code}) status -> ${nextStatus}`,
    nowIso
  );

  res.json({ updated: true, review_status: nextStatus, version: nextVersion });
});

adminRouter.get('/review/questions/:sourceType/:id/versions', requireAdmin, (req, res) => {
  const sourceType = req.params.sourceType === 'tryout' ? 'tryout' : 'drill';
  const id = Number(req.params.id);
  const rows = db
    .prepare('SELECT * FROM question_versions WHERE source_type = ? AND question_id = ? ORDER BY version_number DESC, id DESC')
    .all(sourceType, id) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      source_type: sourceType,
      question_id: Number(r.question_id),
      version_number: Number(r.version_number),
      changed_by: r.changed_by != null ? Number(r.changed_by) : null,
      changed_by_username: String(r.changed_by_username || 'System'),
      changed_by_role: String(r.changed_by_role || 'system'),
      changed_at: String(r.changed_at),
      changed_fields: JSON.parse(String(r.changed_fields_json || '[]')),
      before_snapshot: JSON.parse(String(r.before_json || '{}')),
      after_snapshot: JSON.parse(String(r.after_json || '{}')),
      change_reason: String(r.change_reason || ''),
    }))
  );
});

adminRouter.post('/review/questions/:sourceType/:id/restore/:versionId', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const sourceType = req.params.sourceType === 'tryout' ? 'tryout' : 'drill';
  const id = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  const table = sourceType === 'tryout' ? 'tryout_questions' : 'questions';

  const existingRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  const verRow = db
    .prepare('SELECT * FROM question_versions WHERE id = ? AND source_type = ? AND question_id = ?')
    .get(versionId, sourceType, id) as Record<string, unknown> | undefined;

  if (!existingRow || !verRow) {
    res.status(404).json({ error: 'Soal atau versi target tidak ditemukan.' });
    return;
  }

  const targetSnap = JSON.parse(String(verRow.after_json || '{}')) as Record<string, unknown>;
  const beforeSnap = buildQuestionSnapshot(sourceType, existingRow);
  const nowIso = new Date().toISOString();
  const nextVersion = Number(existingRow.version || 1) + 1;

  const restoredText = String(targetSnap.question_text ?? existingRow.question_text);
  const restoredOptions = Array.isArray(targetSnap.options) ? targetSnap.options : [];
  const restoredCorrect = Array.isArray(targetSnap.correct_answer) ? targetSnap.correct_answer : [];
  const restoredAssets = Array.isArray(targetSnap.assets) ? targetSnap.assets : [];
  const primaryImg = (restoredAssets[0] as { asset_url?: string } | undefined)?.asset_url || (targetSnap.image_url ? String(targetSnap.image_url) : null);

  if (sourceType === 'drill') {
    db.prepare(
      `UPDATE questions
       SET subtest = ?, topic = ?, subtopic = ?, difficulty = ?, question_type = ?, question_text = ?, image_url = ?,
           options_json = ?, correct_answer_json = ?, explanation_text = ?, solution_text = ?,
           content_hash = ?, review_status = 'under_review', is_published = 0, needs_review = 1, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(targetSnap.subtest ?? existingRow.subtest),
      String(targetSnap.topic ?? existingRow.topic),
      String(targetSnap.subtopic ?? ''),
      String(targetSnap.difficulty ?? existingRow.difficulty),
      String(targetSnap.question_type ?? existingRow.question_type),
      restoredText,
      primaryImg,
      JSON.stringify(restoredOptions),
      JSON.stringify(restoredCorrect),
      String(targetSnap.explanation_text ?? ''),
      String(targetSnap.solution_text ?? ''),
      normalizeQuestionHash(restoredText),
      nextVersion,
      nowIso,
      id
    );
  } else {
    db.prepare(
      `UPDATE tryout_questions
       SET subtest = ?, topic = ?, subtopic = ?, difficulty = ?, question_type = ?, question_text = ?, image_url = ?,
           options_json = ?, correct_answer_json = ?, explanation_text = ?, solution_text = ?,
           review_status = 'under_review', needs_review = 1, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(targetSnap.subtest ?? existingRow.subtest),
      String(targetSnap.topic ?? existingRow.topic),
      String(targetSnap.subtopic ?? ''),
      String(targetSnap.difficulty ?? existingRow.difficulty),
      String(targetSnap.question_type ?? existingRow.question_type),
      restoredText,
      primaryImg,
      JSON.stringify(restoredOptions),
      JSON.stringify(restoredCorrect),
      String(targetSnap.explanation_text ?? ''),
      String(targetSnap.solution_text ?? ''),
      nextVersion,
      nowIso,
      id
    );
  }

  replaceQuestionAssets(sourceType, id, restoredAssets as Array<{ asset_url: string; asset_type?: string }>);

  const updatedRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
  recordQuestionVersion({
    sourceType,
    questionId: id,
    versionNumber: nextVersion,
    changedBy: req.user!.id,
    changedByUsername: req.user!.username,
    changedByRole: req.user!.role,
    changedFields: ['restore'],
    beforeSnapshot: beforeSnap,
    afterSnapshot: buildQuestionSnapshot(sourceType, updatedRow),
    changeReason: `Restore ke Versi v${verRow.version_number} oleh Super Admin`,
  });

  res.json({ restored: true, version: nextVersion, review_status: 'under_review' });
});

// ==========================================
// MULTI-AI PROVIDER SETTINGS & LOGS (STRICTLY SUPER ADMIN)
// ==========================================
adminRouter.get('/ai-providers', requireSuperAdmin, (_req, res) => {
  res.json({
    providers: listAiProviders(),
    logs: listRecentAiRequestLogs(40),
  });
});

adminRouter.put('/ai-providers/:key', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const providerKey = String(req.params.key || '') as ProviderKey;
  if (providerKey !== 'gemini' && providerKey !== 'openai') {
    res.status(400).json({ error: 'Provider AI harus gemini atau openai.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM ai_providers WHERE provider_key = ?').get(providerKey) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Konfigurasi provider tidak ditemukan.' });
    return;
  }

  const { is_enabled, is_primary, is_fallback, model_name, api_key, clear_api_key } = req.body || {};
  const allowedModels = PROVIDER_MODELS[providerKey];
  const nextModel =
    typeof model_name === 'string' && allowedModels.includes(model_name.trim())
      ? model_name.trim()
      : String(existing.model_name);

  let nextEncrypted = String(existing.encrypted_api_key || '');
  let nextHint = String(existing.key_hint || '');
  if (clear_api_key === true) {
    nextEncrypted = '';
    nextHint = '';
  } else if (typeof api_key === 'string' && api_key.trim().length > 0) {
    nextEncrypted = encryptApiKey(api_key.trim());
    nextHint = maskApiKey(api_key.trim());
  }

  const nowIso = new Date().toISOString();
  const nextEnabled = typeof is_enabled === 'boolean' ? (is_enabled ? 1 : 0) : Number(existing.is_enabled);
  const nextPrimary = typeof is_primary === 'boolean' ? (is_primary ? 1 : 0) : Number(existing.is_primary);
  const nextFallback = typeof is_fallback === 'boolean' ? (is_fallback ? 1 : 0) : Number(existing.is_fallback);

  const tx = db.transaction(() => {
    if (nextPrimary === 1) {
      db.prepare('UPDATE ai_providers SET is_primary = 0 WHERE provider_key != ?').run(providerKey);
    }
    if (nextFallback === 1) {
      db.prepare('UPDATE ai_providers SET is_fallback = 0 WHERE provider_key != ?').run(providerKey);
    }
    db.prepare(
      `UPDATE ai_providers
       SET is_enabled = ?, is_primary = ?, is_fallback = ?, model_name = ?, encrypted_api_key = ?, key_hint = ?, updated_at = ?
       WHERE provider_key = ?`
    ).run(
      nextEnabled,
      nextPrimary,
      nextPrimary === 1 ? 0 : nextFallback,
      nextModel,
      nextEncrypted,
      nextHint,
      nowIso,
      providerKey
    );
  });
  tx();

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'ai_provider_updated',
    `Memperbarui konfigurasi AI Provider ${providerKey} (model: ${nextModel}, enabled: ${Boolean(nextEnabled)}).`,
    nowIso
  );

  res.json({ providers: listAiProviders() });
});

adminRouter.post('/ai-providers/:key/test', requireSuperAdmin, async (req, res) => {
  const providerKey = String(req.params.key || '') as ProviderKey;
  if (providerKey !== 'gemini' && providerKey !== 'openai') {
    res.status(400).json({ error: 'Provider AI tidak valid.' });
    return;
  }
  try {
    const result = await testAiProviderConnection(providerKey);
    res.json({ result, providers: listAiProviders() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Gagal menguji koneksi provider.' });
  }
});

adminRouter.get('/ai-logs', requireSuperAdmin, (_req, res) => {
  res.json(listRecentAiRequestLogs(50));
});

// ==========================================
// LANDING HERO TRYOUT CAROUSEL CRUD (ADMIN + SUPER ADMIN)
// ==========================================
adminRouter.get('/carousel', requireAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM tryout_carousel_cards ORDER BY sort_order ASC, id ASC')
    .all() as Array<Record<string, unknown>>;
  res.json(rows.map((r) => ({ ...r, is_active: Boolean(r.is_active) })));
});

adminRouter.post('/carousel/upload-image', requireAdmin, (req, res) => {
  try {
    const url = saveBase64Image('carousel', String(req.body?.data_url || ''));
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengunggah gambar carousel.' });
  }
});

adminRouter.post('/carousel', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { package_id, title, description, image_url, status_label, package_label, cta_label, cta_target, sort_order, is_active } =
    req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: 'Judul kartu carousel wajib diisi.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO tryout_carousel_cards (package_id, title, description, image_url, status_label, package_label, cta_label, cta_target, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      package_id ? Number(package_id) : null,
      String(title).trim(),
      String(description || '').trim(),
      String(image_url || '/src/assets/images/community_banner_1795075273360.jpg').trim(),
      String(status_label || 'Tersedia').trim(),
      String(package_label || 'Try Out UTBK').trim(),
      String(cta_label || 'Mulai Try Out').trim(),
      String(cta_target || 'tryout').trim(),
      Number(sort_order || 1),
      is_active === false ? 0 : 1,
      nowIso,
      nowIso
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

adminRouter.put('/carousel/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { package_id, title, description, image_url, status_label, package_label, cta_label, cta_target, sort_order, is_active } =
    req.body || {};
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE tryout_carousel_cards
     SET package_id = ?, title = ?, description = ?, image_url = ?, status_label = ?, package_label = ?, cta_label = ?, cta_target = ?, sort_order = ?, is_active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    package_id ? Number(package_id) : null,
    String(title || '').trim(),
    String(description || '').trim(),
    String(image_url || '').trim(),
    String(status_label || 'Tersedia').trim(),
    String(package_label || 'Try Out UTBK').trim(),
    String(cta_label || 'Mulai Try Out').trim(),
    String(cta_target || 'tryout').trim(),
    Number(sort_order || 1),
    is_active === false ? 0 : 1,
    nowIso,
    id
  );
  res.json({ updated: true });
});

adminRouter.delete('/carousel/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tryout_carousel_cards WHERE id = ?').run(Number(req.params.id));
  res.json({ deleted: true });
});

// ==========================================
// COUNTDOWNS & DWU SCHEDULES
// ==========================================
adminRouter.get('/countdowns', requireAdmin, (_req, res) => {
  res.json(db.prepare('SELECT * FROM countdown_events ORDER BY is_active DESC, target_iso ASC').all());
});

adminRouter.post('/countdowns', requireAdmin, (req, res) => {
  const { title, target_iso, timezone, is_active } = req.body || {};
  if (!title || !target_iso || Number.isNaN(new Date(target_iso).getTime())) {
    res.status(400).json({ error: 'Nama acara dan tanggal/jam target valid wajib diisi.' });
    return;
  }
  const nowIso = new Date().toISOString();
  if (is_active) {
    db.prepare('UPDATE countdown_events SET is_active = 0').run();
  }
  const info = db
    .prepare('INSERT INTO countdown_events (title, target_iso, timezone, is_active, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(title, new Date(target_iso).toISOString(), timezone || 'Asia/Jakarta', is_active ? 1 : 0, nowIso);
  res.status(201).json({ id: info.lastInsertRowid });
});

adminRouter.patch('/countdowns/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { title, target_iso, timezone, is_active } = req.body || {};
  if (is_active) {
    db.prepare('UPDATE countdown_events SET is_active = 0').run();
  }
  db.prepare(
    'UPDATE countdown_events SET title = COALESCE(?, title), target_iso = COALESCE(?, target_iso), timezone = COALESCE(?, timezone), is_active = COALESCE(?, is_active) WHERE id = ?'
  ).run(
    title ?? null,
    target_iso ? new Date(target_iso).toISOString() : null,
    timezone ?? null,
    typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null,
    id
  );
  res.json({ updated: true });
});

adminRouter.delete('/countdowns/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM countdown_events WHERE id = ?').run(Number(req.params.id));
  res.json({ deleted: true });
});

adminRouter.post('/dwu-schedules', requireAdmin, (req, res) => {
  const { subtest_label, scheduled_date, topic, notes } = req.body || {};
  if (!subtest_label || !scheduled_date) {
    res.status(400).json({ error: 'Subtest dan tanggal jadwal wajib diisi.' });
    return;
  }
  const info = db
    .prepare('INSERT INTO dwu_schedules (subtest_label, scheduled_date, topic, notes, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(subtest_label, scheduled_date, topic || '', notes || '', new Date().toISOString());
  res.status(201).json({ id: info.lastInsertRowid });
});

adminRouter.delete('/dwu-schedules/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM dwu_schedules WHERE id = ?').run(Number(req.params.id));
  res.json({ deleted: true });
});

// ==========================================
// LIBRARY LINKS CRUD
// ==========================================
adminRouter.post('/library', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { title, description, category, subtest, drive_url } = req.body || {};
  if (!title || !subtest || !drive_url) {
    res.status(400).json({ error: 'Judul, subtest, dan link Google Drive wajib diisi.' });
    return;
  }
  const info = db
    .prepare(
      'INSERT INTO library_links (title, description, category, subtest, drive_url, thumbnail_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
    )
    .run(title, description || '', category || 'Materi', subtest, drive_url, req.user!.id, new Date().toISOString());
  res.status(201).json({ id: info.lastInsertRowid });
});

adminRouter.delete('/library/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM library_links WHERE id = ?').run(Number(req.params.id));
  res.json({ deleted: true });
});

// ==========================================
// QUESTION REPORTS REVIEW & APPROVAL
// ==========================================
adminRouter.patch('/reports/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  const adminNote = String(req.body?.admin_note || '').trim();

  if (!['pending', 'reviewing', 'approved', 'rejected', 'resolved'].includes(status)) {
    res.status(400).json({ error: 'Status laporan tidak valid.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare('UPDATE question_reports SET status = ?, admin_note = ?, reviewed_by = ?, updated_at = ? WHERE id = ?').run(
    status,
    adminNote || null,
    req.user!.id,
    nowIso,
    id
  );

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    req.user!.id,
    'report_reviewed',
    `Laporan #${id} diubah menjadi status ${status}`,
    nowIso
  );

  res.json({ updated: true, status });
});

// ==========================================
// THEME & SCORING SETTINGS
// ==========================================
adminRouter.put('/settings/theme', requireAdmin, (req, res) => {
  const { primaryColor, secondaryColor, accentColor, quoteText, quoteAuthor } = req.body || {};
  const payload = {
    primaryColor: /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#0757B8',
    secondaryColor: /^#[0-9A-Fa-f]{6}$/.test(secondaryColor) ? secondaryColor : '#0D4FA8',
    accentColor: /^#[0-9A-Fa-f]{6}$/.test(accentColor) ? accentColor : '#D5BF50',
    quoteText: String(quoteText || 'They got a head start. You’re getting a stronger finish'),
    quoteAuthor: String(quoteAuthor || 'S'),
  };
  db.prepare(
    'INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('theme', JSON.stringify(payload), new Date().toISOString());
  res.json(payload);
});

adminRouter.put('/settings/scoring', requireSuperAdmin, (req, res) => {
  const baseScore = Math.max(0, Math.min(500, Number(req.body?.baseScore ?? 300)));
  const maxScore = Math.max(baseScore + 100, Math.min(1000, Number(req.body?.maxScore ?? 1000)));
  const wrongPenalty = Math.max(0, Math.min(1, Number(req.body?.wrongPenalty ?? 0)));
  const payload = {
    baseScore,
    maxScore,
    wrongPenalty,
    label: String(req.body?.label || `Skala Komunitas (${baseScore}–${maxScore})`),
  };
  db.prepare(
    'INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('scoring_config', JSON.stringify(payload), new Date().toISOString());
  res.json(payload);
});

// ==========================================
// GLOBAL SITE ASSETS MANAGEMENT (STRICTLY SUPER ADMIN ONLY!)
// ==========================================
adminRouter.get('/site-assets', requireSuperAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM site_assets ORDER BY category ASC, slot_key ASC').all();
  res.json(rows);
});

adminRouter.post('/site-assets/:slotKey/upload', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slotKey = String(req.params.slotKey || '');
  const targetDevice = req.body?.device === 'mobile' ? 'mobile' : 'desktop';
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey) as
    | Record<string, unknown>
    | undefined;

  if (!asset) {
    res.status(404).json({ error: 'Slot gambar global tidak ditemukan.' });
    return;
  }

  try {
    const newUrl = saveBase64Image(`site_${slotKey}_${targetDevice}`, String(req.body?.data_url || ''));
    const nowIso = new Date().toISOString();

    if (targetDevice === 'mobile') {
      db.prepare('UPDATE site_assets SET mobile_url = ?, updated_at = ?, updated_by = ? WHERE slot_key = ?').run(
        newUrl,
        nowIso,
        req.user!.id,
        slotKey
      );
    } else {
      const prevUrl = String(asset.desktop_url || '');
      db.prepare(
        'UPDATE site_assets SET previous_url = ?, desktop_url = ?, updated_at = ?, updated_by = ? WHERE slot_key = ?'
      ).run(prevUrl, newUrl, nowIso, req.user!.id, slotKey);
    }

    syncSiteAssetsToLegacySettings();
    const updated = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey);
    res.json({ asset: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengunggah aset gambar.' });
  }
});

adminRouter.patch('/site-assets/:slotKey', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slotKey = String(req.params.slotKey || '');
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey) as
    | Record<string, unknown>
    | undefined;

  if (!asset) {
    res.status(404).json({ error: 'Slot gambar global tidak ditemukan.' });
    return;
  }

  const { alt_text, object_fit, object_position, alignment, aspect_ratio, desktop_url, mobile_url } = req.body || {};
  const validFits = ['cover', 'contain', 'fill', 'scale-down'];
  const validAligns = ['left', 'center', 'right'];
  const nowIso = new Date().toISOString();

  const nextDesktopUrl = typeof desktop_url === 'string' ? desktop_url.trim() : String(asset.desktop_url || '');
  const previousUrl =
    typeof desktop_url === 'string' && nextDesktopUrl !== String(asset.desktop_url || '')
      ? String(asset.desktop_url || '')
      : String(asset.previous_url || '');

  db.prepare(
    `UPDATE site_assets
     SET alt_text = ?, object_fit = ?, object_position = ?, alignment = ?, aspect_ratio = ?, desktop_url = ?, previous_url = ?, mobile_url = ?, updated_at = ?, updated_by = ?
     WHERE slot_key = ?`
  ).run(
    typeof alt_text === 'string' ? alt_text.trim() : String(asset.alt_text || ''),
    validFits.includes(String(object_fit)) ? String(object_fit) : String(asset.object_fit || 'cover'),
    typeof object_position === 'string' && object_position.trim() ? object_position.trim() : String(asset.object_position || 'center'),
    validAligns.includes(String(alignment)) ? String(alignment) : String(asset.alignment || 'center'),
    typeof aspect_ratio === 'string' && aspect_ratio.trim() ? aspect_ratio.trim() : String(asset.aspect_ratio || 'auto'),
    nextDesktopUrl,
    previousUrl,
    typeof mobile_url === 'string' ? mobile_url.trim() : String(asset.mobile_url || ''),
    nowIso,
    req.user!.id,
    slotKey
  );

  syncSiteAssetsToLegacySettings();
  const updated = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey);
  res.json({ asset: updated });
});

adminRouter.post('/site-assets/:slotKey/rollback', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slotKey = String(req.params.slotKey || '');
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey) as
    | Record<string, unknown>
    | undefined;

  if (!asset) {
    res.status(404).json({ error: 'Slot gambar global tidak ditemukan.' });
    return;
  }

  const prevUrl = String(asset.previous_url || '');
  if (!prevUrl) {
    res.status(400).json({ error: 'Tidak ada gambar versi sebelumnya untuk dikembalikan.' });
    return;
  }

  const currentUrl = String(asset.desktop_url || '');
  const nowIso = new Date().toISOString();
  db.prepare(
    'UPDATE site_assets SET desktop_url = ?, previous_url = ?, updated_at = ?, updated_by = ? WHERE slot_key = ?'
  ).run(prevUrl, currentUrl, nowIso, req.user!.id, slotKey);

  syncSiteAssetsToLegacySettings();
  const updated = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey);
  res.json({ asset: updated });
});

adminRouter.delete('/site-assets/:slotKey', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slotKey = String(req.params.slotKey || '');
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey) as
    | Record<string, unknown>
    | undefined;

  if (!asset) {
    res.status(404).json({ error: 'Slot gambar global tidak ditemukan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    "UPDATE site_assets SET previous_url = desktop_url, desktop_url = default_url, mobile_url = '', updated_at = ?, updated_by = ? WHERE slot_key = ?"
  ).run(nowIso, req.user!.id, slotKey);

  syncSiteAssetsToLegacySettings();
  const updated = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slotKey);
  res.json({ asset: updated });
});

// Legacy site asset endpoints also restricted to SUPER ADMIN ONLY (strict RBAC!)
adminRouter.post('/settings/assets/upload', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slot = String(req.body?.slot || '');
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slot) as
    | Record<string, unknown>
    | undefined;
  if (!asset) {
    res.status(400).json({ error: 'Slot aset tidak valid.' });
    return;
  }

  try {
    const url = saveBase64Image(slot, String(req.body?.data_url || ''));
    db.prepare('UPDATE site_assets SET previous_url = desktop_url, desktop_url = ?, updated_at = ?, updated_by = ? WHERE slot_key = ?').run(
      url,
      new Date().toISOString(),
      req.user!.id,
      slot
    );
    syncSiteAssetsToLegacySettings();
    const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'visual_assets'").get() as { value_json: string };
    res.json({ slot, url, visualAssets: JSON.parse(row.value_json) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengunggah aset.' });
  }
});

adminRouter.delete('/settings/assets/:slot', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const slot = String(req.params.slot || '');
  const asset = db.prepare('SELECT * FROM site_assets WHERE slot_key = ?').get(slot) as
    | Record<string, unknown>
    | undefined;
  if (!asset) {
    res.status(400).json({ error: 'Slot aset tidak ditemukan.' });
    return;
  }

  db.prepare("UPDATE site_assets SET previous_url = desktop_url, desktop_url = default_url, mobile_url = '', updated_at = ?, updated_by = ? WHERE slot_key = ?").run(
    new Date().toISOString(),
    req.user!.id,
    slot
  );
  syncSiteAssetsToLegacySettings();
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'visual_assets'").get() as { value_json: string };
  const visualAssets = JSON.parse(row.value_json);
  res.json({ slot, url: visualAssets[slot], visualAssets });
});
