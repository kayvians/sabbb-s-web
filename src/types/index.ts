export type UserRole = 'super_admin' | 'admin' | 'user';
export type UploadMode = 'by_topic' | 'random' | 'manual';
export type ReviewStatus = 'pending_review' | 'under_review' | 'needs_correction' | 'approved' | 'rejected';
export type InputSource = 'ai_pdf' | 'json' | 'manual';

export interface UserPrivacySettings {
  profile_visible: boolean;
  show_tryout_stats: boolean;
  show_study_time: boolean;
  show_subtest_mastery: boolean;
  show_target_score: boolean;
}

export interface User extends Partial<UserPrivacySettings> {
  id: number;
  discord_id: string;
  username: string;
  avatar_url: string;
  role: UserRole;
  target_score: number;
  joined_at: string;
  last_active_at: string;
}

export interface QuestionOption {
  key: string;
  content: string;
}

export interface QuestionAsset {
  id?: number;
  temp_id?: string;
  source_type?: 'drill' | 'tryout';
  question_id?: number;
  asset_url: string;
  asset_type: 'embedded' | 'cropped' | 'manual' | 'shared';
  display_order: number;
  source_page?: number | null;
  crop_box?: [number, number, number, number] | null;
  is_shared?: boolean;
  caption?: string;
}

export interface AuditChecklistState {
  clear_wording?: boolean;
  valid_subtest?: boolean;
  valid_topic_subtopic?: boolean;
  complete_options?: boolean;
  valid_answer_key?: boolean;
  valid_explanation?: boolean;
  clear_image_crop?: boolean;
  no_duplicate?: boolean;
  valid_latex?: boolean;
  accurate_difficulty?: boolean;
  ready_for_students?: boolean;
}

export interface QuestionVersionRecord {
  id: number;
  source_type: 'drill' | 'tryout';
  question_id: number;
  version_number: number;
  changed_by: number | null;
  changed_by_username: string;
  changed_by_role: string;
  changed_at: string;
  changed_fields: string[];
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  change_reason: string;
}

export interface Question {
  id: number;
  external_code: string;
  subtest: string;
  topic: string;
  subtopic?: string;
  upload_mode?: UploadMode;
  question_number?: number | null;
  has_visual?: boolean;
  visual_description?: string;
  needs_review?: boolean;
  review_note?: string;
  review_status?: ReviewStatus;
  input_source?: InputSource;
  version?: number;
  audit_checklist?: AuditChecklistState;
  reviewer_notes?: string;
  last_reviewed_by?: number | null;
  last_reviewed_at?: string | null;
  usage_count?: number;
  updated_at?: string;
  is_published?: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: 'single_choice' | 'multiple_choice';
  question_text: string;
  image_url: string | null;
  assets?: QuestionAsset[];
  options: QuestionOption[];
  correct_answer?: string[];
  explanation_text?: string;
  solution_text?: string;
  created_at?: string;
}

export interface SessionImpactFlag {
  key_corrected?: boolean;
  updated_at?: string;
  affected_question_codes?: string[];
  note?: string;
}

export interface StudyTimeLog {
  id: number;
  user_id: number;
  study_date: string;
  duration_minutes: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface StudyTimePeriodBucket {
  key: string;
  label: string;
  totalMinutes: number;
  sessionCount: number;
}

export interface StudyTimeSummary {
  view: 'daily' | 'weekly' | 'monthly';
  buckets: StudyTimePeriodBucket[];
  totalAllTimeMinutes: number;
  currentPeriodMinutes: number;
  previousPeriodMinutes: number;
  deltaMinutes: number;
  deltaPercent: number | null;
}

export interface AiProviderConfig {
  provider_key: 'gemini' | 'openai';
  display_name: string;
  is_enabled: boolean;
  is_primary: boolean;
  is_fallback: boolean;
  model_name: string;
  available_models: string[];
  has_key: boolean;
  masked_key: string;
  key_source: 'database' | 'env' | 'none';
  last_status: 'untested' | 'ok' | 'error';
  last_tested_at: string | null;
  last_error: string;
  total_requests: number;
  total_tokens: number;
  estimated_cost_usd: number;
  updated_at: string;
}

export interface AiRequestLog {
  id: number;
  provider_key: string;
  model_name: string;
  operation: string;
  status: 'success' | 'error' | 'repaired';
  used_fallback: boolean;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  error_message: string;
  created_at: string;
}

export interface PublicProfileResponse {
  profileVisible: boolean;
  user: {
    id: number;
    username: string;
    avatar_url: string;
    joined_at?: string;
  };
  privacy: UserPrivacySettings;
  targetScore?: number | null;
  tryoutStats?: {
    completedCount: number;
    bestScore: number | null;
    averageScore: number | null;
    recentScores: Array<{ packageTitle: string; utbkScore: number; completedAt: string }>;
  } | null;
  studyTimeStats?: {
    totalMinutes: number;
    thisWeekMinutes: number;
    sessionsCount: number;
  } | null;
  subtestMastery?: Array<{
    subtest: string;
    total: number;
    understood: number;
    learned: number;
    ragu: number;
    masteryPct: number;
  }> | null;
}

export interface TryoutSubtest {
  id: number;
  package_id: number;
  subtest_code: string;
  subtest_name: string;
  duration_seconds: number;
  sort_order: number;
  question_ids: number[];
}

export interface TryoutPackage {
  id: number;
  title: string;
  provider: string;
  description: string;
  cover_url: string | null;
  is_published: boolean;
  starts_at: string | null;
  ends_at: string | null;
  subtests: TryoutSubtest[];
  user_active_session?: TryoutSessionSummary | null;
  user_best_score?: number | null;
}

export interface TryoutSessionSummary {
  id: number;
  package_id: number;
  mode: 'simulation' | 'staged';
  status: 'in_progress' | 'between_subtests' | 'completed';
  current_subtest_index: number;
  active_duration_seconds: number;
  utbk_score: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface CountdownEvent {
  id: number;
  title: string;
  target_iso: string;
  timezone: string;
  is_active: boolean;
}

export interface ThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  quoteText: string;
  quoteAuthor: string;
}

export interface VisualAssets {
  logo: string;
  landingBanner: string;
  catMascot: string;
  countdownBanner: string;
  defaultPackageCover: string;
  libraryThumbnail: string;
  landingBackground?: string;
  dashboardHeroBanner?: string;
  profileBanner?: string;
}

export type SiteAssetCategory = 'branding' | 'landing' | 'banner' | 'cards' | 'background' | 'library';

export interface SiteAssetConfig {
  slot_key: string;
  label: string;
  category: SiteAssetCategory;
  page_location: string;
  desktop_url: string;
  mobile_url: string;
  previous_url: string;
  default_url: string;
  alt_text: string;
  object_fit: 'cover' | 'contain' | 'fill' | 'scale-down';
  object_position: string;
  alignment: 'left' | 'center' | 'right';
  aspect_ratio: string;
  updated_at: string;
}

export interface TryoutCarouselCard {
  id: number;
  package_id: number | null;
  title: string;
  description: string;
  image_url: string;
  status_label: string;
  package_label: string;
  cta_label: string;
  cta_target: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PdfPageImageMeta {
  page: number; // 1-indexed global page across uploaded PDFs
  file_index: number;
  file_page: number; // 1-indexed page inside the specific PDF
  filename: string;
  image_url: string;
  width: number;
  height: number;
}

export interface PdfImportDraftItem {
  temp_id: string;
  question_number: number;
  external_code: string;
  subtest: string;
  topic: string;
  subtopic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: 'single_choice' | 'multiple_choice';
  question_text: string;
  image_url: string | null;
  assets?: QuestionAsset[];
  source_page?: number | null;
  has_visual: boolean;
  visual_description: string;
  options: QuestionOption[];
  correct_answer: string[];
  explanation_text: string;
  solution_text: string;
  needs_review: boolean;
  review_note: string;
  is_duplicate?: boolean;
  source_file?: string;
  chunk_index?: number;
  subtest_temp_id?: string;
}

export interface TryoutDraftSubtest {
  temp_id: string;
  subtest_code: string;
  subtest_name: string;
  duration_seconds: number;
  sort_order: number;
  start_number: number;
  end_number: number;
  detected_heading?: string;
}

export interface PdfImportJob {
  id: number;
  target_type: 'drill' | 'tryout';
  upload_mode: 'by_topic' | 'random' | 'tryout';
  default_subtest: string;
  default_topic: string;
  default_subtopic: string;
  package_title: string;
  package_provider: string;
  package_description: string;
  files: Array<{ filename: string; pageCount: number }>;
  page_images?: PdfPageImageMeta[];
  status: 'processing' | 'preview_ready' | 'completed' | 'failed';
  total_pages: number;
  processed_chunks: number;
  total_chunks: number;
  draft_questions: PdfImportDraftItem[];
  draft_subtests: TryoutDraftSubtest[];
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface ScoringConfig {
  baseScore: number;
  maxScore: number;
  wrongPenalty: number;
  label: string;
}

export interface StudyTarget {
  id: number;
  user_id: number;
  topic: string;
  subtest: string;
  status: 'not_started' | 'ongoing' | 'done';
  updated_at: string;
}

export interface LibraryLink {
  id: number;
  title: string;
  description: string;
  category: string;
  subtest: string;
  drive_url: string;
  thumbnail_url: string | null;
  created_at: string;
}

export interface DwuSchedule {
  id: number;
  subtest_label: string;
  scheduled_date: string;
  topic: string;
  notes: string;
}

export interface DwuReview {
  id: number;
  direction: 'member_to_tutor' | 'tutor_to_member';
  author_id: number;
  author_name: string;
  target_user_id: number | null;
  target_username: string | null;
  subtest: string;
  topic: string;
  ratings: Record<string, number>;
  comment: string;
  weak_topics: string[];
  created_at: string;
}

export interface QuestionReport {
  id: number;
  question_id: number;
  source_type?: 'drill' | 'tryout';
  question_code: string;
  question_subtest: string;
  question_excerpt: string;
  reporter_id: number;
  reporter_name: string;
  issue_type: string;
  description: string;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected' | 'resolved';
  admin_note: string | null;
  reviewed_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasteryRecord {
  question_id: number;
  source_type?: 'drill' | 'tryout';
  external_code: string;
  subtest: string;
  topic: string;
  question_text: string;
  is_ragu_active: boolean;
  was_ever_ragu: boolean;
  ragu_count: number;
  correct_count: number;
  wrong_count: number;
  status: 'ragu' | 'learned' | 'understood';
  last_studied_at: string | null;
  understood_at: string | null;
}

export const SUBTESTS = [
  'Penalaran Umum',
  'Penalaran Kuantitatif',
  'PBM',
  'PPU',
  'LBE',
  'Literasi Bahasa Inggris',
  'PM',
] as const;

export const PAGE_ROUTES = [
  'landing',
  'dashboard',
  'profile',
  'tryout',
  'latsol',
  'leaderboard',
  'library',
  'dwu',
  'feedback',
  'bank',
  'admin',
] as const;

export type PageRoute = (typeof PAGE_ROUTES)[number];
