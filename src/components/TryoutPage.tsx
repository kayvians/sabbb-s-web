import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Flag, PauseCircle, Play } from 'lucide-react';
import { apiFetch } from '../utils/api';
import type { PageRoute, QuestionAsset, QuestionOption, ScoringConfig, SessionImpactFlag, TryoutPackage, User } from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { MathContent } from './MathContent';
import { ReportQuestionModal } from './ReportQuestionModal';

interface TryoutPageProps {
  user: User;
  packages: TryoutPackage[];
  scoringConfig: ScoringConfig;
  initialPackageId?: number | null;
  onRefreshPackages: () => Promise<void>;
  onRefreshDashboard: () => Promise<void>;
  onNavigate: (page: PageRoute) => void;
  onHeaderBadge: (badge: string | undefined) => void;
  onExecutionChange?: (executing: boolean) => void;
}

interface SessionQuestion {
  id: number;
  external_code: string;
  subtest: string;
  topic: string;
  difficulty: string;
  question_type: string;
  question_text: string;
  image_url: string | null;
  assets?: QuestionAsset[];
  visual_description?: string;
  options: QuestionOption[];
  correct_answer?: string[];
  explanation_text?: string;
  solution_text?: string;
  mastery: {
    isRaguActive: boolean;
    wasEverRagu: boolean;
    raguCount: number;
    status: string;
  };
}

interface SessionPayload {
  session: {
    id: number;
    package_id: number;
    mode: 'simulation' | 'staged';
    status: 'in_progress' | 'between_subtests' | 'completed';
    current_subtest_index: number;
    active_duration_seconds: number;
    raw_correct: number;
    raw_wrong: number;
    raw_blank: number;
    utbk_score: number | null;
    subtest_scores: Record<string, { correct: number; wrong: number; blank: number; total: number; score: number }>;
    impact_flag?: SessionImpactFlag;
  };
  package: { id: number; title: string; provider: string; description: string };
  subtests: Array<{
    id: number;
    subtest_code: string;
    subtest_name: string;
    duration_seconds: number;
    sort_order: number;
    question_count: number;
    state: { status: string; started_at: string | null; locked_at: string | null };
    questions: SessionQuestion[];
  }>;
  answers: Record<string, { selected: string[]; is_ragu: boolean }>;
  remaining_seconds: number;
}

export function TryoutPage({
  user,
  packages,
  scoringConfig,
  initialPackageId,
  onRefreshPackages,
  onRefreshDashboard,
  onNavigate,
  onHeaderBadge,
  onExecutionChange,
}: TryoutPageProps) {
  const [selectedPkg, setSelectedPkg] = useState<TryoutPackage | null>(
    () => (initialPackageId ? packages.find((p) => p.id === initialPackageId) || null : null)
  );
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessionData, setSessionData] = useState<SessionPayload | null>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [reviewSubtestIdx, setReviewSubtestIdx] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: number; code: string } | null>(null);

  const loadSession = useCallback(
    async (sid: number) => {
      try {
        const res = await apiFetch<SessionPayload>(`/api/tryout/sessions/${sid}`);
        setSessionData(res);
        setRemainingSec(res.remaining_seconds);
        onHeaderBadge(res.package.title);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat sesi Try Out.');
      }
    },
    [onHeaderBadge]
  );

  useEffect(() => {
    return () => {
      onHeaderBadge(undefined);
      onExecutionChange?.(false);
    };
  }, [onHeaderBadge, onExecutionChange]);

  const isActivelyExecuting = Boolean(activeSessionId && sessionData?.session.status === 'in_progress');
  useEffect(() => {
    onExecutionChange?.(isActivelyExecuting);
  }, [isActivelyExecuting, onExecutionChange]);

  // Server-authoritative countdown tick while in_progress
  useEffect(() => {
    if (!sessionData || sessionData.session.status !== 'in_progress') return;
    const timer = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          loadSession(sessionData.session.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionData, loadSession]);

  const handleStartSession = async (pkgId: number, mode: 'simulation' | 'staged') => {
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ session_id: number }>('/api/tryout/sessions/start', {
        method: 'POST',
        body: JSON.stringify({ package_id: pkgId, mode }),
      });
      setActiveSessionId(res.session_id);
      setCurrentQIndex(0);
      await loadSession(res.session_id);
      await onRefreshPackages();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memulai Try Out.');
    }
  };

  const handleSaveAnswer = async (
    subtestId: number,
    questionId: number,
    selected: string[],
    isRagu: boolean
  ) => {
    if (!sessionData) return;
    const key = `${subtestId}:${questionId}`;
    setSessionData((prev) =>
      prev
        ? {
            ...prev,
            answers: { ...prev.answers, [key]: { selected, is_ragu: isRagu } },
          }
        : prev
    );

    try {
      await apiFetch(`/api/tryout/sessions/${sessionData.session.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          subtest_id: subtestId,
          question_id: questionId,
          selected,
          is_ragu: isRagu,
        }),
      });
      setSaveNotice('Jawaban tersimpan otomatis');
      setTimeout(() => setSaveNotice(null), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Autosave gagal.');
    }
  };

  const handleFinishSubtest = async () => {
    if (!sessionData) return;
    try {
      await apiFetch(`/api/tryout/sessions/${sessionData.session.id}/finish-subtest`, {
        method: 'POST',
      });
      setCurrentQIndex(0);
      await loadSession(sessionData.session.id);
      await onRefreshPackages();
      await onRefreshDashboard();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyelesaikan subtest.');
    }
  };

  const handleContinueStaged = async () => {
    if (!sessionData) return;
    try {
      await apiFetch(`/api/tryout/sessions/${sessionData.session.id}/next-subtest`, {
        method: 'POST',
      });
      setCurrentQIndex(0);
      await loadSession(sessionData.session.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal melanjutkan subtest.');
    }
  };

  const handleConfirmUnderstood = async (questionId: number) => {
    if (!sessionData) return;
    await apiFetch(`/api/mastery/${questionId}/understand`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'tryout' }),
    });
    setSaveNotice('Konfirmasi pemahaman tersimpan (histori ragu tetap dipertahankan).');
    await loadSession(sessionData.session.id);
    await onRefreshDashboard();
  };

  const exitSessionView = () => {
    setActiveSessionId(null);
    setSessionData(null);
    onHeaderBadge(undefined);
    onExecutionChange?.(false);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ==========================================
  // VIEW 1: PACKAGE LIST (Standard Blue Canvas)
  // ==========================================
  if (!activeSessionId || !sessionData) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6 flex flex-col justify-between">
        <div className="max-w-6xl mx-auto w-full space-y-8">
          <FloatingBackButton onClick={() => onNavigate('dashboard')} />

          <div>
            <h2 className="font-display text-3xl font-extrabold uppercase tracking-wide">
              Pilih Paket Try Out
            </h2>
            <p className="text-sm text-sky-100/85 mt-1">
              Semua paket mendukung Mode Simulasi (sekali duduk tanpa jeda) maupun Mode Bertahap (istirahat setelah subtest selesai). Bank soal Try Out terpisah penuh dari Drilling.
            </p>
          </div>

          {errorMsg && (
            <div className="px-4 py-3 rounded-lg bg-red-500/25 border border-red-300/40 text-sm">{errorMsg}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {packages.map((pkg) => {
              const isSelected = selectedPkg?.id === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedPkg(pkg)}
                  className={`text-left p-6 rounded-2xl border-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#101B45] border-[#D5BF50] shadow-2xl scale-[1.01]'
                      : 'bg-[#0D4FA8]/65 dark:bg-[#111B3A] border-white/20 hover:border-white/50'
                  }`}
                >
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="font-display text-5xl font-extrabold text-white">TO</span>
                    <div className="leading-tight">
                      <span className="block text-base font-bold text-[#D5BF50]">{pkg.provider}</span>
                      <span className="block text-xs text-sky-100">{pkg.title}</span>
                    </div>
                  </div>
                  <p className="text-xs text-sky-100/85 line-clamp-2 mb-4">{pkg.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sky-200 border-t border-white/15 pt-3">
                    <span>{pkg.subtests.length} subtest</span>
                    <span>
                      {pkg.user_best_score !== null && pkg.user_best_score !== undefined
                        ? `Skor terbaik: ${pkg.user_best_score}`
                        : 'Belum dikerjakan'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedPkg && (
            <div className="bg-[#101B45] dark:bg-[#111B3A] rounded-2xl p-6 border border-[#D5BF50]/60 shadow-2xl space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-3xl font-extrabold text-[#D5BF50]">
                    {selectedPkg.title}
                  </h3>
                  <p className="text-sm text-sky-100/85 mt-1">{selectedPkg.description}</p>
                </div>
                <div className="text-xs text-sky-200">
                  Urutan subtest:{' '}
                  {selectedPkg.subtests
                    .map((s) => `${s.subtest_name} (${Math.round(s.duration_seconds / 60)}m)`)
                    .join(' → ')}
                </div>
              </div>

              {selectedPkg.user_active_session ? (
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-amber-500/15 border border-amber-400/50">
                  <div>
                    <p className="font-bold text-amber-300 text-sm">
                      Anda memiliki sesi aktif ({selectedPkg.user_active_session.mode === 'simulation' ? 'Mode Simulasi' : 'Mode Bertahap'})
                    </p>
                    <p className="text-xs text-sky-100 mt-0.5">
                      Timer berjalan konsisten berdasarkan waktu server. Lanjutkan sesi untuk menyelesaikan.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartSession(selectedPkg.id, selectedPkg.user_active_session!.mode)}
                    className="px-5 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4" /> Lanjutkan Sesi
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/15 flex flex-col justify-between gap-4">
                    <div>
                      <h4 className="font-display text-2xl font-bold text-white">
                        Mode Simulasi (Sekali Duduk)
                      </h4>
                      <p className="text-xs text-sky-100/85 mt-1 leading-relaxed">
                        Meniru kondisi UTBK asli: seluruh subtest dikerjakan berurutan tanpa jeda dan tanpa tombol pause.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartSession(selectedPkg.id, 'simulation')}
                      className="w-full py-2.5 rounded-xl bg-[#0757B8] hover:bg-[#0D4FA8] text-white font-bold text-sm cursor-pointer"
                    >
                      Mulai Mode Simulasi
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-white/5 border border-white/15 flex flex-col justify-between gap-4">
                    <div>
                      <h4 className="font-display text-2xl font-bold text-[#D5BF50]">
                        Mode Bertahap (Istirahat Antar Subtest)
                      </h4>
                      <p className="text-xs text-sky-100/85 mt-1 leading-relaxed">
                        Timer tetap berjalan selama subtest berlangsung. Anda boleh beristirahat setelah satu subtest selesai dan dikunci.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartSession(selectedPkg.id, 'staged')}
                      className="w-full py-2.5 rounded-xl bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] font-bold text-sm cursor-pointer"
                    >
                      Mulai Mode Bertahap
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="max-w-6xl mx-auto w-full flex items-center justify-between pt-8">
          <span className="font-display text-lg font-bold">{user.username}</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: BETWEEN SUBTESTS REST (Staged Mode)
  // ==========================================
  if (sessionData.session.status === 'between_subtests') {
    const nextSub = sessionData.subtests[sessionData.session.current_subtest_index];
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 py-6">
        <div className="max-w-xl mx-auto">
          <FloatingBackButton onClick={exitSessionView} label="PAKET TRYOUT" />
        </div>
        <div className="flex items-center justify-center py-6">
          <div className="max-w-xl w-full bg-[#101B45] rounded-2xl p-8 border border-[#D5BF50]/60 shadow-2xl space-y-6 text-center">
            <PauseCircle className="w-14 h-14 text-[#D5BF50] mx-auto" />
            <div>
              <h2 className="font-display text-3xl font-extrabold uppercase">Waktu Istirahat (Mode Bertahap)</h2>
              <p className="text-sm text-sky-100/85 mt-2">
                Subtest sebelumnya telah selesai dan dikunci permanen. Waktu istirahat tidak dihitung sebagai waktu aktif pengerjaan.
              </p>
            </div>

            <div className="text-left space-y-2 bg-white/5 rounded-xl p-4">
              {sessionData.subtests.map((st, idx) => (
                <div key={st.id} className="flex items-center justify-between text-sm">
                  <span>
                    {idx + 1}. {st.subtest_name}
                  </span>
                  <span
                    className={`text-xs font-bold uppercase ${
                      st.state.status === 'locked'
                        ? 'text-emerald-300'
                        : idx === sessionData.session.current_subtest_index
                        ? 'text-[#D5BF50]'
                        : 'text-slate-400'
                    }`}
                  >
                    {st.state.status === 'locked'
                      ? 'Selesai & Dikunci'
                      : idx === sessionData.session.current_subtest_index
                      ? 'Berikutnya'
                      : 'Menunggu'}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={exitSessionView}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-semibold cursor-pointer"
              >
                Simpan & Lanjutkan Nanti
              </button>
              {nextSub && (
                <button
                  type="button"
                  onClick={handleContinueStaged}
                  className="px-6 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer"
                >
                  Mulai {nextSub.subtest_name} ({Math.round(nextSub.duration_seconds / 60)} menit)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 3: RESULTS & PEMBAHASAN (Standard Canvas)
  // ==========================================
  if (sessionData.session.status === 'completed') {
    const revSub = sessionData.subtests[reviewSubtestIdx] || sessionData.subtests[0];
    const revQuestions = revSub?.questions || [];
    const activeQ = revQuestions[currentQIndex] || revQuestions[0];
    const ans = activeQ ? sessionData.answers[`${revSub.id}:${activeQ.id}`] : undefined;

    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <FloatingBackButton onClick={exitSessionView} label="PAKET TRYOUT" />

          {/* Result Summary Banner */}
          <div className="bg-[#101B45] rounded-2xl p-6 border border-[#D5BF50]/50 grid grid-cols-2 sm:grid-cols-5 gap-4 items-center">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs uppercase tracking-wider text-sky-200">Skor Try Out</p>
              <p className="font-display text-5xl font-extrabold text-[#D5BF50] font-mono-num">
                {sessionData.session.utbk_score}
              </p>
              <p className="text-[11px] text-sky-200/75">{scoringConfig.label}</p>
            </div>
            <div>
              <p className="text-xs text-sky-200">Benar</p>
              <p className="font-mono-num text-2xl font-bold text-emerald-300">{sessionData.session.raw_correct}</p>
            </div>
            <div>
              <p className="text-xs text-sky-200">Salah</p>
              <p className="font-mono-num text-2xl font-bold text-red-300">{sessionData.session.raw_wrong}</p>
            </div>
            <div>
              <p className="text-xs text-sky-200">Kosong</p>
              <p className="font-mono-num text-2xl font-bold text-slate-300">{sessionData.session.raw_blank}</p>
            </div>
            <div>
              <p className="text-xs text-sky-200">Waktu Aktif</p>
              <p className="font-mono-num text-2xl font-bold">
                {Math.floor(sessionData.session.active_duration_seconds / 60)}m{' '}
                {sessionData.session.active_duration_seconds % 60}s
              </p>
            </div>
          </div>

          {sessionData.session.impact_flag?.key_corrected && (
            <div
              data-testid="session-impact-banner"
              className="px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-400/60 text-xs text-amber-100 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-200 block">Catatan Snapshot Sesi Try Out</strong>
                <span>{sessionData.session.impact_flag.note}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {sessionData.subtests.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                onClick={() => {
                  setReviewSubtestIdx(idx);
                  setCurrentQIndex(0);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold cursor-pointer ${
                  idx === reviewSubtestIdx ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-[#101B45] text-white'
                }`}
              >
                {st.subtest_name}
              </button>
            ))}
          </div>

          {saveNotice && (
            <div className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/50 text-xs text-emerald-200">
              {saveNotice}
            </div>
          )}

          {activeQ && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-8 space-y-5 bg-[#0D4FA8]/50 dark:bg-[#111B3A] rounded-2xl p-6 border border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-2xl font-bold">
                    {revSub.subtest_name} — No. {currentQIndex + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReportTarget({ id: activeQ.id, code: activeQ.external_code })}
                      className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300" /> Laporkan Soal
                    </button>
                    {activeQ.mastery?.isRaguActive && (
                      <button
                        type="button"
                        onClick={() => handleConfirmUnderstood(activeQ.id)}
                        className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Saya Sudah Paham
                      </button>
                    )}
                  </div>
                </div>

                <MathContent text={activeQ.question_text} className="text-white text-base leading-relaxed" />

                {(() => {
                  const reviewAssets: QuestionAsset[] =
                    activeQ.assets && activeQ.assets.length > 0
                      ? [...activeQ.assets].sort((a, b) => a.display_order - b.display_order)
                      : activeQ.image_url
                      ? [{ asset_url: activeQ.image_url, asset_type: 'manual', display_order: 0 }]
                      : [];
                  if (reviewAssets.length === 0) return null;
                  return (
                    <div className="space-y-3">
                      {reviewAssets.map((asset, aIdx) => (
                        <figure
                          key={`${asset.asset_url}-${aIdx}`}
                          className="rounded-xl border border-white/25 bg-white p-2 inline-block max-w-full"
                        >
                          <img
                            src={asset.asset_url}
                            alt={asset.caption || `Ilustrasi soal ${activeQ.external_code} (${aIdx + 1})`}
                            referrerPolicy="no-referrer"
                            className="max-h-80 max-w-full rounded object-contain mx-auto"
                          />
                          {asset.caption && (
                            <figcaption className="mt-1 text-[11px] text-slate-600 text-center">
                              {asset.caption}
                            </figcaption>
                          )}
                        </figure>
                      ))}
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  {activeQ.options.map((opt) => {
                    const isUserSel = ans?.selected.includes(opt.key);
                    const isCorrectOpt = activeQ.correct_answer?.includes(opt.key);
                    return (
                      <div
                        key={opt.key}
                        className={`px-4 py-3 rounded-xl border text-sm flex items-start gap-3 ${
                          isCorrectOpt
                            ? 'bg-emerald-500/25 border-emerald-400 text-white'
                            : isUserSel
                            ? 'bg-red-500/25 border-red-400 text-white'
                            : 'bg-white/5 border-white/15 text-sky-100'
                        }`}
                      >
                        <span className="font-bold shrink-0">{opt.key}.</span>
                        <div className="flex-1">
                          <MathContent text={opt.content} className="text-inherit" />
                        </div>
                        {isCorrectOpt && <span className="text-xs font-bold text-emerald-300">Kunci</span>}
                        {isUserSel && !isCorrectOpt && <span className="text-xs font-bold text-red-300">Pilihanmu</span>}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-4 border-t border-white/20 space-y-2">
                  <h4 className="font-display text-xl font-bold text-[#D5BF50]">Pembahasan:</h4>
                  <MathContent
                    text={activeQ.explanation_text || 'Pembahasan belum tersedia.'}
                    className="text-sky-50 text-sm"
                  />
                  {activeQ.solution_text && (
                    <div className="mt-2 p-3 rounded-lg bg-[#101B45]/80 text-xs text-sky-100">
                      <strong className="block mb-1 text-[#D5BF50]">Langkah Penyelesaian:</strong>
                      <MathContent text={activeQ.solution_text} className="text-sky-100 text-xs" />
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-4 space-y-5 bg-[#0D4FA8]/50 dark:bg-[#111B3A] rounded-2xl p-6 border border-white/15">
                <h4 className="font-display text-2xl font-bold text-center">No.</h4>
                <div className="grid grid-cols-5 gap-2">
                  {revQuestions.map((q, idx) => {
                    const qAns = sessionData.answers[`${revSub.id}:${q.id}`];
                    const selected = qAns?.selected || [];
                    const correct = q.correct_answer || [];
                    const isCorrect =
                      selected.length > 0 &&
                      selected.length === correct.length &&
                      [...selected].sort().every((v, i) => v === [...correct].sort()[i]);
                    const isRagu = q.mastery?.isRaguActive || qAns?.is_ragu;

                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentQIndex(idx)}
                        className={`h-10 rounded-lg font-mono-num font-bold text-sm border-2 cursor-pointer ${
                          idx === currentQIndex ? 'ring-2 ring-white scale-105' : ''
                        } ${
                          isRagu
                            ? 'bg-amber-400 text-slate-950 border-amber-200'
                            : selected.length === 0
                            ? 'bg-white/80 text-slate-900 border-white'
                            : isCorrect
                            ? 'bg-emerald-500 text-white border-emerald-300'
                            : 'bg-red-500 text-white border-red-300'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1.5 text-xs pt-2 border-t border-white/15">
                  <div className="flex items-center justify-between">
                    <span>Benar</span>
                    <span className="w-6 h-3 rounded-full bg-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Salah</span>
                    <span className="w-6 h-3 rounded-full bg-red-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Ragu-ragu</span>
                    <span className="w-6 h-3 rounded-full bg-amber-400" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {reportTarget && (
          <ReportQuestionModal
            questionId={reportTarget.id}
            questionCode={reportTarget.code}
            sourceType="tryout"
            onClose={() => setReportTarget(null)}
            onSubmitted={(msg) => setSaveNotice(msg)}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // VIEW 4: ACTIVE EXECUTION (SWAPPED COLOR PALETTE)
  // Body: White (Light Mode) / Deep Navy #0D142E (Dark Mode)
  // TopNav Header: Swapped to Blue #0757B8 / #0A1128 via onExecutionChange
  // ==========================================
  const currentSubtest = sessionData.subtests[sessionData.session.current_subtest_index];
  const questions = currentSubtest?.questions || [];
  const activeQuestion = questions[currentQIndex] || questions[0];

  if (!currentSubtest || !activeQuestion) {
    return (
      <div className="p-8 text-center text-slate-900 dark:text-slate-100 bg-white dark:bg-[#0D142E] min-h-[calc(100vh-4rem)]">
        Memuat soal subtest...
      </div>
    );
  }

  const currentAnswer = sessionData.answers[`${currentSubtest.id}:${activeQuestion.id}`] || {
    selected: [],
    is_ragu: activeQuestion.mastery?.isRaguActive || false,
  };

  return (
    <div
      data-exam-body="swapped"
      className="min-h-[calc(100vh-4rem)] bg-white dark:bg-[#0D142E] text-slate-900 dark:text-slate-100 px-4 sm:px-8 lg:px-12 py-6 flex flex-col justify-between"
    >
      <div className="max-w-7xl mx-auto w-full space-y-5">
        <FloatingBackButton onClick={exitSessionView} label="BACK" variant="exam" />

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#0757B8] dark:text-sky-300">
              {currentSubtest.subtest_name}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {sessionData.session.mode === 'simulation' ? 'Mode Simulasi' : 'Mode Bertahap'} · Subtest{' '}
              {sessionData.session.current_subtest_index + 1} dari {sessionData.subtests.length}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {saveNotice && (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{saveNotice}</span>
            )}
            <div
              className={`px-4 py-2 rounded-xl font-mono-num text-xl font-bold flex items-center gap-2 border ${
                remainingSec <= 120
                  ? 'bg-red-50 dark:bg-red-950/60 border-red-400 text-red-700 dark:text-red-200'
                  : 'bg-[#F3F5F8] dark:bg-[#111B3A] border-[#0757B8]/40 dark:border-[#D5BF50]/50 text-[#0757B8] dark:text-[#D5BF50]'
              }`}
            >
              <Clock className="w-5 h-5" />
              <span>{formatTimer(remainingSec)}</span>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="px-4 py-2 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-300 text-xs text-red-700 dark:text-red-200">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Area: Question & Options */}
          <div className="lg:col-span-8 bg-[#F3F5F8] dark:bg-[#111B3A] rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-extrabold text-[#0757B8] dark:text-sky-300">
                No. {currentQIndex + 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  handleSaveAnswer(
                    currentSubtest.id,
                    activeQuestion.id,
                    currentAnswer.selected,
                    !currentAnswer.is_ragu
                  )
                }
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                  currentAnswer.is_ragu
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#23346B]'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                <span>{currentAnswer.is_ragu ? 'Ragu-ragu Aktif' : 'Tandai Ragu-ragu'}</span>
              </button>
            </div>

            <MathContent
              text={activeQuestion.question_text}
              className="text-slate-900 dark:text-slate-100 text-base sm:text-lg leading-relaxed"
            />

            {(() => {
              const execAssets: QuestionAsset[] =
                activeQuestion.assets && activeQuestion.assets.length > 0
                  ? [...activeQuestion.assets].sort((a, b) => a.display_order - b.display_order)
                  : activeQuestion.image_url
                  ? [{ asset_url: activeQuestion.image_url, asset_type: 'manual', display_order: 0 }]
                  : [];

              if (execAssets.length > 0) {
                return (
                  <div className="space-y-3">
                    {execAssets.map((asset, aIdx) => (
                      <figure
                        key={`${asset.asset_url}-${aIdx}`}
                        className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white p-2 inline-block max-w-full"
                      >
                        <img
                          src={asset.asset_url}
                          alt={asset.caption || `Ilustrasi soal ${activeQuestion.external_code} (${aIdx + 1})`}
                          referrerPolicy="no-referrer"
                          className="max-h-80 max-w-full rounded object-contain mx-auto"
                        />
                        {asset.caption && (
                          <figcaption className="mt-1 text-[11px] text-slate-600 text-center">
                            {asset.caption}
                          </figcaption>
                        )}
                      </figure>
                    ))}
                  </div>
                );
              }

              if (activeQuestion.visual_description) {
                return (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200">
                    <strong>Catatan Ilustrasi:</strong> {activeQuestion.visual_description}
                  </div>
                );
              }
              return null;
            })()}

            <div className="space-y-2.5 pt-2">
              {activeQuestion.options.map((opt) => {
                const isSelected = currentAnswer.selected.includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      handleSaveAnswer(currentSubtest.id, activeQuestion.id, [opt.key], currentAnswer.is_ragu)
                    }
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-[#0757B8] dark:bg-[#D5BF50] text-white dark:text-[#101B45] border-[#0757B8] dark:border-[#D5BF50] font-semibold shadow-sm'
                        : 'bg-white dark:bg-[#192650] hover:border-[#0757B8] text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <span className="font-bold shrink-0">{opt.key}.</span>
                    <div className="flex-1">
                      <MathContent text={opt.content} className="text-inherit" />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentQIndex === 0}
                  onClick={() => setCurrentQIndex((i) => Math.max(0, i - 1))}
                  className="px-4 py-2 rounded-lg bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-[#23346B] disabled:opacity-40 text-sm font-semibold cursor-pointer"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={currentQIndex >= questions.length - 1}
                  onClick={() => setCurrentQIndex((i) => Math.min(questions.length - 1, i + 1))}
                  className="px-4 py-2 rounded-lg bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-[#23346B] disabled:opacity-40 text-sm font-semibold cursor-pointer"
                >
                  Berikutnya
                </button>
              </div>

              <button
                type="button"
                onClick={handleFinishSubtest}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer"
              >
                {sessionData.session.current_subtest_index + 1 >= sessionData.subtests.length
                  ? 'Selesaikan Try Out'
                  : 'Selesaikan Subtest Ini'}
              </button>
            </div>
          </div>

          {/* Right Area: Question Number Grid + Legend */}
          <div className="lg:col-span-4 bg-[#F3F5F8] dark:bg-[#111B3A] rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
            <h3 className="font-display text-2xl font-extrabold text-center text-[#0757B8] dark:text-sky-300">No.</h3>

            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const a = sessionData.answers[`${currentSubtest.id}:${q.id}`];
                const isRagu = Boolean(a?.is_ragu);
                const isAnswered = Boolean(a && a.selected.length > 0);

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentQIndex(idx)}
                    className={`h-10 rounded-lg font-mono-num font-bold text-sm border-2 cursor-pointer transition-transform ${
                      idx === currentQIndex ? 'ring-2 ring-[#0757B8] dark:ring-[#D5BF50] scale-105' : ''
                    } ${
                      isRagu
                        ? 'bg-amber-400 text-slate-950 border-amber-500'
                        : isAnswered
                        ? 'bg-emerald-600 text-white border-emerald-500'
                        : 'bg-white dark:bg-[#192650] text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 text-xs pt-3 border-t border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              <div className="flex items-center justify-between">
                <span>Ragu (prioritas tetap tampil)</span>
                <span className="w-6 h-3 rounded-full bg-amber-400 border border-amber-500" />
              </div>
              <div className="flex items-center justify-between">
                <span>Terjawab</span>
                <span className="w-6 h-3 rounded-full bg-emerald-600" />
              </div>
              <div className="flex items-center justify-between">
                <span>Belum dijawab</span>
                <span className="w-6 h-3 rounded-full bg-white dark:bg-[#192650] border border-slate-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full flex items-center justify-between pt-6 text-sm text-slate-600 dark:text-slate-300">
        <span className="font-display text-lg font-bold text-[#0757B8] dark:text-sky-300">{user.username}</span>
        {sessionData.session.mode === 'staged' && (
          <span className="text-xs">Istirahat tersedia setelah subtest ini dikunci.</span>
        )}
      </div>
    </div>
  );
}
