import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Lock, Pencil, Plus, Shield, Trash2 } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { formatDurationMinutes } from '../lib/utbkLogic';
import type {
  MasteryRecord,
  PageRoute,
  SiteAssetConfig,
  StudyTarget,
  StudyTimeLog,
  StudyTimeSummary,
  TryoutPackage,
  User,
  UserPrivacySettings,
} from '../types';
import { SUBTESTS } from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { SiteAssetImage, findSiteAsset } from './SiteAssetImage';
import { StudyTimeChart, SubtestMasteryChart, TryoutScoreChart } from './ScoreCharts';

interface ProfilePageProps {
  user: User;
  packages: TryoutPackage[];
  siteAssets?: SiteAssetConfig[];
  dashboardData: {
    tryoutHistory: Array<{
      id: number;
      package_id: number;
      package_title: string;
      utbk_score: number;
      completed_at: string;
    }>;
    stats: {
      completedTryouts: number;
      drilledQuestions: number;
      drilledCorrect: number;
      activeRaguCount: number;
      understoodCount: number;
      lastActivity: { action: string; details: string; created_at: string } | null;
    };
    studyTargets: StudyTarget[];
    subtestMastery: Array<{ subtest: string; percentage: number | null }>;
    masteryRecords: MasteryRecord[];
  } | null;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageRoute) => void;
}

export function ProfilePage({ user, packages, siteAssets, dashboardData, onRefresh, onNavigate }: ProfilePageProps) {
  const [editingScore, setEditingScore] = useState(false);
  const [scoreInput, setScoreInput] = useState(String(user.target_score));
  const [pkgFilter, setPkgFilter] = useState<number | 'all'>('all');
  const [newTopic, setNewTopic] = useState('');
  const [newSubtest, setNewSubtest] = useState<string>(SUBTESTS[0]);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  // Study Time Tracker state
  const [studyView, setStudyView] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [studyLogs, setStudyLogs] = useState<StudyTimeLog[]>([]);
  const [studySummary, setStudySummary] = useState<StudyTimeSummary | null>(null);
  const [editingLogId, setEditingLogId] = useState<number | null>(null);
  const [studyDate, setStudyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [studyHours, setStudyHours] = useState('1');
  const [studyMinutes, setStudyMinutes] = useState('30');
  const [studyNote, setStudyNote] = useState('');
  const [savingStudy, setSavingStudy] = useState(false);

  // Privacy Settings state
  const [privacy, setPrivacy] = useState<UserPrivacySettings>({
    profile_visible: user.profile_visible !== false,
    show_tryout_stats: user.show_tryout_stats !== false,
    show_study_time: Boolean(user.show_study_time),
    show_subtest_mastery: Boolean(user.show_subtest_mastery),
    show_target_score: Boolean(user.show_target_score),
  });
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  const initials = user.username.slice(0, 2).toUpperCase();
  const profileBanner = findSiteAsset(siteAssets, 'profileBanner');

  const loadStudyTime = useCallback(async (view: 'daily' | 'weekly' | 'monthly') => {
    try {
      const res = await apiFetch<{ logs: StudyTimeLog[]; summary: StudyTimeSummary }>(
        `/api/profile/study-time?view=${view}`
      );
      setStudyLogs(res.logs);
      setStudySummary(res.summary);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    void loadStudyTime(studyView);
  }, [studyView, loadStudyTime]);

  useEffect(() => {
    setPrivacy({
      profile_visible: user.profile_visible !== false,
      show_tryout_stats: user.show_tryout_stats !== false,
      show_study_time: Boolean(user.show_study_time),
      show_subtest_mastery: Boolean(user.show_subtest_mastery),
      show_target_score: Boolean(user.show_target_score),
    });
  }, [user]);

  const handleSaveStudyLog = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalMins = (Math.max(0, Number(studyHours) || 0) * 60) + Math.max(0, Number(studyMinutes) || 0);
    if (totalMins <= 0 || totalMins > 1440) {
      setBusyMsg('Durasi belajar harus antara 1 menit hingga 24 jam.');
      return;
    }
    setSavingStudy(true);
    try {
      if (editingLogId) {
        await apiFetch(`/api/profile/study-time/${editingLogId}`, {
          method: 'PUT',
          body: JSON.stringify({
            study_date: studyDate,
            duration_minutes: Math.round(totalMins),
            note: studyNote.trim(),
          }),
        });
        setBusyMsg('Catatan waktu belajar diperbarui.');
      } else {
        await apiFetch('/api/profile/study-time', {
          method: 'POST',
          body: JSON.stringify({
            study_date: studyDate,
            duration_minutes: Math.round(totalMins),
            note: studyNote.trim(),
          }),
        });
        setBusyMsg('Waktu belajar ditambahkan.');
      }
      setEditingLogId(null);
      setStudyNote('');
      await loadStudyTime(studyView);
    } catch (err) {
      setBusyMsg(err instanceof Error ? err.message : 'Gagal menyimpan catatan waktu belajar.');
    } finally {
      setSavingStudy(false);
    }
  };

  const handleEditStudyLog = (log: StudyTimeLog) => {
    setEditingLogId(log.id);
    setStudyDate(log.study_date);
    setStudyHours(String(Math.floor(log.duration_minutes / 60)));
    setStudyMinutes(String(log.duration_minutes % 60));
    setStudyNote(log.note || '');
  };

  const handleDeleteStudyLog = async (id: number) => {
    try {
      await apiFetch(`/api/profile/study-time/${id}`, { method: 'DELETE' });
      if (editingLogId === id) setEditingLogId(null);
      setBusyMsg('Catatan waktu belajar dihapus.');
      await loadStudyTime(studyView);
    } catch (err) {
      setBusyMsg(err instanceof Error ? err.message : 'Gagal menghapus catatan waktu belajar.');
    }
  };

  const handleTogglePrivacy = async (key: keyof UserPrivacySettings) => {
    const next = { ...privacy, [key]: !privacy[key] };
    setPrivacy(next);
    setSavingPrivacy(true);
    try {
      const res = await apiFetch<{ privacy: UserPrivacySettings }>('/api/profile/privacy', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
      setPrivacy(res.privacy);
      setBusyMsg('Pengaturan privasi profil publik disimpan.');
      await onRefresh();
    } catch (err) {
      setBusyMsg(err instanceof Error ? err.message : 'Gagal memperbarui privasi profil.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSaveScore = async () => {
    const val = Number(scoreInput);
    if (!Number.isInteger(val) || val < 200 || val > 1000) {
      setBusyMsg('Target skor harus antara 200 dan 1000.');
      return;
    }
    try {
      await apiFetch('/api/profile/target-score', {
        method: 'PUT',
        body: JSON.stringify({ target_score: val }),
      });
      setEditingScore(false);
      setBusyMsg('Target skor UTBK diperbarui.');
      await onRefresh();
    } catch (err) {
      setBusyMsg(err instanceof Error ? err.message : 'Gagal memperbarui target skor.');
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopic.trim()) return;
    try {
      await apiFetch('/api/profile/study-targets', {
        method: 'POST',
        body: JSON.stringify({ topic: newTopic.trim(), subtest: newSubtest }),
      });
      setNewTopic('');
      await onRefresh();
    } catch (err) {
      setBusyMsg(err instanceof Error ? err.message : 'Gagal menambah PR materi.');
    }
  };

  const cycleTargetStatus = async (target: StudyTarget) => {
    const nextMap: Record<StudyTarget['status'], StudyTarget['status']> = {
      not_started: 'ongoing',
      ongoing: 'done',
      done: 'not_started',
    };
    await apiFetch(`/api/profile/study-targets/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextMap[target.status] }),
    });
    await onRefresh();
  };

  const handleDeleteTarget = async (id: number) => {
    await apiFetch(`/api/profile/study-targets/${id}`, { method: 'DELETE' });
    await onRefresh();
  };

  const handleUnderstand = async (questionId: number, sourceType: 'drill' | 'tryout' = 'drill') => {
    await apiFetch(`/api/mastery/${questionId}/understand`, {
      method: 'POST',
      body: JSON.stringify({ source_type: sourceType }),
    });
    setBusyMsg('Status pemahaman disimpan: Anda dinyatakan sudah paham, riwayat ragu tetap tercatat.');
    await onRefresh();
  };

  const statusLabel = (st: StudyTarget['status']) => {
    if (st === 'done') return 'Done';
    if (st === 'ongoing') return 'Ongoing';
    return 'Belum';
  };

  const statusClass = (st: StudyTarget['status']) => {
    if (st === 'done') return 'text-emerald-300 font-bold';
    if (st === 'ongoing') return 'text-[#D5BF50] font-bold';
    return 'text-slate-300';
  };

  const weakPrTopics = (dashboardData?.studyTargets || []).filter((t) => t.status !== 'done');
  const raguRecords = (dashboardData?.masteryRecords || []).filter((m) => m.is_ragu_active || m.was_ever_ragu);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        {busyMsg && (
          <div className="px-4 py-2.5 rounded-lg bg-[#101B45] border border-[#D5BF50]/50 text-sm text-[#D5BF50] flex items-center justify-between">
            <span>{busyMsg}</span>
            <button type="button" onClick={() => setBusyMsg(null)} className="text-xs underline cursor-pointer">
              Tutup
            </button>
          </div>
        )}

        {/* Horizontally Aligned Top Identity & Target Score Header Row */}
        <section
          data-testid="profile-identity-row"
          className="relative overflow-hidden rounded-2xl bg-[#101B45]/90 dark:bg-[#111B3A] border border-white/20 px-6 py-5 shadow-xl"
        >
          {Boolean(profileBanner?.desktop_url || profileBanner?.mobile_url) && (
            <div className="pointer-events-none absolute inset-0 opacity-15">
              <SiteAssetImage
                slotKey="profileBanner"
                siteAssets={siteAssets}
                fallbackUrl=""
                fallbackAlt="Banner Profil"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
              <div className="flex items-center gap-3.5 min-w-0">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.username}
                    className="w-14 h-14 rounded-full object-cover border-2 border-[#D5BF50] shrink-0"
                  />
                ) : (
                  <span className="w-14 h-14 rounded-full bg-white text-[#0757B8] text-lg font-extrabold flex items-center justify-center border-2 border-[#D5BF50] shrink-0">
                    {initials}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1
                      data-testid="profile-username"
                      className="font-display text-3xl sm:text-4xl font-extrabold tracking-wide text-white truncate"
                    >
                      {user.username}
                    </h1>
                    <span className="px-2.5 py-0.5 rounded-md bg-[#0757B8] text-[11px] font-bold uppercase tracking-wider text-sky-100">
                      {user.role.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-sky-200 mt-1">
                    Try Out selesai:{' '}
                    <strong className="font-mono-num text-white">{dashboardData?.stats.completedTryouts ?? 0}</strong> ·
                    Drilling:{' '}
                    <strong className="font-mono-num text-white">{dashboardData?.stats.drilledQuestions ?? 0}</strong> soal ·
                    Ragu aktif:{' '}
                    <strong className="font-mono-num text-[#D5BF50]">{dashboardData?.stats.activeRaguCount ?? 0}</strong>
                  </p>
                </div>
              </div>
            </div>

            <div
              data-testid="profile-target-score-block"
              className="flex items-center justify-between md:justify-end gap-4 pt-3 md:pt-0 border-t md:border-t-0 border-white/15 shrink-0"
            >
              <div className="md:text-right">
                <p className="font-display text-lg sm:text-xl font-extrabold tracking-widest uppercase text-sky-200">
                  TARGET SKOR
                </p>
                {!editingScore ? (
                  <div className="inline-flex items-center gap-3">
                    <span
                      data-testid="profile-target-score-value"
                      className="font-display text-5xl sm:text-6xl font-extrabold font-mono-num tracking-tight text-[#D5BF50] leading-none"
                    >
                      {user.target_score}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setScoreInput(String(user.target_score));
                        setEditingScore(true);
                      }}
                      aria-label="Ubah Target Skor"
                      className="p-2 rounded-lg bg-white/15 hover:bg-white/25 cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 mt-1">
                    <input
                      type="number"
                      min={200}
                      max={1000}
                      value={scoreInput}
                      onChange={(e) => setScoreInput(e.target.value)}
                      aria-label="Input target skor UTBK"
                      className="w-28 px-3 py-1.5 rounded-lg bg-[#0757B8] border border-[#D5BF50] text-white font-mono-num text-2xl font-bold"
                    />
                    <button
                      type="button"
                      onClick={handleSaveScore}
                      className="px-3 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-4 h-4" /> Simpan
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* TOP MAIN PROGRESS SECTION: PROGRESS WAKTU BELAJAR (STUDY TIME / TIME BLOCKING) */}
        <section
          data-testid="study-time-progress-section"
          className="bg-[#101B45]/95 dark:bg-[#111B3A] rounded-2xl p-6 border-2 border-[#D5BF50]/70 shadow-xl space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-wide uppercase flex items-center gap-2 text-[#D5BF50]">
                <Clock className="w-6 h-6" /> Progress Waktu Belajar
              </h2>
              <p className="text-xs text-sky-200 mt-0.5">
                Pantau konsistensi durasi belajar harian, mingguan, dan bulanan (terpisah dari indikator pemahaman subtest).
              </p>
            </div>

            <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl border border-white/15 text-xs">
              {([
                { id: 'daily', label: 'Harian' },
                { id: 'weekly', label: 'Mingguan' },
                { id: 'monthly', label: 'Bulanan' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStudyView(opt.id)}
                  className={`px-3.5 py-1.5 rounded-lg font-bold cursor-pointer transition-colors ${
                    studyView === opt.id ? 'bg-[#D5BF50] text-[#101B45]' : 'text-sky-100 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-wider text-sky-200">Total Jam Terakumulasi</p>
              <p className="font-display text-3xl font-extrabold font-mono-num text-[#D5BF50] mt-1">
                {formatDurationMinutes(studySummary?.totalAllTimeMinutes ?? 0)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-wider text-sky-200">
                {studyView === 'monthly' ? 'Bulan Ini' : 'Minggu Ini'}
              </p>
              <p className="font-display text-3xl font-extrabold font-mono-num text-white mt-1">
                {formatDurationMinutes(studySummary?.currentPeriodMinutes ?? 0)}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-wider text-sky-200">Perbandingan Periode Lalu</p>
              <p className="font-display text-2xl font-extrabold font-mono-num mt-1">
                {studySummary ? (
                  <span className={studySummary.deltaMinutes >= 0 ? 'text-emerald-300' : 'text-amber-300'}>
                    {studySummary.deltaMinutes >= 0 ? '+' : '-'}
                    {formatDurationMinutes(Math.abs(studySummary.deltaMinutes))}
                    {studySummary.deltaPercent !== null ? ` (${studySummary.deltaPercent > 0 ? '+' : ''}${studySummary.deltaPercent}%)` : ''}
                  </span>
                ) : (
                  '—'
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Study Time Chart */}
            <div className="lg:col-span-7 rounded-xl border border-white/15 bg-black/25 p-4">
              <StudyTimeChart buckets={studySummary?.buckets || []} view={studyView} />
            </div>

            {/* Right: Add / Edit Study Log Form + Recent Logs */}
            <div className="lg:col-span-5 space-y-4">
              <form onSubmit={handleSaveStudyLog} className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-bold text-white">
                    {editingLogId ? 'Edit Catatan Waktu Belajar' : 'Catat Sesi Belajar'}
                  </h3>
                  {editingLogId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingLogId(null);
                        setStudyNote('');
                      }}
                      className="text-sky-300 hover:underline cursor-pointer"
                    >
                      Batal Edit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-sky-200 block">Tanggal</span>
                    <input
                      type="date"
                      required
                      value={studyDate}
                      onChange={(e) => setStudyDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-white/20 font-mono-num"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sky-200 block">Jam</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={studyHours}
                      onChange={(e) => setStudyHours(e.target.value)}
                      aria-label="Durasi belajar jam"
                      className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-white/20 font-mono-num"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sky-200 block">Menit</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={studyMinutes}
                      onChange={(e) => setStudyMinutes(e.target.value)}
                      aria-label="Durasi belajar menit"
                      className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-white/20 font-mono-num"
                    />
                  </label>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={studyNote}
                    onChange={(e) => setStudyNote(e.target.value)}
                    placeholder="Catatan belajar (opsional, mis: Latihan PK Fungsi)"
                    className="flex-1 px-3 py-1.5 rounded bg-slate-900 border border-white/20"
                  />
                  <button
                    type="submit"
                    disabled={savingStudy}
                    className="px-4 py-1.5 rounded-lg bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {editingLogId ? 'Simpan' : 'Catat'}
                  </button>
                </div>
              </form>

              {studyLogs.length > 0 && (
                <div className="max-h-44 overflow-y-auto divide-y divide-white/10 rounded-xl bg-black/20 border border-white/10 px-3 text-xs">
                  {studyLogs.slice(0, 8).map((log) => (
                    <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono-num text-sky-200">{log.study_date}</span> ·{' '}
                        <strong className="font-mono-num text-[#D5BF50]">
                          {formatDurationMinutes(log.duration_minutes)}
                        </strong>
                        {log.note && <p className="text-white/75 truncate">{log.note}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEditStudyLog(log)}
                          aria-label={`Edit catatan belajar ${log.study_date}`}
                          className="p-1 text-white/60 hover:text-[#D5BF50] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStudyLog(log.id)}
                          aria-label={`Hapus catatan belajar ${log.study_date}`}
                          className="p-1 text-white/60 hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Middle Split: GRAFIK TRY OUT + PR MATERI */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-bold tracking-widest uppercase">GRAFIK TRY OUT</h2>
              <select
                aria-label="Filter grafik Try Out"
                value={pkgFilter}
                onChange={(e) => setPkgFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-[#101B45] border border-white/25 rounded-md px-2.5 py-1 text-xs"
              >
                <option value="all">Semua Paket</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 rounded-xl border-4 border-[#D5BF50] bg-[#101B45]/90 p-4 shadow-xl">
              <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[#D5BF50]/30">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
              </div>
              <TryoutScoreChart
                history={dashboardData?.tryoutHistory || []}
                selectedPackageId={pkgFilter}
                targetScore={user.target_score}
              />
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col">
            <div className="flex-1 bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-xl p-5 border border-white/15 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-2xl font-extrabold tracking-wide uppercase">PR MATERI</h3>
                  <span className="text-xs text-sky-100/80">Klik status untuk mengubah progres pribadi</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-sky-200 border-b border-white/15">
                        <th className="py-2 pr-3">MATERI</th>
                        <th className="py-2 pr-3">SUBTEST</th>
                        <th className="py-2 text-right">STATUS</th>
                        <th className="py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {(dashboardData?.studyTargets || []).map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 pr-3 font-medium">{item.topic}</td>
                          <td className="py-2.5 pr-3 text-xs text-sky-200">{item.subtest}</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => cycleTargetStatus(item)}
                              className={`text-sm hover:underline cursor-pointer ${statusClass(item.status)}`}
                            >
                              {statusLabel(item.status)}
                            </button>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteTarget(item.id)}
                              aria-label={`Hapus ${item.topic}`}
                              className="p-1 text-white/50 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <form onSubmit={handleAddTarget} className="mt-4 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="Tambah materi yang perlu dievaluasi..."
                  className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg bg-[#101B45] border border-white/20 text-sm text-white placeholder:text-sky-200/50"
                />
                <select
                  aria-label="Pilih subtest PR materi"
                  value={newSubtest}
                  onChange={(e) => setNewSubtest(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#101B45] border border-white/20 text-xs text-white"
                >
                  {SUBTESTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Tambah
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* SEPARATE SECTION: INDIKATOR PEMAHAMAN SUBTEST (NOT INFLATED BY STUDY HOURS) */}
        <section
          data-testid="subtest-mastery-section"
          className="pt-4 border-t border-white/15 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
        >
          <div className="lg:col-span-6 space-y-3">
            <div>
              <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-wide uppercase">
                INDIKATOR PEMAHAMAN SUBTEST
              </h3>
              <p className="text-xs text-sky-100/80">
                Dihitung murni dari aktivitas drilling soal, hasil try out, dan konfirmasi pemahaman pribadi (terpisah dari durasi jam belajar).
              </p>
            </div>

            <div className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-xl p-5 border border-white/15">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-sky-200 border-b border-white/15">
                    <th className="py-2">SUBTEST</th>
                    <th className="py-2 text-right">PERSENTASE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(dashboardData?.subtestMastery || []).map((row) => (
                    <tr key={row.subtest}>
                      <td className="py-2.5 font-medium">{row.subtest}</td>
                      <td className="py-2.5 text-right font-mono-num font-bold text-[#D5BF50]">
                        {row.percentage !== null ? `${row.percentage}%` : 'Belum ada data'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-3">
            <h3 className="font-display text-2xl font-bold tracking-widest uppercase text-center lg:text-left">
              GRAFIK PEMAHAMAN SUBTEST
            </h3>
            <div className="rounded-xl border-4 border-[#D5BF50] bg-[#101B45]/90 p-5 shadow-xl">
              <div className="flex items-center gap-1.5 mb-3 pb-1.5 border-b border-[#D5BF50]/30">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#D5BF50]" />
              </div>
              <SubtestMasteryChart items={dashboardData?.subtestMastery || []} />
            </div>

            {weakPrTopics.length > 0 && (
              <p className="text-xs text-sky-100">
                Materi paling perlu dievaluasi: <strong>{weakPrTopics.map((w) => w.topic).join(', ')}</strong>
              </p>
            )}
          </div>
        </section>

        {/* Riwayat Soal Ragu & Status Pemahaman Personal */}
        <section className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-xl p-5 border border-white/15">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="font-display text-2xl font-extrabold uppercase">
                Riwayat Soal Ragu & Pemahaman Pribadi
              </h3>
              <p className="text-xs text-sky-100/80">
                Penanda ragu tidak hilang otomatis walau dijawab benar. Tekan “Saya Sudah Paham” setelah benar-benar menguasai konsepnya; histori ragu tetap tersimpan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('latsol')}
              className="px-3.5 py-1.5 rounded-lg bg-[#D5BF50] text-[#101B45] text-xs font-bold cursor-pointer"
            >
              Latihan Ulang di Latsol
            </button>
          </div>

          {raguRecords.length === 0 ? (
            <p className="text-sm text-sky-100/80">Belum ada soal yang pernah ditandai ragu-ragu.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-sky-200 border-b border-white/15">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Subtest & Materi</th>
                    <th className="py-2 pr-3">Benar / Salah / Ragu</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {raguRecords.map((rec) => (
                    <tr key={`${rec.source_type || 'drill'}-${rec.question_id}`}>
                      <td className="py-2.5 pr-3 font-mono-num font-bold">
                        {rec.external_code}
                        <span className="block text-[10px] text-sky-200 uppercase">
                          {rec.source_type === 'tryout' ? 'Try Out' : 'Drilling'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="font-medium">{rec.subtest}</span> ·{' '}
                        <span className="text-sky-200">{rec.topic}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono-num text-xs">
                        {rec.correct_count}B / {rec.wrong_count}S / {rec.ragu_count}× Ragu
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-semibold">
                        {rec.is_ragu_active ? (
                          <span className="text-amber-300">Masih Ragu (Aktif)</span>
                        ) : (
                          <span className="text-emerald-300">
                            Sudah Paham (Pernah ragu {rec.ragu_count}×)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {rec.is_ragu_active ? (
                          <button
                            type="button"
                            onClick={() => handleUnderstand(rec.question_id, rec.source_type || 'drill')}
                            className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer"
                          >
                            Saya Sudah Paham
                          </button>
                        ) : (
                          <span className="text-xs text-sky-200/70">Terkonfirmasi</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* PUBLIC PROFILE PRIVACY CONTROLS */}
        <section
          data-testid="profile-privacy-section"
          className="bg-[#101B45]/90 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/20 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-2xl font-extrabold uppercase flex items-center gap-2 text-[#D5BF50]">
                <Shield className="w-5 h-5" /> Privasi Profil Publik (Leaderboard)
              </h3>
              <p className="text-xs text-sky-200">
                Atur data apa saja yang boleh dilihat anggota lain saat mengklik nama/avatar Anda di Leaderboard.
              </p>
            </div>
            {savingPrivacy && <span className="text-xs text-[#D5BF50]">Menyimpan...</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {([
              { key: 'profile_visible', label: 'Izinkan Profil Publik Dilihat' },
              { key: 'show_tryout_stats', label: 'Tampilkan Statistik Try Out' },
              { key: 'show_study_time', label: 'Tampilkan Akumulasi Jam Belajar' },
              { key: 'show_subtest_mastery', label: 'Tampilkan Pemahaman Subtest' },
              { key: 'show_target_score', label: 'Tampilkan Target Skor UTBK' },
            ] as const).map((item) => {
              const checked = privacy[item.key];
              const disabledByMaster = item.key !== 'profile_visible' && !privacy.profile_visible;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  disabled={savingPrivacy || disabledByMaster}
                  onClick={() => handleTogglePrivacy(item.key)}
                  className={`p-3 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer transition-colors disabled:opacity-45 ${
                    checked
                      ? 'bg-[#0757B8]/80 border-[#D5BF50]/70 text-white'
                      : 'bg-black/25 border-white/15 text-sky-200'
                  }`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    {!checked && <Lock className="w-3.5 h-3.5 opacity-70" />}
                    {item.label}
                  </span>
                  <span
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors flex items-center ${
                      checked ? 'bg-emerald-500 justify-end' : 'bg-slate-600 justify-start'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-white shadow" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
