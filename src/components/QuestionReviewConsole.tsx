import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Crop,
  History,
  Image as ImageIcon,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import { canApproveChecklist, deduplicateAndOrderDraftAssets, REVIEW_CHECKLIST_ITEMS } from '../lib/utbkLogic';
import {
  SUBTESTS,
  type AuditChecklistState,
  type QuestionAsset,
  type QuestionOption,
  type QuestionVersionRecord,
  type ReviewStatus,
  type User,
} from '../types';
import { MathContent } from './MathContent';
import { VisualCropModal } from './VisualCropModal';

export interface ReviewQuestionItem {
  id: number;
  source_type: 'drill' | 'tryout';
  package_id?: number;
  package_title?: string | null;
  external_code: string;
  subtest: string;
  topic: string;
  subtopic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: 'single_choice' | 'multiple_choice';
  question_text: string;
  image_url: string | null;
  assets: QuestionAsset[];
  options: QuestionOption[];
  correct_answer: string[];
  explanation_text: string;
  solution_text: string;
  review_status: ReviewStatus;
  input_source: 'ai_pdf' | 'json' | 'manual';
  version: number;
  audit_checklist: AuditChecklistState;
  reviewer_notes: string;
  review_note: string;
  is_published: boolean;
  has_visual: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface QuestionReviewConsoleProps {
  currentUser: User;
  onStatusChanged?: () => Promise<void> | void;
}

const STATUS_META: Record<ReviewStatus, { label: string; cls: string }> = {
  pending_review: { label: 'Menunggu Review', cls: 'bg-amber-400/20 text-amber-200 border-amber-400/50' },
  under_review: { label: 'Sedang Direview', cls: 'bg-sky-500/20 text-sky-200 border-sky-400/50' },
  needs_correction: { label: 'Perlu Perbaikan', cls: 'bg-orange-500/25 text-orange-200 border-orange-400/50' },
  approved: { label: 'Disetujui', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50' },
  rejected: { label: 'Ditolak', cls: 'bg-red-500/20 text-red-200 border-red-400/50' },
};

export function QuestionReviewConsole({ currentUser, onStatusChanged }: QuestionReviewConsoleProps) {
  const isSuperAdmin = currentUser.role === 'super_admin';

  const [items, setItems] = useState<ReviewQuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'drill' | 'tryout'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inputSourceFilter, setInputSourceFilter] = useState<string>('all');
  const [subtestFilter, setSubtestFilter] = useState<string>('all');
  const [diffFilter, setDiffFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('newest');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReviewQuestionItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<'audit' | 'versions'>('audit');
  const [draft, setDraft] = useState<ReviewQuestionItem | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [versions, setVersions] = useState<QuestionVersionRecord[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropAssetIdx, setCropAssetIdx] = useState<number | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('source_type', sourceFilter);
      params.set('status', statusFilter);
      params.set('input_source', inputSourceFilter);
      params.set('subtest', subtestFilter);
      params.set('difficulty', diffFilter);
      params.set('sort', sortBy);
      if (search.trim()) params.set('q', search.trim());
      const rows = await apiFetch<ReviewQuestionItem[]>(`/api/admin/review/questions?${params.toString()}`);
      setItems(rows);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal memuat antrean review soal.');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, statusFilter, inputSourceFilter, subtestFilter, diffFilter, sortBy, search]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const loadVersions = async (sourceType: 'drill' | 'tryout', id: number) => {
    setLoadingVersions(true);
    try {
      const rows = await apiFetch<QuestionVersionRecord[]>(
        `/api/admin/review/questions/${sourceType}/${id}/versions`
      );
      setVersions(rows);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal memuat riwayat versi.');
    } finally {
      setLoadingVersions(false);
    }
  };

  const openItem = (item: ReviewQuestionItem) => {
    setSelected(item);
    setDraft(JSON.parse(JSON.stringify(item)) as ReviewQuestionItem);
    setDrawerTab('audit');
    setChangeReason('');
    void loadVersions(item.source_type, item.id);
  };

  const handleSaveRevision = async () => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const normalizedAssets = deduplicateAndOrderDraftAssets(draft.assets || []);
      const res = await apiFetch<{ updated: boolean; review_status: ReviewStatus; version: number }>(
        `/api/admin/review/questions/${draft.source_type}/${draft.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            external_code: draft.external_code,
            subtest: draft.subtest,
            topic: draft.topic,
            subtopic: draft.subtopic,
            difficulty: draft.difficulty,
            question_type: draft.question_type,
            question_text: draft.question_text,
            image_url: normalizedAssets[0]?.asset_url || draft.image_url || null,
            assets: normalizedAssets,
            options: draft.options,
            correct_answer: draft.correct_answer,
            explanation_text: draft.explanation_text,
            solution_text: draft.solution_text,
            reviewer_notes: draft.reviewer_notes,
            audit_checklist: draft.audit_checklist,
            change_reason: changeReason.trim(),
          }),
        }
      );
      setNotice(
        `Perubahan soal ${draft.external_code} tersimpan (v${res.version}, status: ${STATUS_META[res.review_status].label}).`
      );
      await loadItems();
      await loadVersions(draft.source_type, draft.id);
      setDraft((prev) => (prev ? { ...prev, version: res.version, review_status: res.review_status } : prev));
      await onStatusChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menyimpan revisi soal.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusDecision = async (targetStatus: ReviewStatus) => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ updated: boolean; review_status: ReviewStatus; version: number }>(
        `/api/admin/review/questions/${draft.source_type}/${draft.id}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            review_status: targetStatus,
            audit_checklist: draft.audit_checklist,
            reviewer_notes: draft.reviewer_notes,
          }),
        }
      );
      setNotice(`Status soal ${draft.external_code} diubah menjadi "${STATUS_META[res.review_status].label}" (v${res.version}).`);
      await loadItems();
      await loadVersions(draft.source_type, draft.id);
      setDraft((prev) => (prev ? { ...prev, version: res.version, review_status: res.review_status } : prev));
      await onStatusChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal memperbarui status review.');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreVersion = async (versionId: number, versionNumber: number) => {
    if (!draft || !isSuperAdmin) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ restored: boolean; version: number; review_status: ReviewStatus }>(
        `/api/admin/review/questions/${draft.source_type}/${draft.id}/restore/${versionId}`,
        { method: 'POST' }
      );
      setNotice(
        `Soal ${draft.external_code} dipulihkan ke snapshot v${versionNumber} sebagai versi baru v${res.version} (status: ${STATUS_META[res.review_status].label}).`
      );
      await loadItems();
      setSelected(null);
      setDraft(null);
      await onStatusChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal memulihkan versi.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadImageInDrawer = (file: File | undefined) => {
    if (!file || !draft) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
          method: 'POST',
          body: JSON.stringify({ data_url: String(reader.result) }),
        });
        const nextAssets = deduplicateAndOrderDraftAssets([
          ...(draft.assets || []),
          { asset_url: res.url, asset_type: 'manual', display_order: (draft.assets || []).length },
        ]);
        setDraft({ ...draft, assets: nextAssets, image_url: nextAssets[0]?.asset_url || null });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
      }
    };
    reader.readAsDataURL(file);
  };

  const counts = {
    total: items.length,
    pending: items.filter((i) => i.review_status === 'pending_review' || i.review_status === 'under_review').length,
    correction: items.filter((i) => i.review_status === 'needs_correction').length,
    approved: items.filter((i) => i.review_status === 'approved').length,
  };

  const checklistStatus = draft ? canApproveChecklist(draft.audit_checklist) : { ok: false, missingLabels: [] };

  return (
    <div data-testid="question-review-console" className="space-y-5">
      {/* Header & Summary */}
      <div className="bg-[#101B45]/90 rounded-2xl p-5 border border-white/15 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl font-bold text-[#D5BF50] flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6" /> Unified Question Review, Audit & Versioning
            </h3>
            <p className="text-xs text-sky-200 mt-0.5">
              Seluruh soal dari PDF AI, JSON, maupun Input Manual wajib lolos QC Checklist sebelum tampil ke siswa.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              Total: <strong className="font-mono-num text-white">{counts.total}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/30">
              Antrean Review: <strong className="font-mono-num text-amber-200">{counts.pending}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-400/30">
              Perlu Perbaikan: <strong className="font-mono-num text-orange-200">{counts.correction}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30">
              Disetujui: <strong className="font-mono-num text-emerald-200">{counts.approved}</strong>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-3.5 h-3.5 text-sky-300 absolute left-3 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode, materi, atau isi soal..."
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-900 border border-white/20"
            />
          </div>
          <select
            aria-label="Filter tipe bank soal"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'all' | 'drill' | 'tryout')}
            className="px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
          >
            <option value="all">Semua Bank (Drill + TO)</option>
            <option value="drill">Drilling / Latsol</option>
            <option value="tryout">Paket Try Out</option>
          </select>
          <select
            aria-label="Filter status review"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
          >
            <option value="all">Semua Status</option>
            <option value="pending_review">Menunggu Review</option>
            <option value="under_review">Sedang Direview</option>
            <option value="needs_correction">Perlu Perbaikan</option>
            <option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option>
          </select>
          <select
            aria-label="Filter metode input"
            value={inputSourceFilter}
            onChange={(e) => setInputSourceFilter(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
          >
            <option value="all">Semua Sumber Input</option>
            <option value="ai_pdf">AI PDF Import</option>
            <option value="manual">Input Manual</option>
            <option value="json">Import JSON</option>
          </select>
          <select
            aria-label="Urutkan review"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
          >
            <option value="newest">Terbaru Diperbarui</option>
            <option value="oldest">Terlama</option>
            <option value="code">Kode Soal</option>
            <option value="most_used">Paling Sering Dipakai</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <select
            aria-label="Filter subtest review"
            value={subtestFilter}
            onChange={(e) => setSubtestFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/20"
          >
            <option value="all">Semua Subtest</option>
            {SUBTESTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter kesulitan review"
            value={diffFilter}
            onChange={(e) => setDiffFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/20"
          >
            <option value="all">Semua Kesulitan</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2.5 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50] flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="underline cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-sm text-sky-100 bg-[#0D4FA8]/50 rounded-2xl border border-white/15">
          Memuat daftar soal untuk review & audit...
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-sky-100 bg-[#0D4FA8]/50 rounded-2xl border border-white/15">
          Tidak ada soal yang cocok dengan filter saat ini.
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const st = STATUS_META[item.review_status] || STATUS_META.pending_review;
            return (
              <div
                key={`${item.source_type}-${item.id}`}
                data-testid={`review-row-${item.source_type}-${item.id}`}
                className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-xl p-4 border border-white/15 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono-num font-bold text-[#D5BF50]">{item.external_code}</span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                    <span className="text-sky-200">
                      {item.source_type === 'tryout' ? `Try Out${item.package_title ? ` (${item.package_title})` : ''}` : 'Drilling'}
                    </span>
                    <span className="text-sky-300/80">· {item.subtest} · {item.topic}</span>
                    <span className="font-mono-num text-[11px] text-sky-200">
                      · {item.input_source} · v{item.version} · {item.usage_count}× dipakai
                    </span>
                  </div>
                  <p className="text-sm text-white/95 line-clamp-2">{item.question_text}</p>
                </div>

                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="px-4 py-2 rounded-lg bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] text-xs font-bold shrink-0 cursor-pointer"
                >
                  Review & Audit
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Audit & Version History Modal */}
      {selected && draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Audit Soal ${draft.external_code}`}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-5"
        >
          <div className="bg-[#101B45] text-white rounded-2xl max-w-5xl w-full max-h-[94vh] flex flex-col border border-[#D5BF50] shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/15 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-display text-xl sm:text-2xl font-bold text-[#D5BF50]">
                  Audit & Versi — {draft.external_code} ({draft.source_type === 'tryout' ? 'Try Out' : 'Drilling'} · v{draft.version})
                </h4>
                <p className="text-xs text-sky-200">
                  Sumber: {draft.input_source} · Status: {STATUS_META[draft.review_status]?.label}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawerTab('audit')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    drawerTab === 'audit' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                  }`}
                >
                  Editor & QC Checklist
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('versions')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                    drawerTab === 'versions' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                  }`}
                >
                  <History className="w-3.5 h-3.5" /> Riwayat Versi ({versions.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDraft(null);
                  }}
                  aria-label="Tutup modal audit"
                  className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-5 text-xs">
              {draft.usage_count > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-100 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <div>
                    <strong>Soal sudah digunakan pada {draft.usage_count} sesi siswa.</strong> Sesi historis dilindungi snapshot saat pengerjaan sehingga skor lama tidak berubah; perubahan kunci pada Try Out akan menandai sesi terkait untuk transparansi.
                  </div>
                </div>
              )}

              {drawerTab === 'audit' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left: Editor + Preview + Images */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="p-3.5 rounded-xl bg-[#0757B8]/40 border border-white/15 space-y-2">
                      <p className="text-[11px] uppercase tracking-wider font-bold text-[#D5BF50]">Preview Rendering</p>
                      <MathContent text={draft.question_text} className="text-sm text-white" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <label className="space-y-1">
                        <span className="text-sky-200 font-semibold block">Subtest</span>
                        <select
                          value={draft.subtest}
                          onChange={(e) => setDraft({ ...draft, subtest: e.target.value })}
                          className="w-full px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
                        >
                          {SUBTESTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-sky-200 font-semibold block">Materi</span>
                        <input
                          type="text"
                          value={draft.topic}
                          onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                          className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-white/20"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-sky-200 font-semibold block">Kesulitan</span>
                        <select
                          value={draft.difficulty}
                          onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as 'easy' | 'medium' | 'hard' })}
                          className="w-full px-2.5 py-2 rounded-lg bg-[#0757B8] border border-white/20"
                        >
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </select>
                      </label>
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-sky-200 font-semibold block">Teks Soal</span>
                      <textarea
                        rows={4}
                        value={draft.question_text}
                        onChange={(e) => setDraft({ ...draft, question_text: e.target.value })}
                        className="w-full p-2.5 rounded-lg bg-slate-950 border border-white/20 text-sm"
                      />
                    </label>

                    {/* Images + Standalone Crop */}
                    <div className="space-y-2 p-3 rounded-xl bg-white/5 border border-white/15">
                      <div className="flex items-center justify-between">
                        <span className="text-sky-200 font-semibold">Gambar & Crop Manual</span>
                        <label className="px-2.5 py-1 rounded bg-[#0757B8] hover:bg-[#0D4FA8] font-bold cursor-pointer inline-flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5" /> + Tambah Gambar
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => handleUploadImageInDrawer(e.target.files?.[0])}
                          />
                        </label>
                      </div>
                      {draft.assets && draft.assets.length > 0 && (
                        <div className="flex flex-wrap gap-2.5">
                          {draft.assets.map((a, idx) => (
                            <div key={`${a.asset_url}-${idx}`} className="p-2 rounded bg-black/35 border border-white/15 space-y-1">
                              <img src={a.asset_url} alt={`Lampiran ${idx + 1}`} className="h-20 w-auto object-contain rounded bg-white" />
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setCropAssetIdx(idx)}
                                  className="px-2 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Crop className="w-3 h-3" /> Crop
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = draft.assets.filter((_, i) => i !== idx);
                                    setDraft({ ...draft, assets: next, image_url: next[0]?.asset_url || null });
                                  }}
                                  className="px-2 py-0.5 rounded bg-red-500/25 text-red-200 cursor-pointer"
                                >
                                  Hapus
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Options & Answer Key */}
                    <div className="space-y-2">
                      <span className="text-sky-200 font-semibold block">Opsi & Kunci Jawaban</span>
                      {draft.options.map((opt, idx) => {
                        const isKey = draft.correct_answer.includes(opt.key);
                        return (
                          <div key={opt.key} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const next = isKey
                                  ? draft.correct_answer.filter((k) => k !== opt.key)
                                  : [...draft.correct_answer, opt.key].sort();
                                setDraft({ ...draft, correct_answer: next });
                              }}
                              className={`w-8 h-8 rounded font-bold shrink-0 cursor-pointer border ${
                                isKey
                                  ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                                  : 'bg-white/10 text-white border-white/20'
                              }`}
                            >
                              {opt.key}
                            </button>
                            <input
                              type="text"
                              value={opt.content}
                              onChange={(e) => {
                                const nextOpts = draft.options.map((o, i) =>
                                  i === idx ? { ...o, content: e.target.value } : o
                                );
                                setDraft({ ...draft, options: nextOpts });
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded bg-slate-900 border border-white/20"
                            />
                          </div>
                        );
                      })}
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-sky-200 font-semibold block">Pembahasan</span>
                      <textarea
                        rows={3}
                        value={draft.explanation_text}
                        onChange={(e) => setDraft({ ...draft, explanation_text: e.target.value })}
                        className="w-full p-2.5 rounded-lg bg-slate-950 border border-white/20"
                      />
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-sky-200 font-semibold block">Alasan Perubahan (Tercatat di Riwayat Versi)</span>
                      <input
                        type="text"
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                        placeholder="Mis: Perbaikan tanda minus pada langkah 2"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20"
                      />
                    </label>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveRevision}
                      className="px-4 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" /> Simpan Revisi Konten
                    </button>
                  </div>

                  {/* Right: 11-item QC Checklist & Decision */}
                  <div className="lg:col-span-5 bg-[#0B1434] rounded-xl p-4 border border-white/15 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="font-display text-lg font-bold text-[#D5BF50]">Checklist Audit QC</h5>
                      <button
                        type="button"
                        onClick={() => {
                          const allChecked: AuditChecklistState = {};
                          REVIEW_CHECKLIST_ITEMS.forEach((c) => {
                            allChecked[c.key] = true;
                          });
                          setDraft({ ...draft, audit_checklist: allChecked });
                        }}
                        className="text-[11px] text-sky-300 hover:underline cursor-pointer"
                      >
                        Centang Semua
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {REVIEW_CHECKLIST_ITEMS.map((item) => (
                        <label
                          key={item.key}
                          className="flex items-start gap-2.5 p-2 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(draft.audit_checklist?.[item.key])}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                audit_checklist: {
                                  ...(draft.audit_checklist || {}),
                                  [item.key]: e.target.checked,
                                },
                              })
                            }
                            className="mt-0.5"
                          />
                          <span>
                            {item.label}
                            {item.requiredForApproval && <span className="text-amber-300 ml-1">*</span>}
                          </span>
                        </label>
                      ))}
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-sky-200 font-semibold block">Catatan Reviewer</span>
                      <textarea
                        rows={2}
                        value={draft.reviewer_notes}
                        onChange={(e) => setDraft({ ...draft, reviewer_notes: e.target.value })}
                        placeholder="Catatan audit atau alasan penolakan..."
                        className="w-full p-2 rounded-lg bg-slate-900 border border-white/20"
                      />
                    </label>

                    {!checklistStatus.ok && (
                      <p className="text-[11px] text-amber-200">
                        Lengkapi {checklistStatus.missingLabels.length} item wajib (*) untuk mengaktifkan persetujuan.
                      </p>
                    )}

                    <div className="space-y-2 pt-2 border-t border-white/15">
                      <button
                        type="button"
                        disabled={saving || !checklistStatus.ok}
                        onClick={() => handleStatusDecision('approved')}
                        className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Setujui & Publikasikan
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleStatusDecision('needs_correction')}
                          className="py-2 rounded-lg bg-orange-500/25 hover:bg-orange-500/40 text-orange-100 font-bold cursor-pointer"
                        >
                          Perlu Perbaikan
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleStatusDecision('rejected')}
                          className="py-2 rounded-lg bg-red-500/25 hover:bg-red-500/40 text-red-100 font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Tolak
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Versions Tab */
                <div className="space-y-3">
                  {loadingVersions ? (
                    <p className="text-center py-6 text-sky-200">Memuat riwayat versi...</p>
                  ) : versions.length === 0 ? (
                    <p className="text-center py-6 text-sky-200">Belum ada riwayat perubahan tercatat.</p>
                  ) : (
                    versions.map((ver) => (
                      <div key={ver.id} className="p-4 rounded-xl bg-[#0B1434] border border-white/15 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-mono-num font-bold text-[#D5BF50]">Versi v{ver.version_number}</span>
                            <span className="ml-2 text-sky-200">
                              oleh <strong>{ver.changed_by_username}</strong> ({ver.changed_by_role})
                            </span>
                            <span className="ml-2 text-sky-300/75">
                              · {new Date(ver.changed_at).toLocaleString('id-ID')}
                            </span>
                          </div>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => handleRestoreVersion(ver.id, ver.version_number)}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Restore Versi Ini (Super Admin)
                            </button>
                          )}
                        </div>
                        {ver.change_reason && (
                          <p className="text-sky-100">
                            Alasan: <em>{ver.change_reason}</em> · Field berubah: {ver.changed_fields.join(', ') || '—'}
                          </p>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                          <div className="p-3 rounded-lg bg-black/30 border border-white/10">
                            <p className="font-bold text-red-300 mb-1">Before Snapshot</p>
                            <p className="text-white/80 line-clamp-4">
                              {String(ver.before_snapshot?.question_text || '(Awal dibuat — belum ada snapshot sebelumnya)')}
                            </p>
                            {Array.isArray(ver.before_snapshot?.correct_answer) && (
                              <p className="mt-1 font-mono text-sky-200">
                                Kunci: {(ver.before_snapshot.correct_answer as string[]).join(', ')}
                              </p>
                            )}
                          </div>
                          <div className="p-3 rounded-lg bg-black/30 border border-emerald-400/25">
                            <p className="font-bold text-emerald-300 mb-1">After Snapshot</p>
                            <p className="text-white/95 line-clamp-4">
                              {String(ver.after_snapshot?.question_text || '—')}
                            </p>
                            {Array.isArray(ver.after_snapshot?.correct_answer) && (
                              <p className="mt-1 font-mono text-emerald-200">
                                Kunci: {(ver.after_snapshot.correct_answer as string[]).join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {!isSuperAdmin && versions.length > 0 && (
                    <p className="text-[11px] text-sky-200/80 flex items-center gap-1.5 pt-1">
                      <ShieldCheck className="w-4 h-4 text-[#D5BF50]" /> Fitur Restore Versi hanya tersedia untuk Super Admin.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {cropAssetIdx !== null && draft.assets[cropAssetIdx] && (
            <VisualCropModal
              mode="standalone_image"
              imageUrl={draft.assets[cropAssetIdx].asset_url}
              title={`Crop Manual Gambar ${draft.external_code}`}
              initialCropBox={draft.assets[cropAssetIdx].crop_box}
              onClose={() => setCropAssetIdx(null)}
              onStandaloneCropped={(res) => {
                const nextAssets = draft.assets.map((a, idx) =>
                  idx === cropAssetIdx
                    ? { ...a, asset_url: res.asset_url, asset_type: 'cropped' as const, crop_box: res.crop_box }
                    : a
                );
                setDraft({
                  ...draft,
                  assets: nextAssets,
                  image_url: nextAssets[0]?.asset_url || draft.image_url,
                });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
