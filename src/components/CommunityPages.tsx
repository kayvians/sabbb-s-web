import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Crop,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, getAuthHeaders, parseJsonResponse } from '../utils/api';
import { deduplicateAndOrderDraftAssets, findVisualMissingWarnings } from '../lib/utbkLogic';
import {
  SUBTESTS,
  type DwuReview,
  type DwuSchedule,
  type LibraryLink,
  type PageRoute,
  type PdfImportDraftItem,
  type PdfImportJob,
  type Question,
  type QuestionAsset,
  type QuestionReport,
  type SiteAssetConfig,
  type User,
  type VisualAssets,
} from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { MathContent } from './MathContent';
import { SiteAssetImage } from './SiteAssetImage';
import { ManualQuestionModal } from './ManualQuestionModal';
import { VisualCropModal } from './VisualCropModal';

// ==========================================
// 1. LIBRARY PAGE (Google Drive Resources)
// ==========================================
export function LibraryPage({
  user,
  visualAssets,
  siteAssets,
  onNavigate,
}: {
  user: User;
  visualAssets: VisualAssets;
  siteAssets?: SiteAssetConfig[];
  onNavigate: (page: PageRoute) => void;
}) {
  const [items, setItems] = useState<LibraryLink[]>([]);
  const [subtestFilter, setSubtestFilter] = useState('ALL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Modul PDF');
  const [subtest, setSubtest] = useState<string>(SUBTESTS[0]);
  const [driveUrl, setDriveUrl] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<LibraryLink[]>('/api/library');
      setItems(rows);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal memuat Library.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/library', {
        method: 'POST',
        body: JSON.stringify({ title, description, category, subtest, drive_url: driveUrl }),
      });
      setTitle('');
      setDescription('');
      setDriveUrl('');
      setMsg('Materi Google Drive ditambahkan.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menambah materi.');
    }
  };

  const handleDelete = async (id: number) => {
    await apiFetch(`/api/admin/library/${id}`, { method: 'DELETE' });
    await load();
  };

  const filtered = subtestFilter === 'ALL' ? items : items.filter((i) => i.subtest === subtestFilter);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-extrabold uppercase">Library Materi (Google Drive)</h2>
            <p className="text-sm text-sky-100/85">Kumpulan modul, catatan, dan slide tutor khusus anggota komunitas.</p>
          </div>
          <select
            aria-label="Filter subtest library"
            value={subtestFilter}
            onChange={(e) => setSubtestFilter(e.target.value)}
            className="bg-[#101B45] border border-white/25 rounded-lg px-3 py-2 text-sm"
          >
            <option value="ALL">Semua Subtest</option>
            {SUBTESTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {msg && <div className="px-4 py-2 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50]">{msg}</div>}

        {isAdmin && (
          <form onSubmit={handleAdd} className="bg-[#101B45]/90 rounded-2xl p-5 border border-white/15 grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              required
              placeholder="Nama materi"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            />
            <select
              value={subtest}
              onChange={(e) => setSubtest(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
            >
              {SUBTESTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Kategori (Modul PDF, Catatan)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            />
            <input
              type="url"
              required
              placeholder="https://drive.google.com/..."
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center justify-center gap-1 cursor-pointer">
              <Plus className="w-4 h-4" /> Tambah Link
            </button>
            <input
              type="text"
              placeholder="Deskripsi singkat materi..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="md:col-span-5 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            />
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => (
            <article key={item.id} className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  {item.thumbnail_url ? (
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-lg object-cover border border-white/20 shrink-0"
                    />
                  ) : (
                    <SiteAssetImage
                      slotKey="libraryThumbnail"
                      siteAssets={siteAssets}
                      fallbackUrl={visualAssets.libraryThumbnail}
                      fallbackAlt={item.title}
                      className="w-11 h-11 rounded-lg object-cover border border-white/20 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-[#D5BF50] font-semibold">
                      {item.subtest} · {item.category}
                    </p>
                    <h3 className="font-display text-xl font-bold truncate">{item.title}</h3>
                  </div>
                </div>
                <p className="text-xs text-sky-100/85 leading-relaxed">{item.description || 'Materi pembelajaran komunitas.'}</p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <a
                  href={item.drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-[#D5BF50] hover:underline"
                >
                  <BookOpen className="w-4 h-4" /> Buka Google Drive <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    aria-label={`Hapus ${item.title}`}
                    className="p-1.5 text-white/60 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. DWU REVIEW PAGE (Two-way Evaluation)
// ==========================================
export function DwuReviewPage({ user, onNavigate }: { user: User; onNavigate: (page: PageRoute) => void }) {
  const [schedules, setSchedules] = useState<DwuSchedule[]>([]);
  const [reviews, setReviews] = useState<DwuReview[]>([]);
  const [members, setMembers] = useState<Array<{ id: number; username: string; role: string }>>([]);
  const [direction, setDirection] = useState<'member_to_tutor' | 'tutor_to_member'>('member_to_tutor');
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [subtest, setSubtest] = useState<string>(SUBTESTS[0]);
  const [topic, setTopic] = useState('');
  const [comment, setComment] = useState('');
  const [weakTopics, setWeakTopics] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({
    aspek_1: 5,
    aspek_2: 5,
    aspek_3: 5,
    aspek_4: 5,
    aspek_5: 5,
  });
  const [msg, setMsg] = useState<string | null>(null);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        schedules: DwuSchedule[];
        reviews: DwuReview[];
        users: Array<{ id: number; username: string; role: string }>;
      }>('/api/dwu');
      setSchedules(res.schedules);
      setReviews(res.reviews);
      setMembers(res.users);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal memuat data DWU.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const aspectLabels =
    direction === 'member_to_tutor'
      ? ['Kejelasan Materi', 'Penguasaan Materi', 'Penjelasan Soal', 'Interaksi', 'Efektivitas']
      : ['Pemahaman Materi', 'Keaktifan', 'Konsistensi Belajar', 'Penyelesaian Soal', 'Perkembangan'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const mappedRatings: Record<string, number> = {};
      aspectLabels.forEach((lbl, idx) => {
        mappedRatings[lbl] = ratings[`aspek_${idx + 1}`] || 5;
      });
      await apiFetch('/api/dwu/reviews', {
        method: 'POST',
        body: JSON.stringify({
          direction,
          target_user_id: targetUserId ? Number(targetUserId) : null,
          subtest,
          topic,
          comment,
          ratings: mappedRatings,
          weak_topics: weakTopics
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setComment('');
      setTopic('');
      setWeakTopics('');
      setMsg('Evaluasi DWU berhasil disimpan dengan aturan privasi yang berlaku.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengirim DWU Review.');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        <div>
          <h2 className="font-display text-3xl font-extrabold uppercase">DWU Review — Evaluasi Dua Arah</h2>
          <p className="text-sm text-sky-100/85">
            Feedback bersifat privat berdasarkan kepemilikan akun dan peran (anggota hanya melihat evaluasi milik sendiri atau yang ditujukan kepadanya).
          </p>
        </div>

        {msg && <div className="px-4 py-2 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50]">{msg}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <form onSubmit={handleSubmit} className="lg:col-span-7 bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDirection('member_to_tutor')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  direction === 'member_to_tutor' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                }`}
              >
                Anggota → Tutor
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setDirection('tutor_to_member')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                    direction === 'tutor_to_member' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                  }`}
                >
                  Tutor → Anggota
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-sky-200 mb-1">
                  {direction === 'member_to_tutor' ? 'Tutor yang Dinilai' : 'Anggota yang Dievaluasi'}
                </label>
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
                >
                  <option value="">-- Pilih --</option>
                  {members
                    .filter((m) =>
                      direction === 'member_to_tutor' ? m.role === 'admin' || m.role === 'super_admin' : m.id !== user.id
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.username} ({m.role})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-sky-200 mb-1">Subtest</label>
                <select
                  value={subtest}
                  onChange={(e) => setSubtest(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
                >
                  {SUBTESTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Topik / Materi yang diulas"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
              />
              <input
                type="text"
                placeholder="Materi lemah (pisahkan koma, mis: Trigonometri, Limit)"
                value={weakTopics}
                onChange={(e) => setWeakTopics(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {aspectLabels.map((lbl, idx) => {
                const key = `aspek_${idx + 1}`;
                return (
                  <label key={lbl} className="text-[11px] text-sky-200 block">
                    <span className="block truncate mb-1" title={lbl}>
                      {lbl}
                    </span>
                    <select
                      value={ratings[key]}
                      onChange={(e) => setRatings({ ...ratings, [key]: Number(e.target.value) })}
                      className="w-full px-2 py-1.5 rounded bg-[#0757B8] border border-white/20 text-xs font-bold text-white"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} / 5
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>

            <textarea
              rows={3}
              required
              placeholder="Catatan evaluasi pembelajaran..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
            />

            <button type="submit" className="px-5 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
              Kirim DWU Review
            </button>
          </form>

          <div className="lg:col-span-5 bg-[#0B0E17] rounded-2xl p-6 border border-white/15 space-y-4">
            <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Jadwal DWU Komunitas</h3>
            <ul className="divide-y divide-white/10 text-sm">
              {schedules.map((s) => (
                <li key={s.id} className="py-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">
                      {s.subtest_label} {s.topic ? `— ${s.topic}` : ''}
                    </p>
                    {s.notes && <p className="text-xs text-slate-400">{s.notes}</p>}
                  </div>
                  <span className="font-mono-num text-xs text-[#D5BF50] shrink-0">
                    {new Date(s.scheduled_date).toLocaleDateString('id-ID')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <section className="space-y-3">
          <h3 className="font-display text-2xl font-bold uppercase">Riwayat Evaluasi</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map((r) => (
              <div key={r.id} className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-xl p-4 border border-white/15 space-y-2">
                <div className="flex items-center justify-between text-xs text-sky-200">
                  <span className="font-bold text-[#D5BF50]">
                    {r.direction === 'member_to_tutor' ? 'Anggota → Tutor' : 'Tutor → Anggota'}
                  </span>
                  <span>{new Date(r.created_at).toLocaleDateString('id-ID')}</span>
                </div>
                <p className="text-sm font-bold">
                  {r.author_name} → {r.target_username || 'Umum'} · {r.subtest} {r.topic ? `(${r.topic})` : ''}
                </p>
                <p className="text-xs text-sky-50 leading-relaxed">{r.comment}</p>
                <div className="flex flex-wrap gap-3 text-[11px] text-sky-200 pt-1">
                  {Object.entries(r.ratings).map(([k, v]) => (
                    <span key={k}>
                      {k}: <strong>{v}/5</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ==========================================
// 3. QUESTION FEEDBACK PAGE (Reports & Admin Approval)
// ==========================================
export function QuestionFeedbackPage({ user, onNavigate }: { user: User; onNavigate: (page: PageRoute) => void }) {
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionId, setQuestionId] = useState<number>(0);
  const [issueType, setIssueType] = useState('Kunci jawaban diduga salah');
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const load = useCallback(async () => {
    try {
      const [rList, qList] = await Promise.all([
        apiFetch<QuestionReport[]>('/api/reports'),
        apiFetch<Question[]>('/api/questions'),
      ]);
      setReports(rList);
      setQuestions(qList);
      if (qList.length > 0 && questionId === 0) setQuestionId(qList[0].id);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal memuat daftar laporan.');
    }
  }, [questionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ question_id: questionId, source_type: 'drill', issue_type: issueType, description }),
      });
      setDescription('');
      setMsg('Laporan soal berhasil dikirim. Status awal: Pending (menunggu persetujuan Admin).');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengirim laporan.');
    }
  };

  const handleReviewStatus = async (id: number, status: QuestionReport['status']) => {
    await apiFetch(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setMsg(`Laporan #${id} diperbarui ke status "${status}".`);
    await load();
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        <div>
          <h2 className="font-display text-3xl font-extrabold uppercase">Question Feedback & Pelaporan Soal</h2>
          <p className="text-sm text-sky-100/85">
            Laporkan kunci jawaban, typo, gambar rusak, atau pembahasan kurang jelas. Laporan baru dinyatakan selesai setelah ditinjau dan disetujui Admin.
          </p>
        </div>

        {msg && <div className="px-4 py-2 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50]">{msg}</div>}

        <form onSubmit={handleSubmit} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-sky-200 mb-1">Pilih Soal Drilling</label>
              <select
                value={questionId}
                onChange={(e) => setQuestionId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
              >
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    [{q.external_code}] {q.subtest} — {q.topic}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-sky-200 mb-1">Jenis Masalah</label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
              >
                {[
                  'Kunci jawaban diduga salah',
                  'Pembahasan kurang jelas',
                  'Soal memiliki kesalahan penulisan',
                  'Gambar tidak muncul',
                  'Pilihan jawaban bermasalah',
                  'Soal ambigu',
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            rows={3}
            required
            placeholder="Jelaskan masalah pada soal..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
          />

          <button type="submit" className="px-5 py-2 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
            Kirim Laporan Soal
          </button>
        </form>

        <div className="space-y-3">
          <h3 className="font-display text-2xl font-bold uppercase">
            {isAdmin ? 'Seluruh Laporan Masuk' : 'Riwayat Laporan Anda'}
          </h3>
          {reports.length === 0 ? (
            <p className="text-sm text-sky-100/80">Belum ada laporan soal.</p>
          ) : (
            <div className="space-y-3">
              {reports.map((rep) => (
                <div key={rep.id} className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-xl p-4 border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-sky-200">
                      <span className="font-mono-num font-bold text-[#D5BF50]">{rep.question_code}</span>
                      <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold uppercase">
                        {rep.source_type === 'tryout' ? 'Try Out' : 'Drilling'}
                      </span>
                      <span>· {rep.question_subtest}</span>
                      <span>· Pelapor: {rep.reporter_name}</span>
                      <span>· Status: <strong className="uppercase text-white">{rep.status}</strong></span>
                    </div>
                    <p className="font-bold text-sm">{rep.issue_type}</p>
                    <p className="text-xs text-sky-100/85">{rep.description}</p>
                  </div>

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReviewStatus(rep.id, 'reviewing')}
                        className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-xs font-semibold cursor-pointer"
                      >
                        Tinjau
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewStatus(rep.id, 'approved')}
                        className="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewStatus(rep.id, 'rejected')}
                        className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Tolak
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewStatus(rep.id, 'resolved')}
                        className="px-2.5 py-1 rounded bg-[#D5BF50] text-[#101B45] text-xs font-bold cursor-pointer"
                      >
                        Selesai
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. QUESTION BANK PAGE (Unified Drilling Bank + PDF-Only AI Import)
// ==========================================
export function QuestionBankPage({ user, onNavigate }: { user: User; onNavigate: (page: PageRoute) => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [subtestFilter, setSubtestFilter] = useState('ALL');
  const [uploadModeFilter, setUploadModeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'browse' | 'pdf'>('browse');

  // PDF Import state
  const [uploadMode, setUploadMode] = useState<'by_topic' | 'random'>('by_topic');
  const [defaultSubtest, setDefaultSubtest] = useState<string>(SUBTESTS[0]);
  const [defaultTopic, setDefaultTopic] = useState('');
  const [defaultSubtopic, setDefaultSubtopic] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [activeJob, setActiveJob] = useState<PdfImportJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<PdfImportJob[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [allowMissingKeys, setAllowMissingKeys] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);
  const [editCropIdx, setEditCropIdx] = useState<number | null>(null);
  const [cropTarget, setCropTarget] = useState<{
    item: PdfImportDraftItem;
    assetIndex?: number;
    initialAsset?: QuestionAsset;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const loadQuestions = useCallback(async () => {
    try {
      const q = await apiFetch<Question[]>(
        `/api/questions?subtest=${encodeURIComponent(subtestFilter)}&upload_mode=${encodeURIComponent(uploadModeFilter)}&q=${encodeURIComponent(search)}`
      );
      setQuestions(q);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal memuat daftar soal.');
    }
  }, [subtestFilter, uploadModeFilter, search]);

  const loadRecentJobs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const jobs = await apiFetch<PdfImportJob[]>('/api/admin/import/jobs?target_type=drill');
      setRecentJobs(jobs);
    } catch {
      // ignore transient error
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadQuestions();
    void loadRecentJobs();
  }, [loadQuestions, loadRecentJobs]);

  // Poll running PDF AI extraction job
  useEffect(() => {
    if (!activeJob || activeJob.status !== 'processing') return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeJob.id}`);
        setActiveJob(res.job);
        if (res.job.status !== 'processing') {
          loadRecentJobs();
          if (res.job.status === 'preview_ready') {
            setMsg(`Ekstraksi PDF selesai: ${res.job.draft_questions.length} soal ditemukan. Periksa preview sebelum menyimpan.`);
          } else if (res.job.status === 'failed') {
            setMsg(`Ekstraksi PDF gagal: ${res.job.error_message}`);
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeJob, loadRecentJobs]);

  const handleUploadDrillPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setMsg('Pilih minimal 1 file PDF soal terlebih dahulu.');
      return;
    }
    const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > 30 * 1024 * 1024) {
      setMsg('Total ukuran file PDF melebihi 30 MB. Silakan unggah per bagian agar tidak melewati batas server.');
      return;
    }
    setMsg(null);
    setUploadingPdf(true);
    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append('pdfs', file));
      formData.append('upload_mode', uploadMode);
      formData.append('default_subtest', defaultSubtest);
      formData.append('default_topic', defaultTopic.trim());
      formData.append('default_subtopic', defaultSubtopic.trim());

      const resp = await fetch('/api/admin/import/drill/pdf', {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await parseJsonResponse<{ job?: PdfImportJob; error?: string }>(
        resp,
        'Gagal mengunggah PDF soal'
      );
      if (!data.job) {
        throw new Error(data.error || 'Gagal mengunggah PDF soal.');
      }
      setActiveJob(data.job);
      setSelectedFiles([]);
      await loadRecentJobs();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengunggah PDF.');
    } finally {
      setUploadingPdf(false);
    }
  };

  const updateDraftItem = (tempId: string, patch: Partial<PdfImportDraftItem>) => {
    setActiveJob((prev) =>
      prev
        ? {
            ...prev,
            draft_questions: prev.draft_questions.map((item) =>
              item.temp_id === tempId ? { ...item, ...patch } : item
            ),
          }
        : prev
    );
  };

  const removeDraftItem = (tempId: string) => {
    setActiveJob((prev) =>
      prev
        ? {
            ...prev,
            draft_questions: prev.draft_questions.filter((item) => item.temp_id !== tempId),
          }
        : prev
    );
  };

  const getDraftAssets = (item: PdfImportDraftItem): QuestionAsset[] => {
    if (item.assets && item.assets.length > 0) return item.assets;
    if (item.image_url) {
      return [
        {
          asset_url: item.image_url,
          asset_type: 'manual',
          display_order: 0,
          source_page: item.source_page ?? null,
        },
      ];
    }
    return [];
  };

  const setDraftAssets = (tempId: string, rawAssets: QuestionAsset[]) => {
    const ordered = deduplicateAndOrderDraftAssets(rawAssets);
    updateDraftItem(tempId, {
      assets: ordered,
      image_url: ordered[0]?.asset_url || null,
      has_visual: ordered.length > 0,
    });
  };

  const moveDraftAsset = (item: PdfImportDraftItem, idx: number, dir: -1 | 1) => {
    const list = [...getDraftAssets(item)];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(targetIdx, 0, moved);
    setDraftAssets(
      item.temp_id,
      list.map((a, i) => ({ ...a, display_order: i }))
    );
  };

  const removeDraftAsset = (item: PdfImportDraftItem, idx: number) => {
    const list = getDraftAssets(item).filter((_, i) => i !== idx);
    setDraftAssets(
      item.temp_id,
      list.map((a, i) => ({ ...a, display_order: i }))
    );
  };

  const handleUploadDraftImage = (item: PdfImportDraftItem, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
          method: 'POST',
          body: JSON.stringify({ data_url: String(reader.result) }),
        });
        const current = getDraftAssets(item);
        setDraftAssets(item.temp_id, [
          ...current,
          {
            asset_url: res.url,
            asset_type: 'manual',
            display_order: current.length,
            source_page: item.source_page ?? null,
            caption: '',
          },
        ]);
        setMsg('Gambar ilustrasi soal berhasil ditambahkan.');
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveDraft = async () => {
    if (!activeJob) return;
    const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeJob.id}`, {
      method: 'PUT',
      body: JSON.stringify({ draft_questions: activeJob.draft_questions }),
    });
    setActiveJob(res.job);
    setMsg('Perubahan draft berhasil disimpan.');
  };

  const handleReextract = async () => {
    if (!activeJob) return;
    setMsg(null);
    const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeJob.id}/reextract`, {
      method: 'POST',
    });
    setActiveJob(res.job);
    setMsg('Proses ekstraksi ulang PDF dimulai...');
  };

  const handleCommitDrill = async () => {
    if (!activeJob) return;
    setMsg(null);
    try {
      const res = await apiFetch<{ insertedCount: number; skippedDuplicates: number }>(
        `/api/admin/import/jobs/${activeJob.id}/commit-drill`,
        {
          method: 'POST',
          body: JSON.stringify({
            draft_questions: activeJob.draft_questions,
            skip_duplicates: skipDuplicates,
            allow_missing_keys: allowMissingKeys,
          }),
        }
      );
      setMsg(
        `${res.insertedCount} soal berhasil disimpan ke antrean Review & Audit (${res.skippedDuplicates} duplikat dilewati). Setujui di Admin -> Review & Audit Soal untuk tampil di Latsol.`
      );
      setActiveJob(null);
      setTab('browse');
      await Promise.all([loadQuestions(), loadRecentJobs()]);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menyimpan soal ke Bank Soal.');
    }
  };

  const handleSaveQuestionEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;
    const normalizedAssets = editingQuestion.assets
      ? deduplicateAndOrderDraftAssets(editingQuestion.assets)
      : undefined;
    await apiFetch(`/api/admin/questions/${editingQuestion.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        external_code: editingQuestion.external_code,
        subtest: editingQuestion.subtest,
        topic: editingQuestion.topic,
        subtopic: editingQuestion.subtopic || '',
        difficulty: editingQuestion.difficulty,
        question_type: editingQuestion.question_type,
        question_text: editingQuestion.question_text,
        image_url: normalizedAssets?.[0]?.asset_url || editingQuestion.image_url,
        assets: normalizedAssets,
        options: editingQuestion.options,
        correct_answer: editingQuestion.correct_answer || [],
        explanation_text: editingQuestion.explanation_text || '',
        solution_text: editingQuestion.solution_text || '',
        needs_review: editingQuestion.needs_review,
        is_published: editingQuestion.is_published !== false,
      }),
    });
    setEditingQuestion(null);
    setMsg('Perubahan soal berhasil disimpan.');
    await loadQuestions();
  };

  const handleDeleteQuestion = async (id: number) => {
    await apiFetch(`/api/admin/questions/${id}`, { method: 'DELETE' });
    await loadQuestions();
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-extrabold uppercase">Question Bank Terpadu (Drilling)</h2>
            <p className="text-sm text-sky-100/85">
              Gudang soal terpadu khusus fitur Drilling / Latsol (terpisah penuh dari soal Try Out). Upload PDF diproses AI menjadi 1 nomor = 1 soal.
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTab('browse')}
                className={`px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  tab === 'browse' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-[#101B45] text-white'
                }`}
              >
                Daftar Soal ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('pdf')}
                className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                  tab === 'pdf' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-[#101B45] text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" /> Import Soal PDF (AI)
              </button>
              <button
                type="button"
                data-testid="open-manual-question-btn"
                onClick={() => setShowManualModal(true)}
                className="px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Input Soal Manual
              </button>
            </div>
          )}
        </div>

        {msg && (
          <div className="px-4 py-2.5 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50] flex items-center justify-between gap-2">
            <span>{msg}</span>
            <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">
              Tutup
            </button>
          </div>
        )}

        {/* TAB 1: BROWSE UNIFIED BANK */}
        {tab === 'browse' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode, materi, submateri, atau teks soal..."
                className="flex-1 min-w-[200px] px-3.5 py-2 rounded-lg bg-[#101B45] border border-white/20 text-sm"
              />
              <select
                value={subtestFilter}
                onChange={(e) => setSubtestFilter(e.target.value)}
                className="px-3.5 py-2 rounded-lg bg-[#101B45] border border-white/20 text-sm"
              >
                <option value="ALL">Semua Subtest</option>
                {SUBTESTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={uploadModeFilter}
                onChange={(e) => setUploadModeFilter(e.target.value)}
                className="px-3.5 py-2 rounded-lg bg-[#101B45] border border-white/20 text-sm"
              >
                <option value="ALL">Semua Sumber Upload</option>
                <option value="by_topic">Upload per Materi</option>
                <option value="random">Upload Soal Acak</option>
                <option value="manual">Manual / Awal</option>
              </select>
            </div>

            <div className="space-y-3">
              {questions.map((q) => (
                <div key={q.id} className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-xl p-5 border border-white/15 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sky-200">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono-num text-[#D5BF50]">{q.external_code}</strong>
                      <span>· {q.subtest}</span>
                      <span>· {q.topic}</span>
                      {q.subtopic && <span className="text-sky-300">({q.subtopic})</span>}
                      <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-bold uppercase">
                        {q.upload_mode === 'by_topic'
                          ? 'Per Materi'
                          : q.upload_mode === 'random'
                          ? 'Soal Acak'
                          : 'Manual'}
                      </span>
                      {q.review_status && q.review_status !== 'approved' ? (
                        <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-bold uppercase">
                          {q.review_status === 'needs_correction'
                            ? 'Perlu Perbaikan'
                            : q.review_status === 'rejected'
                            ? 'Ditolak'
                            : q.review_status === 'under_review'
                            ? 'Direview'
                            : 'Menunggu Review'}
                        </span>
                      ) : q.needs_review ? (
                        <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-bold uppercase">
                          Perlu Ditinjau
                        </span>
                      ) : null}
                      {q.is_published === false && (
                        <span className="px-2 py-0.5 rounded bg-slate-500 text-white text-[10px] font-bold uppercase">
                          Belum Terbit
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingQuestion(q)}
                          aria-label={`Edit soal ${q.external_code}`}
                          className="p-1.5 text-white/75 hover:text-[#D5BF50] cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(q.id)}
                          aria-label={`Hapus soal ${q.external_code}`}
                          className="p-1.5 text-white/60 hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <MathContent text={q.question_text} className="text-white text-sm" />
                  {(() => {
                    const qAssets =
                      q.assets && q.assets.length > 0
                        ? q.assets
                        : q.image_url
                        ? [{ asset_url: q.image_url, asset_type: 'manual' as const, display_order: 0 }]
                        : [];
                    if (qAssets.length === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-2">
                        {qAssets.map((a, aIdx) => (
                          <img
                            key={`${a.asset_url}-${aIdx}`}
                            src={a.asset_url}
                            alt={`${q.external_code} (${aIdx + 1})`}
                            className="max-h-36 rounded border border-white/20 bg-white"
                          />
                        ))}
                      </div>
                    );
                  })()}
                  {isAdmin && q.correct_answer && (
                    <p className="text-xs text-emerald-300 font-semibold">
                      Kunci: {q.correct_answer.length > 0 ? q.correct_answer.join(', ') : 'Belum ada kunci'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: PDF-ONLY AI IMPORT FOR DRILLING */}
        {tab === 'pdf' && isAdmin && (
          <div className="space-y-6">
            <form onSubmit={handleUploadDrillPdf} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                    Import Soal Drilling dari PDF + AI
                  </h3>
                  <p className="text-xs text-sky-200 mt-0.5">
                    Hanya menerima file PDF (.pdf). AI mengekstrak setiap nomor menjadi 1 entri soal unik (mendukung PDF teks & scan/OCR, rumus, tabel), menentukan materi & submateri, dan tidak mengarang kunci jika tidak tersedia di PDF.
                  </p>
                </div>

                {/* Upload Mode Selector */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadMode('by_topic')}
                    className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                      uploadMode === 'by_topic' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                    }`}
                  >
                    Upload per Materi
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode('random')}
                    className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                      uploadMode === 'random' ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                    }`}
                  >
                    Upload Soal Acak
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-sky-200 mb-1">
                    {uploadMode === 'by_topic' ? 'Subtest Utama PDF' : 'Subtest Fallback (jika tidak terbaca)'}
                  </label>
                  <select
                    value={defaultSubtest}
                    onChange={(e) => setDefaultSubtest(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
                  >
                    {SUBTESTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-sky-200 mb-1">
                    {uploadMode === 'by_topic' ? 'Materi Utama (mis: Aljabar, Silogisme)' : 'Materi Fallback (opsional)'}
                  </label>
                  <input
                    type="text"
                    value={defaultTopic}
                    onChange={(e) => setDefaultTopic(e.target.value)}
                    placeholder={uploadMode === 'by_topic' ? 'Misal: Aljabar / Peluang' : 'AI klasifikasi otomatis'}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs text-sky-200 mb-1">Submateri Default (opsional)</label>
                  <input
                    type="text"
                    value={defaultSubtopic}
                    onChange={(e) => setDefaultSubtopic(e.target.value)}
                    placeholder="Misal: Fungsi Kuadrat"
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                </div>
              </div>

              <div className="p-5 rounded-xl border-2 border-dashed border-[#D5BF50]/50 bg-black/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-[#D5BF50] shrink-0" />
                  <div>
                    <p className="text-sm font-bold">
                      {selectedFiles.length > 0
                        ? `${selectedFiles.length} file PDF dipilih (${selectedFiles.map((f) => f.name).join(', ')})`
                        : 'Pilih 1 atau beberapa file PDF soal (.pdf)'}
                    </p>
                    <p className="text-xs text-sky-200">
                      Maksimal 10 file PDF per batch · Mendukung PDF hasil ekspor maupun scan OCR.
                    </p>
                  </div>
                </div>
                <label className="px-4 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-xs font-bold cursor-pointer flex items-center gap-1.5 shrink-0">
                  <Upload className="w-4 h-4" /> Pilih File PDF
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={uploadingPdf || selectedFiles.length === 0}
                className="px-6 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {uploadingPdf ? 'Mengunggah & Memulai AI...' : 'Proses & Ekstrak Soal PDF dengan AI'}
              </button>
            </form>

            {/* Recent PDF Import Jobs */}
            {recentJobs.length > 0 && (
              <div className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15 space-y-3">
                <h4 className="font-display text-xl font-bold uppercase text-[#D5BF50]">
                  Riwayat Batch Import PDF Drilling
                </h4>
                <div className="flex flex-wrap gap-2">
                  {recentJobs.slice(0, 6).map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setActiveJob(j)}
                      className={`px-3 py-2 rounded-xl border text-left text-xs cursor-pointer transition-colors ${
                        activeJob?.id === j.id
                          ? 'bg-[#D5BF50] text-[#101B45] border-[#D5BF50] font-bold'
                          : 'bg-[#101B45] text-white border-white/20 hover:border-[#D5BF50]'
                      }`}
                    >
                      <span className="block">
                        Batch #{j.id} ({j.upload_mode === 'by_topic' ? 'Per Materi' : 'Soal Acak'}) · {j.draft_questions.length} soal
                      </span>
                      <span className="text-[10px] opacity-80 uppercase">
                        Status: {j.status} · {j.files.map((f) => f.filename).join(', ')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Active Job Processing or Preview Panel */}
            {activeJob && (
              <div className="bg-[#101B45] rounded-2xl p-6 border-2 border-[#D5BF50] space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                      Preview & Validasi Import PDF (#{activeJob.id})
                    </h3>
                    <p className="text-xs text-sky-200">
                      {activeJob.total_pages} halaman · Chunk {activeJob.processed_chunks}/{activeJob.total_chunks} ·{' '}
                      {activeJob.draft_questions.length} soal terekstrak
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleReextract}
                      disabled={activeJob.status === 'processing'}
                      className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Ekstrak Ulang
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={activeJob.status === 'processing'}
                      className="px-3.5 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" /> Simpan Draft
                    </button>
                    <button
                      type="button"
                      onClick={handleCommitDrill}
                      disabled={activeJob.status === 'processing' || activeJob.draft_questions.length === 0}
                      className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Setujui & Terbitkan ke Bank Terpadu
                    </button>
                  </div>
                </div>

                {activeJob.status === 'processing' && (
                  <div className="p-4 rounded-xl bg-white/10 border border-white/20 space-y-2">
                    <p className="text-sm font-bold text-[#D5BF50]">
                      AI sedang membaca & memecah soal PDF ({activeJob.processed_chunks}/{activeJob.total_chunks} bagian)...
                    </p>
                    <div className="w-full h-2.5 rounded-full bg-black/40 overflow-hidden">
                      <div
                        className="h-full bg-[#D5BF50] transition-all"
                        style={{
                          width: `${
                            activeJob.total_chunks > 0
                              ? Math.round((activeJob.processed_chunks / activeJob.total_chunks) * 100)
                              : 10
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {activeJob.status === 'failed' && (
                  <div className="p-3 rounded-lg bg-red-500/20 border border-red-400 text-xs text-red-100">
                    {activeJob.error_message}
                  </div>
                )}

                <div className="flex flex-wrap gap-4 text-xs bg-white/5 p-3 rounded-xl border border-white/10">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                    />
                    <span>Lewati soal duplikat secara otomatis saat publikasi</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowMissingKeys}
                      onChange={(e) => setAllowMissingKeys(e.target.checked)}
                    />
                    <span>Izinkan simpan sebagai draft jika masih ada soal tanpa kunci jawaban</span>
                  </label>
                </div>

                {(() => {
                  const visualWarnings = findVisualMissingWarnings(activeJob.draft_questions);
                  if (visualWarnings.length === 0) return null;
                  return (
                    <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400 text-xs text-amber-100 space-y-1">
                      <p className="font-bold flex items-center gap-1.5 text-amber-300">
                        <AlertTriangle className="w-4 h-4" /> Peringatan Visual ({visualWarnings.length} soal)
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {visualWarnings.slice(0, 5).map((w, wi) => (
                          <li key={wi}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Editable Individual Extracted Questions */}
                <div className="space-y-4">
                  {activeJob.draft_questions.map((item, idx) => (
                    <div key={item.temp_id} className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono-num font-bold text-[#D5BF50]">
                            No. {item.question_number || idx + 1} ({item.external_code})
                          </span>
                          {item.needs_review && (
                            <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Perlu Ditinjau
                            </span>
                          )}
                          {item.is_duplicate && (
                            <span className="px-2 py-0.5 rounded bg-red-500 text-white font-bold">Duplikat</span>
                          )}
                          {item.has_visual && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/30 text-sky-100 font-semibold">
                              Mengandung Gambar/Diagram
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => removeDraftItem(item.temp_id)}
                          aria-label={`Hapus draft soal ${idx + 1}`}
                          className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Hapus
                        </button>
                      </div>

                      {item.review_note && (
                        <p className="text-[11px] text-amber-200 bg-amber-500/15 px-2.5 py-1.5 rounded">
                          Catatan AI: {item.review_note}
                        </p>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <select
                          value={item.subtest}
                          onChange={(e) => updateDraftItem(item.temp_id, { subtest: e.target.value })}
                          className="px-2.5 py-1.5 rounded bg-[#0757B8] border border-white/20"
                        >
                          {SUBTESTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={item.topic}
                          onChange={(e) => updateDraftItem(item.temp_id, { topic: e.target.value })}
                          placeholder="Materi (mis: Aljabar)"
                          className="px-2.5 py-1.5 rounded bg-slate-900 border border-white/20"
                        />
                        <input
                          type="text"
                          value={item.subtopic}
                          onChange={(e) => updateDraftItem(item.temp_id, { subtopic: e.target.value })}
                          placeholder="Submateri"
                          className="px-2.5 py-1.5 rounded bg-slate-900 border border-white/20"
                        />
                      </div>

                      <textarea
                        rows={3}
                        value={item.question_text}
                        onChange={(e) => updateDraftItem(item.temp_id, { question_text: e.target.value })}
                        className="w-full p-2.5 rounded bg-slate-950 border border-white/20 text-xs font-mono"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {item.options.map((opt, oIdx) => (
                          <div key={opt.key} className="flex items-center gap-2">
                            <span className="font-bold text-[#D5BF50] w-5">{opt.key}.</span>
                            <input
                              type="text"
                              value={opt.content}
                              onChange={(e) => {
                                const nextOpts = item.options.map((o, oi) =>
                                  oi === oIdx ? { ...o, content: e.target.value } : o
                                );
                                updateDraftItem(item.temp_id, { options: nextOpts });
                              }}
                              className="flex-1 px-2.5 py-1 rounded bg-slate-900 border border-white/20"
                            />
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs items-start">
                        <div>
                          <label className="block text-sky-200 mb-1">Kunci Jawaban (mis: A)</label>
                          <input
                            type="text"
                            value={item.correct_answer.join(',')}
                            onChange={(e) => {
                              const keys = e.target.value
                                .split(',')
                                .map((s) => s.trim().toUpperCase())
                                .filter(Boolean);
                              updateDraftItem(item.temp_id, {
                                correct_answer: keys,
                                needs_review: keys.length === 0,
                              });
                            }}
                            placeholder="Belum tersedia di PDF"
                            className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-white/20 font-mono"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-sky-200 mb-1">Pembahasan</label>
                          <input
                            type="text"
                            value={item.explanation_text}
                            onChange={(e) => updateDraftItem(item.temp_id, { explanation_text: e.target.value })}
                            placeholder="Kosong jika tidak tercantum di PDF"
                            className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-white/20"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 pt-1 text-xs">
                        {(() => {
                          const itemAssets = getDraftAssets(item);
                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 cursor-pointer inline-flex items-center gap-1 font-semibold">
                                  <ImageIcon className="w-3.5 h-3.5" /> + Unggah Gambar
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={(e) => handleUploadDraftImage(item, e.target.files?.[0])}
                                  />
                                </label>
                                {activeJob.page_images && activeJob.page_images.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setCropTarget({ item })}
                                    className="px-2.5 py-1.5 rounded bg-[#0757B8] hover:bg-[#0D4FA8] font-semibold inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Crop className="w-3.5 h-3.5" /> + Crop Area PDF
                                  </button>
                                )}
                                {item.visual_description && itemAssets.length === 0 && (
                                  <span className="text-amber-200">Info diagram: {item.visual_description}</span>
                                )}
                              </div>

                              {itemAssets.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  {itemAssets.map((asset, aIdx) => (
                                    <div
                                      key={`${asset.asset_url}-${aIdx}`}
                                      className="p-2 rounded-lg bg-black/30 border border-white/15 flex items-center gap-3"
                                    >
                                      <img
                                        src={asset.asset_url}
                                        alt={asset.caption || `Preview ${aIdx + 1}`}
                                        className="w-20 h-20 object-contain rounded bg-white border border-white/20 shrink-0"
                                      />
                                      <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                          <span className="px-1.5 py-0.5 rounded bg-[#0757B8] font-bold uppercase">
                                            #{aIdx + 1} · {asset.asset_type}
                                          </span>
                                          {asset.is_shared && (
                                            <span className="px-1.5 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold uppercase">
                                              Shared
                                            </span>
                                          )}
                                          {asset.source_page && (
                                            <span className="text-sky-200">Hal. {asset.source_page}</span>
                                          )}
                                        </div>
                                        {asset.caption && (
                                          <p className="text-[11px] text-sky-100 truncate">{asset.caption}</p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                          {itemAssets.length > 1 && (
                                            <>
                                              <button
                                                type="button"
                                                disabled={aIdx === 0}
                                                onClick={() => moveDraftAsset(item, aIdx, -1)}
                                                className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer"
                                                title="Geser naik"
                                              >
                                                <ArrowUp className="w-3 h-3" />
                                              </button>
                                              <button
                                                type="button"
                                                disabled={aIdx === itemAssets.length - 1}
                                                onClick={() => moveDraftAsset(item, aIdx, 1)}
                                                className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer"
                                                title="Geser turun"
                                              >
                                                <ArrowDown className="w-3 h-3" />
                                              </button>
                                            </>
                                          )}
                                          {activeJob.page_images && activeJob.page_images.length > 0 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setCropTarget({ item, assetIndex: aIdx, initialAsset: asset })
                                              }
                                              className="px-2 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold inline-flex items-center gap-1 cursor-pointer"
                                            >
                                              <Crop className="w-3 h-3" /> Crop Ulang
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => removeDraftAsset(item, aIdx)}
                                            className="px-2 py-0.5 rounded bg-red-500/20 text-red-200 hover:bg-red-500/35 cursor-pointer"
                                          >
                                            Hapus
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Inline Edit Modal for Unified Question Bank */}
        {editingQuestion && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <form
              onSubmit={handleSaveQuestionEdit}
              className="bg-[#101B45] text-white rounded-2xl max-w-2xl w-full p-6 border border-[#D5BF50] space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                  Edit Soal ({editingQuestion.external_code})
                </h3>
                <button type="button" onClick={() => setEditingQuestion(null)} className="p-1 hover:bg-white/10 rounded cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <select
                  value={editingQuestion.subtest}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, subtest: e.target.value })}
                  className="px-3 py-2 rounded bg-[#0757B8] border border-white/20"
                >
                  {SUBTESTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={editingQuestion.topic}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, topic: e.target.value })}
                  placeholder="Materi"
                  className="px-3 py-2 rounded bg-white/10 border border-white/20"
                />
                <input
                  type="text"
                  value={editingQuestion.subtopic || ''}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, subtopic: e.target.value })}
                  placeholder="Submateri"
                  className="px-3 py-2 rounded bg-white/10 border border-white/20"
                />
              </div>

              <textarea
                rows={4}
                value={editingQuestion.question_text}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, question_text: e.target.value })}
                className="w-full p-3 rounded bg-slate-950 border border-white/20 text-sm"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block mb-1 text-sky-200">Kunci Jawaban</label>
                  <input
                    type="text"
                    value={(editingQuestion.correct_answer || []).join(',')}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        correct_answer: e.target.value
                          .split(',')
                          .map((s) => s.trim().toUpperCase())
                          .filter(Boolean),
                      })
                    }
                    className="w-full px-3 py-2 rounded bg-white/10 border border-white/20 font-mono"
                  />
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingQuestion.is_published !== false}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, is_published: e.target.checked })}
                    />
                    <span>Terbitkan di Latsol</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingQuestion.needs_review)}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, needs_review: e.target.checked })}
                    />
                    <span>Perlu Review</span>
                  </label>
                </div>
              </div>

              <textarea
                rows={3}
                value={editingQuestion.explanation_text || ''}
                onChange={(e) => setEditingQuestion({ ...editingQuestion, explanation_text: e.target.value })}
                placeholder="Pembahasan..."
                className="w-full p-3 rounded bg-slate-950 border border-white/20 text-sm"
              />

              {/* Multi-image management inside Question edit modal */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sky-200">Lampiran Gambar Soal</span>
                  <label className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer inline-flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" /> + Tambah Gambar
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
                              method: 'POST',
                              body: JSON.stringify({ data_url: String(reader.result) }),
                            });
                            const cur =
                              editingQuestion.assets && editingQuestion.assets.length > 0
                                ? editingQuestion.assets
                                : editingQuestion.image_url
                                ? [{ asset_url: editingQuestion.image_url, asset_type: 'manual' as const, display_order: 0 }]
                                : [];
                            const next = deduplicateAndOrderDraftAssets([
                              ...cur,
                              { asset_url: res.url, asset_type: 'manual', display_order: cur.length },
                            ]);
                            setEditingQuestion({
                              ...editingQuestion,
                              assets: next,
                              image_url: next[0]?.asset_url || null,
                            });
                          } catch (err) {
                            setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
                {(() => {
                  const list =
                    editingQuestion.assets && editingQuestion.assets.length > 0
                      ? editingQuestion.assets
                      : editingQuestion.image_url
                      ? [{ asset_url: editingQuestion.image_url, asset_type: 'manual' as const, display_order: 0 }]
                      : [];
                  if (list.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {list.map((a, i) => (
                        <div key={`${a.asset_url}-${i}`} className="relative bg-white rounded p-1.5 border border-white/20 space-y-1">
                          <img src={a.asset_url} alt={`Asset ${i + 1}`} className="h-20 w-auto object-contain mx-auto" />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => setEditCropIdx(i)}
                              className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold cursor-pointer"
                            >
                              Crop
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = list
                                  .filter((_, idx) => idx !== i)
                                  .map((x, idx) => ({ ...x, display_order: idx }));
                                setEditingQuestion({
                                  ...editingQuestion,
                                  assets: next,
                                  image_url: next[0]?.asset_url || null,
                                });
                              }}
                              className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-bold cursor-pointer"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="px-4 py-2 rounded-lg bg-white/10 text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] text-xs font-bold cursor-pointer">
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        )}

        {cropTarget && activeJob && (
          <VisualCropModal
            job={activeJob}
            draftItem={cropTarget.item}
            assetIndex={cropTarget.assetIndex}
            initialAsset={cropTarget.initialAsset}
            onClose={() => setCropTarget(null)}
            onCropped={(updatedJob) => {
              setActiveJob(updatedJob);
              setMsg('Potongan gambar dari PDF berhasil diperbarui.');
            }}
          />
        )}

        {editingQuestion && editCropIdx !== null && (() => {
          const list =
            editingQuestion.assets && editingQuestion.assets.length > 0
              ? editingQuestion.assets
              : editingQuestion.image_url
              ? [{ asset_url: editingQuestion.image_url, asset_type: 'manual' as const, display_order: 0 }]
              : [];
          const target = list[editCropIdx];
          if (!target) return null;
          return (
            <VisualCropModal
              mode="standalone_image"
              imageUrl={target.asset_url}
              title={`Crop Manual Gambar (${editingQuestion.external_code})`}
              initialCropBox={target.crop_box}
              onClose={() => setEditCropIdx(null)}
              onStandaloneCropped={(res) => {
                const next = list.map((x, idx) =>
                  idx === editCropIdx
                    ? { ...x, asset_url: res.asset_url, asset_type: 'cropped' as const, crop_box: res.crop_box }
                    : x
                );
                setEditingQuestion({
                  ...editingQuestion,
                  assets: next,
                  image_url: next[0]?.asset_url || null,
                });
                setMsg('Gambar berhasil di-crop. Simpan perubahan untuk menerapkan.');
              }}
            />
          );
        })()}

        {showManualModal && (
          <ManualQuestionModal
            onClose={() => setShowManualModal(false)}
            onCreated={async (message) => {
              setMsg(message);
              await loadQuestions();
            }}
          />
        )}
      </div>
    </div>
  );
}
