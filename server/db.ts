import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { normalizeQuestionHash } from '../src/lib/utbkLogic';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const PDF_UPLOADS_DIR = path.join(UPLOADS_DIR, 'pdfs');
export const QUESTION_ASSETS_DIR = path.join(UPLOADS_DIR, 'question_assets');
export const PDF_PAGES_DIR = path.join(UPLOADS_DIR, 'pdf_pages');

for (const dir of [DATA_DIR, UPLOADS_DIR, PDF_UPLOADS_DIR, QUESTION_ASSETS_DIR, PDF_PAGES_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const db = new Database(path.join(DATA_DIR, 'utbk.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

function getTableColumns(tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
  const cols = getTableColumns(tableName);
  if (!cols.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function tableReferencesQuestionsFk(tableName: string): boolean {
  const fks = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{ table: string }>;
  return fks.some((fk) => fk.table === 'questions');
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('super_admin', 'admin', 'user')),
      target_score INTEGER NOT NULL DEFAULT 760,
      token_version INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_code TEXT NOT NULL,
      subtest TEXT NOT NULL,
      topic TEXT NOT NULL,
      subtopic TEXT NOT NULL DEFAULT '',
      upload_mode TEXT NOT NULL DEFAULT 'manual',
      source_batch_id INTEGER,
      question_number INTEGER,
      has_visual INTEGER NOT NULL DEFAULT 0,
      visual_description TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_note TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
      question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK(question_type IN ('single_choice', 'multiple_choice')),
      question_text TEXT NOT NULL,
      image_url TEXT,
      options_json TEXT NOT NULL,
      correct_answer_json TEXT NOT NULL,
      explanation_text TEXT NOT NULL DEFAULT '',
      solution_text TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tryout_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT,
      is_published INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tryout_subtests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tryout_packages(id) ON DELETE CASCADE,
      subtest_code TEXT NOT NULL,
      subtest_name TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 900,
      sort_order INTEGER NOT NULL DEFAULT 0,
      question_ids_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tryout_subtests_pkg ON tryout_subtests(package_id, sort_order);

    CREATE TABLE IF NOT EXISTS tryout_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL REFERENCES tryout_packages(id) ON DELETE CASCADE,
      subtest_id INTEGER NOT NULL REFERENCES tryout_subtests(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL DEFAULT 1,
      external_code TEXT NOT NULL,
      subtest TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'Umum',
      difficulty TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
      question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK(question_type IN ('single_choice', 'multiple_choice')),
      question_text TEXT NOT NULL,
      image_url TEXT,
      has_visual INTEGER NOT NULL DEFAULT 0,
      visual_description TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL,
      correct_answer_json TEXT NOT NULL,
      explanation_text TEXT NOT NULL DEFAULT '',
      solution_text TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tryout_questions_pkg_sub ON tryout_questions(package_id, subtest_id, question_number);

    CREATE TABLE IF NOT EXISTS tryout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id INTEGER NOT NULL REFERENCES tryout_packages(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('simulation', 'staged')),
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'between_subtests', 'completed')),
      current_subtest_index INTEGER NOT NULL DEFAULT 0,
      subtest_started_at TEXT,
      subtest_states_json TEXT NOT NULL DEFAULT '{}',
      active_duration_seconds INTEGER NOT NULL DEFAULT 0,
      raw_correct INTEGER NOT NULL DEFAULT 0,
      raw_wrong INTEGER NOT NULL DEFAULT 0,
      raw_blank INTEGER NOT NULL DEFAULT 0,
      utbk_score INTEGER,
      subtest_scores_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tryout_sessions_user_pkg ON tryout_sessions(user_id, package_id, status);

    CREATE TABLE IF NOT EXISTS tryout_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES tryout_sessions(id) ON DELETE CASCADE,
      subtest_id INTEGER NOT NULL REFERENCES tryout_subtests(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES tryout_questions(id) ON DELETE CASCADE,
      selected_json TEXT NOT NULL DEFAULT '[]',
      is_ragu INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, subtest_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS drill_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subtest TEXT NOT NULL,
      topic TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'topic',
      show_instant_explanation INTEGER NOT NULL DEFAULT 1,
      question_ids_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS drill_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES drill_sessions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      selected_json TEXT NOT NULL DEFAULT '[]',
      is_correct INTEGER NOT NULL DEFAULT 0,
      is_ragu INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT NOT NULL,
      UNIQUE(session_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS user_question_mastery (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
      question_id INTEGER NOT NULL,
      is_ragu_active INTEGER NOT NULL DEFAULT 0,
      was_ever_ragu INTEGER NOT NULL DEFAULT 0,
      ragu_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'learned' CHECK(status IN ('ragu', 'learned', 'understood')),
      last_studied_at TEXT,
      understood_at TEXT,
      PRIMARY KEY (user_id, source_type, question_id)
    );

    CREATE TABLE IF NOT EXISTS user_question_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
      question_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      subtest TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started', 'ongoing', 'done')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Materi',
      subtest TEXT NOT NULL,
      drive_url TEXT NOT NULL,
      thumbnail_url TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dwu_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subtest_label TEXT NOT NULL,
      scheduled_date TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dwu_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK(direction IN ('member_to_tutor', 'tutor_to_member')),
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subtest TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      ratings_json TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      weak_topics_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewing', 'approved', 'rejected', 'resolved')),
      admin_note TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS countdown_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      target_iso TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pdf_import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('drill', 'tryout')),
      upload_mode TEXT NOT NULL DEFAULT 'random' CHECK(upload_mode IN ('by_topic', 'random', 'tryout')),
      default_subtest TEXT NOT NULL DEFAULT 'Penalaran Umum',
      default_topic TEXT NOT NULL DEFAULT '',
      default_subtopic TEXT NOT NULL DEFAULT '',
      package_title TEXT NOT NULL DEFAULT '',
      package_provider TEXT NOT NULL DEFAULT '',
      package_description TEXT NOT NULL DEFAULT '',
      files_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'preview_ready', 'completed', 'failed')),
      total_pages INTEGER NOT NULL DEFAULT 0,
      processed_chunks INTEGER NOT NULL DEFAULT 0,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      draft_questions_json TEXT NOT NULL DEFAULT '[]',
      draft_subtests_json TEXT NOT NULL DEFAULT '[]',
      page_images_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('drill', 'tryout')),
      question_id INTEGER NOT NULL,
      asset_url TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'cropped',
      display_order INTEGER NOT NULL DEFAULT 0,
      source_page INTEGER,
      crop_box_json TEXT,
      is_shared INTEGER NOT NULL DEFAULT 0,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_question_assets_lookup ON question_assets(source_type, question_id, display_order);

    CREATE TABLE IF NOT EXISTS tryout_carousel_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER REFERENCES tryout_packages(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      status_label TEXT NOT NULL DEFAULT 'Tersedia',
      package_label TEXT NOT NULL DEFAULT 'Try Out UTBK',
      cta_label TEXT NOT NULL DEFAULT 'Mulai Try Out',
      cta_target TEXT NOT NULL DEFAULT 'tryout',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_assets (
      slot_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      page_location TEXT NOT NULL,
      desktop_url TEXT NOT NULL,
      mobile_url TEXT NOT NULL DEFAULT '',
      previous_url TEXT NOT NULL DEFAULT '',
      default_url TEXT NOT NULL,
      alt_text TEXT NOT NULL DEFAULT '',
      object_fit TEXT NOT NULL DEFAULT 'cover',
      object_position TEXT NOT NULL DEFAULT 'center',
      alignment TEXT NOT NULL DEFAULT 'center',
      aspect_ratio TEXT NOT NULL DEFAULT 'auto',
      updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS question_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('drill', 'tryout')),
      question_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      changed_by_username TEXT NOT NULL DEFAULT 'System',
      changed_by_role TEXT NOT NULL DEFAULT 'system',
      changed_at TEXT NOT NULL,
      changed_fields_json TEXT NOT NULL DEFAULT '[]',
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      change_reason TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_question_versions_lookup ON question_versions(source_type, question_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS study_time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      study_date TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0 AND duration_minutes <= 1440),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_study_time_user_date ON study_time_logs(user_id, study_date DESC);

    CREATE TABLE IF NOT EXISTS ai_providers (
      provider_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      is_fallback INTEGER NOT NULL DEFAULT 0,
      model_name TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL DEFAULT '',
      key_hint TEXT NOT NULL DEFAULT '',
      last_status TEXT NOT NULL DEFAULT 'untested',
      last_tested_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      total_requests INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_key TEXT NOT NULL,
      model_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error', 'repaired')),
      used_fallback INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_request_logs_created ON ai_request_logs(created_at DESC);
  `);

  // Safe non-destructive upgrades for pre-existing databases
  addColumnIfMissing('questions', 'subtopic', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('questions', 'upload_mode', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing('questions', 'source_batch_id', 'INTEGER');
  addColumnIfMissing('questions', 'question_number', 'INTEGER');
  addColumnIfMissing('questions', 'has_visual', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('questions', 'visual_description', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('questions', 'needs_review', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('questions', 'review_note', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('questions', 'is_published', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('questions', 'content_hash', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('questions', 'review_status', "TEXT NOT NULL DEFAULT 'pending_review'");
  addColumnIfMissing('questions', 'input_source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing('questions', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('questions', 'audit_checklist_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('questions', 'reviewer_notes', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('questions', 'last_reviewed_by', 'INTEGER');
  addColumnIfMissing('questions', 'last_reviewed_at', 'TEXT');
  addColumnIfMissing('questions', 'updated_at', 'TEXT');

  addColumnIfMissing('tryout_questions', 'subtopic', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('tryout_questions', 'review_status', "TEXT NOT NULL DEFAULT 'pending_review'");
  addColumnIfMissing('tryout_questions', 'input_source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing('tryout_questions', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('tryout_questions', 'audit_checklist_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('tryout_questions', 'reviewer_notes', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing('tryout_questions', 'last_reviewed_by', 'INTEGER');
  addColumnIfMissing('tryout_questions', 'last_reviewed_at', 'TEXT');
  addColumnIfMissing('tryout_questions', 'updated_at', 'TEXT');

  addColumnIfMissing('tryout_sessions', 'question_snapshots_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('tryout_sessions', 'impact_flag_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing('drill_sessions', 'question_snapshots_json', "TEXT NOT NULL DEFAULT '{}'");

  addColumnIfMissing('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'profile_visible', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('users', 'show_tryout_stats', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('users', 'show_study_time', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'show_subtest_mastery', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('users', 'show_target_score', 'INTEGER NOT NULL DEFAULT 0');

  addColumnIfMissing('pdf_import_jobs', 'page_images_json', "TEXT NOT NULL DEFAULT '[]'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_questions_subtest_topic ON questions(subtest, topic, subtopic);
    CREATE INDEX IF NOT EXISTS idx_questions_hash ON questions(content_hash);
    CREATE INDEX IF NOT EXISTS idx_questions_review_status ON questions(review_status, is_published);
    CREATE INDEX IF NOT EXISTS idx_tryout_questions_review_status ON tryout_questions(review_status);
  `);

  const nowIso = new Date().toISOString();

  // Backfill pre-revision questions once (only where updated_at IS NULL) without altering new pending_review rows
  db.prepare(
    `UPDATE questions
     SET review_status = CASE WHEN is_published = 1 AND needs_review = 0 THEN 'approved' ELSE 'pending_review' END,
         input_source = CASE WHEN upload_mode = 'manual' THEN 'manual' ELSE 'ai_pdf' END,
         updated_at = COALESCE(created_at, ?)
     WHERE updated_at IS NULL`
  ).run(nowIso);

  db.prepare(
    `UPDATE tryout_questions
     SET review_status = CASE WHEN needs_review = 0 THEN 'approved' ELSE 'pending_review' END,
         input_source = CASE WHEN external_code LIKE 'TO-%' THEN 'json' ELSE 'ai_pdf' END,
         updated_at = COALESCE(created_at, ?)
     WHERE updated_at IS NULL`
  ).run(nowIso);

  // Seed default AI provider rows idempotently
  const seedProvider = db.prepare(
    `INSERT OR IGNORE INTO ai_providers
     (provider_key, display_name, is_enabled, is_primary, is_fallback, model_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  seedProvider.run('gemini', 'Google Gemini', 1, 1, 0, 'gemini-4-hydrogen', nowIso);
  seedProvider.run('openai', 'OpenAI', 0, 0, 1, 'gpt-4.1-mini', nowIso);

  // Backfill content_hash for existing questions
  const missingHashes = db
    .prepare("SELECT id, question_text FROM questions WHERE content_hash = '' OR content_hash IS NULL")
    .all() as Array<{ id: number; question_text: string }>;
  if (missingHashes.length > 0) {
    const upd = db.prepare('UPDATE questions SET content_hash = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const row of missingHashes) {
        upd.run(normalizeQuestionHash(row.question_text), row.id);
      }
    });
    tx();
  }

  // Migrate legacy tryout_answers / mastery / reports that still hold FK to questions(id)
  migrateLegacyTryoutIsolation();

  // Backfill legacy single image_url entries into question_assets
  backfillLegacyQuestionAssets();
}

export interface StoredQuestionAsset {
  id: number;
  source_type: 'drill' | 'tryout';
  question_id: number;
  asset_url: string;
  asset_type: 'embedded' | 'cropped' | 'manual' | 'shared';
  display_order: number;
  source_page: number | null;
  crop_box: [number, number, number, number] | null;
  is_shared: boolean;
  caption: string;
}

export function getQuestionAssets(sourceType: 'drill' | 'tryout', questionId: number): StoredQuestionAsset[] {
  const rows = db
    .prepare(
      'SELECT * FROM question_assets WHERE source_type = ? AND question_id = ? ORDER BY display_order ASC, id ASC'
    )
    .all(sourceType, questionId) as Array<Record<string, unknown>>;

  return rows.map((r) => {
    let cropBox: [number, number, number, number] | null = null;
    if (r.crop_box_json) {
      try {
        const parsed = JSON.parse(String(r.crop_box_json));
        if (Array.isArray(parsed) && parsed.length === 4) {
          cropBox = [Number(parsed[0]), Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
        }
      } catch {
        cropBox = null;
      }
    }
    return {
      id: Number(r.id),
      source_type: sourceType,
      question_id: Number(r.question_id),
      asset_url: String(r.asset_url),
      asset_type: (String(r.asset_type || 'cropped') as StoredQuestionAsset['asset_type']),
      display_order: Number(r.display_order || 0),
      source_page: r.source_page != null ? Number(r.source_page) : null,
      crop_box: cropBox,
      is_shared: Boolean(r.is_shared),
      caption: String(r.caption || ''),
    };
  });
}

export function getQuestionAssetsMap(
  sourceType: 'drill' | 'tryout',
  questionIds: number[]
): Map<number, StoredQuestionAsset[]> {
  const map = new Map<number, StoredQuestionAsset[]>();
  if (questionIds.length === 0) return map;
  const placeholders = questionIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM question_assets WHERE source_type = ? AND question_id IN (${placeholders}) ORDER BY display_order ASC, id ASC`
    )
    .all(sourceType, ...questionIds) as Array<Record<string, unknown>>;

  for (const r of rows) {
    const qid = Number(r.question_id);
    if (!map.has(qid)) map.set(qid, []);
    let cropBox: [number, number, number, number] | null = null;
    if (r.crop_box_json) {
      try {
        const parsed = JSON.parse(String(r.crop_box_json));
        if (Array.isArray(parsed) && parsed.length === 4) {
          cropBox = [Number(parsed[0]), Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
        }
      } catch {
        cropBox = null;
      }
    }
    map.get(qid)!.push({
      id: Number(r.id),
      source_type: sourceType,
      question_id: qid,
      asset_url: String(r.asset_url),
      asset_type: (String(r.asset_type || 'cropped') as StoredQuestionAsset['asset_type']),
      display_order: Number(r.display_order || 0),
      source_page: r.source_page != null ? Number(r.source_page) : null,
      crop_box: cropBox,
      is_shared: Boolean(r.is_shared),
      caption: String(r.caption || ''),
    });
  }
  return map;
}

export function replaceQuestionAssets(
  sourceType: 'drill' | 'tryout',
  questionId: number,
  assets: Array<{
    asset_url: string;
    asset_type?: string;
    display_order?: number;
    source_page?: number | null;
    crop_box?: [number, number, number, number] | null;
    is_shared?: boolean;
    caption?: string;
  }>
): void {
  const nowIso = new Date().toISOString();
  db.prepare('DELETE FROM question_assets WHERE source_type = ? AND question_id = ?').run(sourceType, questionId);
  const insert = db.prepare(
    `INSERT INTO question_assets (source_type, question_id, asset_url, asset_type, display_order, source_page, crop_box_json, is_shared, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const cleanList = assets.filter((a) => a.asset_url && a.asset_url.trim().length > 0);
  cleanList.forEach((asset, idx) => {
    insert.run(
      sourceType,
      questionId,
      asset.asset_url.trim(),
      asset.asset_type || 'cropped',
      idx,
      asset.source_page ?? null,
      asset.crop_box ? JSON.stringify(asset.crop_box) : null,
      asset.is_shared ? 1 : 0,
      asset.caption || '',
      nowIso
    );
  });
  const primaryUrl = cleanList[0]?.asset_url?.trim() || null;
  if (sourceType === 'drill') {
    db.prepare('UPDATE questions SET image_url = ?, has_visual = CASE WHEN ? IS NOT NULL THEN 1 ELSE has_visual END WHERE id = ?').run(
      primaryUrl,
      primaryUrl,
      questionId
    );
  } else {
    db.prepare('UPDATE tryout_questions SET image_url = ?, has_visual = CASE WHEN ? IS NOT NULL THEN 1 ELSE has_visual END WHERE id = ?').run(
      primaryUrl,
      primaryUrl,
      questionId
    );
  }
}

function backfillLegacyQuestionAssets(): void {
  const nowIso = new Date().toISOString();
  const drillRows = db
    .prepare(
      `SELECT q.id, q.image_url FROM questions q
       WHERE q.image_url IS NOT NULL AND q.image_url != ''
       AND NOT EXISTS (SELECT 1 FROM question_assets qa WHERE qa.source_type = 'drill' AND qa.question_id = q.id)`
    )
    .all() as Array<{ id: number; image_url: string }>;

  const tryoutRows = db
    .prepare(
      `SELECT tq.id, tq.image_url FROM tryout_questions tq
       WHERE tq.image_url IS NOT NULL AND tq.image_url != ''
       AND NOT EXISTS (SELECT 1 FROM question_assets qa WHERE qa.source_type = 'tryout' AND qa.question_id = tq.id)`
    )
    .all() as Array<{ id: number; image_url: string }>;

  if (drillRows.length === 0 && tryoutRows.length === 0) return;

  const ins = db.prepare(
    `INSERT INTO question_assets (source_type, question_id, asset_url, asset_type, display_order, source_page, crop_box_json, is_shared, caption, created_at)
     VALUES (?, ?, ?, 'manual', 0, NULL, NULL, 0, '', ?)`
  );
  const tx = db.transaction(() => {
    for (const r of drillRows) ins.run('drill', r.id, r.image_url, nowIso);
    for (const r of tryoutRows) ins.run('tryout', r.id, r.image_url, nowIso);
  });
  tx();
}

function migrateLegacyTryoutIsolation(): void {
  const needsAnswersRebuild = tableReferencesQuestionsFk('tryout_answers');
  const needsMasteryRebuild = !getTableColumns('user_question_mastery').has('source_type');
  const needsHistoryRebuild = !getTableColumns('user_question_history').has('source_type');
  const needsReportsRebuild = !getTableColumns('question_reports').has('source_type');

  const existingToQCount = (db.prepare('SELECT COUNT(*) as c FROM tryout_questions').get() as { c: number }).c;
  const existingSubtestCount = (db.prepare('SELECT COUNT(*) as c FROM tryout_subtests').get() as { c: number }).c;
  const shouldCopyLegacySubtestQuestions = existingToQCount === 0 && existingSubtestCount > 0;

  if (
    !needsAnswersRebuild &&
    !needsMasteryRebuild &&
    !needsHistoryRebuild &&
    !needsReportsRebuild &&
    !shouldCopyLegacySubtestQuestions
  ) {
    return;
  }

  db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      // Map (subtest_id, old_question_id) -> new tryout_question_id
      const idMapping = new Map<string, number>();

      if (shouldCopyLegacySubtestQuestions) {
        const subtests = db
          .prepare('SELECT id, package_id, subtest_name, question_ids_json FROM tryout_subtests ORDER BY id ASC')
          .all() as Array<{ id: number; package_id: number; subtest_name: string; question_ids_json: string }>;

        const insertToQ = db.prepare(
          `INSERT INTO tryout_questions (package_id, subtest_id, question_number, external_code, subtest, topic, difficulty, question_type, question_text, image_url, has_visual, visual_description, options_json, correct_answer_json, explanation_text, solution_text, needs_review, review_note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, 0, '', ?)`
        );
        const updSubtest = db.prepare('UPDATE tryout_subtests SET question_ids_json = ? WHERE id = ?');

        for (const st of subtests) {
          const oldIds = JSON.parse(st.question_ids_json || '[]') as number[];
          const newIds: number[] = [];
          oldIds.forEach((oldId, idx) => {
            const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(oldId) as Record<string, unknown> | undefined;
            if (!q) return;
            const newId = Number(
              insertToQ.run(
                st.package_id,
                st.id,
                idx + 1,
                `TO-${q.external_code}`,
                st.subtest_name,
                q.topic,
                q.difficulty,
                q.question_type,
                q.question_text,
                q.image_url,
                q.options_json,
                q.correct_answer_json,
                q.explanation_text,
                q.solution_text,
                q.created_at || new Date().toISOString()
              ).lastInsertRowid
            );
            newIds.push(newId);
            idMapping.set(`${st.id}:${oldId}`, newId);
          });
          updSubtest.run(JSON.stringify(newIds), st.id);
        }
      }

      if (needsAnswersRebuild) {
        db.exec(`
          CREATE TABLE tryout_answers_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES tryout_sessions(id) ON DELETE CASCADE,
            subtest_id INTEGER NOT NULL REFERENCES tryout_subtests(id) ON DELETE CASCADE,
            question_id INTEGER NOT NULL REFERENCES tryout_questions(id) ON DELETE CASCADE,
            selected_json TEXT NOT NULL DEFAULT '[]',
            is_ragu INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            UNIQUE(session_id, subtest_id, question_id)
          );
        `);
        const oldAns = db
          .prepare('SELECT id, session_id, subtest_id, question_id, selected_json, is_ragu, updated_at FROM tryout_answers')
          .all() as Array<{
          id: number;
          session_id: number;
          subtest_id: number;
          question_id: number;
          selected_json: string;
          is_ragu: number;
          updated_at: string;
        }>;
        const insAns = db.prepare(
          'INSERT OR IGNORE INTO tryout_answers_new (session_id, subtest_id, question_id, selected_json, is_ragu, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const a of oldAns) {
          const mappedId = idMapping.get(`${a.subtest_id}:${a.question_id}`) || a.question_id;
          insAns.run(a.session_id, a.subtest_id, mappedId, a.selected_json, a.is_ragu, a.updated_at);
        }
        db.exec('DROP TABLE tryout_answers; ALTER TABLE tryout_answers_new RENAME TO tryout_answers;');
      }

      if (needsMasteryRebuild) {
        db.exec(`
          CREATE TABLE user_question_mastery_new (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
            question_id INTEGER NOT NULL,
            is_ragu_active INTEGER NOT NULL DEFAULT 0,
            was_ever_ragu INTEGER NOT NULL DEFAULT 0,
            ragu_count INTEGER NOT NULL DEFAULT 0,
            correct_count INTEGER NOT NULL DEFAULT 0,
            wrong_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'learned' CHECK(status IN ('ragu', 'learned', 'understood')),
            last_studied_at TEXT,
            understood_at TEXT,
            PRIMARY KEY (user_id, source_type, question_id)
          );
          INSERT INTO user_question_mastery_new (user_id, source_type, question_id, is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, last_studied_at, understood_at)
          SELECT user_id, 'drill', question_id, is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, last_studied_at, understood_at FROM user_question_mastery;
          DROP TABLE user_question_mastery;
          ALTER TABLE user_question_mastery_new RENAME TO user_question_mastery;
        `);
      }

      if (needsHistoryRebuild) {
        db.exec(`
          CREATE TABLE user_question_history_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
            question_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          INSERT INTO user_question_history_new (id, user_id, source_type, question_id, action, source, created_at)
          SELECT id, user_id, 'drill', question_id, action, source, created_at FROM user_question_history;
          DROP TABLE user_question_history;
          ALTER TABLE user_question_history_new RENAME TO user_question_history;
        `);
      }

      if (needsReportsRebuild) {
        db.exec(`
          CREATE TABLE question_reports_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'drill' CHECK(source_type IN ('drill', 'tryout')),
            reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issue_type TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewing', 'approved', 'rejected', 'resolved')),
            admin_note TEXT,
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO question_reports_new (id, question_id, source_type, reporter_id, issue_type, description, status, admin_note, reviewed_by, created_at, updated_at)
          SELECT id, question_id, 'drill', reporter_id, issue_type, description, status, admin_note, reviewed_by, created_at, updated_at FROM question_reports;
          DROP TABLE question_reports;
          ALTER TABLE question_reports_new RENAME TO question_reports;
        `);
      }
    });
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function buildQuestionSnapshot(
  sourceType: 'drill' | 'tryout',
  row: Record<string, unknown>,
  assets?: StoredQuestionAsset[]
): Record<string, unknown> {
  const safeParse = (raw: unknown, fallback: unknown) => {
    try {
      return JSON.parse(String(raw || '')) || fallback;
    } catch {
      return fallback;
    }
  };
  return {
    id: Number(row.id),
    source_type: sourceType,
    external_code: String(row.external_code || ''),
    subtest: String(row.subtest || ''),
    topic: String(row.topic || 'Umum'),
    subtopic: String(row.subtopic || ''),
    difficulty: String(row.difficulty || 'medium'),
    question_type: String(row.question_type || 'single_choice'),
    question_text: String(row.question_text || ''),
    image_url: row.image_url ? String(row.image_url) : null,
    assets: assets ?? getQuestionAssets(sourceType, Number(row.id)),
    options: safeParse(row.options_json, []),
    correct_answer: safeParse(row.correct_answer_json, []),
    explanation_text: String(row.explanation_text || ''),
    solution_text: String(row.solution_text || ''),
    visual_description: String(row.visual_description || ''),
    review_status: String(row.review_status || 'pending_review'),
    version: Number(row.version || 1),
  };
}

export function recordQuestionVersion(params: {
  sourceType: 'drill' | 'tryout';
  questionId: number;
  versionNumber: number;
  changedBy?: number | null;
  changedByUsername?: string;
  changedByRole?: string;
  changedFields: string[];
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  changeReason?: string;
}): void {
  db.prepare(
    `INSERT INTO question_versions
     (source_type, question_id, version_number, changed_by, changed_by_username, changed_by_role, changed_at, changed_fields_json, before_json, after_json, change_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.sourceType,
    params.questionId,
    params.versionNumber,
    params.changedBy ?? null,
    params.changedByUsername || 'System',
    params.changedByRole || 'system',
    new Date().toISOString(),
    JSON.stringify(params.changedFields),
    JSON.stringify(params.beforeSnapshot),
    JSON.stringify(params.afterSnapshot),
    params.changeReason || ''
  );
}

export function getQuestionUsageCount(sourceType: 'drill' | 'tryout', questionId: number): number {
  if (sourceType === 'tryout') {
    const row = db
      .prepare('SELECT COUNT(DISTINCT session_id) as c FROM tryout_answers WHERE question_id = ?')
      .get(questionId) as { c: number } | undefined;
    return Number(row?.c || 0);
  }
  const row = db
    .prepare('SELECT COUNT(DISTINCT session_id) as c FROM drill_answers WHERE question_id = ?')
    .get(questionId) as { c: number } | undefined;
  return Number(row?.c || 0);
}

