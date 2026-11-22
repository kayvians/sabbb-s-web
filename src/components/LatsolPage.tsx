import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Flag, Gamepad2, Layers, RotateCcw, Shuffle } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { SUBTESTS, type PageRoute, type QuestionAsset, type QuestionOption, type User } from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { MathContent } from './MathContent';
import { ReportQuestionModal } from './ReportQuestionModal';

interface LatsolPageProps {
  user: User;
  onRefreshDashboard: () => Promise<void>;
  onNavigate: (page: PageRoute) => void;
  onExecutionChange?: (executing: boolean) => void;
}

interface CatalogTreeItem {
  subtest: string;
  totalQuestions: number;
  topics: Array<{
    topic: string;
    totalQuestions: number;
    subtopics: Array<{ subtopic: string; count: number }>;
  }>;
}

interface CatalogResponse {
  catalog: Array<{ subtest: string; topic: string; question_count: number }>;
  tree?: CatalogTreeItem[];
  totalPublished?: number;
  history: Array<{
    id: number;
    subtest: string;
    topic: string;
    mode: string;
    started_at: string;
    status: string;
    answered_count: number;
    correct_count: number | null;
  }>;
}

interface DrillQuestion {
  id: number;
  external_code: string;
  subtest: string;
  topic: string;
  subtopic?: string;
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

interface DrillSessionPayload {
  session: {
    id: number;
    subtest: string;
    topic: string;
    mode: string;
    show_instant_explanation: boolean;
    status: 'in_progress' | 'completed';
  };
  questions: DrillQuestion[];
  answers: Record<number, { selected: string[]; is_correct: boolean; is_ragu: boolean; answered_at: string }>;
}

export function LatsolPage({ user, onRefreshDashboard, onNavigate, onExecutionChange }: LatsolPageProps) {
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null);
  const [drillTab, setDrillTab] = useState<'by_topic' | 'random'>('by_topic');
  const [randomSubtest, setRandomSubtest] = useState<string>('ALL');
  const [questionCount, setQuestionCount] = useState(10);
  const [showInstant, setShowInstant] = useState(true);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionData, setSessionData] = useState<DrillSessionPayload | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: number; code: string } | null>(null);

  const loadCatalog = useCallback(async () => {
    const res = await apiFetch<CatalogResponse>('/api/drill/catalog');
    setCatalogData(res);
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const loadSession = useCallback(async (sid: number) => {
    const res = await apiFetch<DrillSessionPayload>(`/api/drill/sessions/${sid}`);
    setSessionData(res);
  }, []);

  const isExecuting = Boolean(sessionId && sessionData);
  useEffect(() => {
    onExecutionChange?.(isExecuting);
    return () => onExecutionChange?.(false);
  }, [isExecuting, onExecutionChange]);

  const handleStartDrill = async (opts: { subtest: string; topic: string; subtopic?: string; mode: string }) => {
    setError(null);
    try {
      const res = await apiFetch<{ session_id: number }>('/api/drill/sessions/start', {
        method: 'POST',
        body: JSON.stringify({
          subtest: opts.subtest,
          topic: opts.topic,
          subtopic: opts.subtopic || 'ALL',
          mode: opts.mode,
          count: questionCount,
          show_instant_explanation: showInstant,
        }),
      });
      setSessionId(res.session_id);
      setCurrentIdx(0);
      await loadSession(res.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulai Latsol.');
    }
  };

  const handleAnswer = async (questionId: number, selected: string[], isRagu: boolean) => {
    if (!sessionData) return;
    await apiFetch(`/api/drill/sessions/${sessionData.session.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: questionId, selected, is_ragu: isRagu }),
    });
    await loadSession(sessionData.session.id);
    await onRefreshDashboard();
  };

  const handleFinishSession = async () => {
    if (!sessionData) return;
    await apiFetch(`/api/drill/sessions/${sessionData.session.id}/finish`, { method: 'POST' });
    await loadSession(sessionData.session.id);
    await loadCatalog();
    await onRefreshDashboard();
  };

  const handleUnderstand = async (questionId: number) => {
    if (!sessionData) return;
    await apiFetch(`/api/mastery/${questionId}/understand`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'drill' }),
    });
    setNotice('Ditandai sudah paham; histori bahwa soal pernah diragukan tetap terjaga.');
    await loadSession(sessionData.session.id);
    await onRefreshDashboard();
  };

  const exitExecution = () => {
    setSessionId(null);
    setSessionData(null);
    onExecutionChange?.(false);
  };

  // ==========================================
  // VIEW 1: LATSOL SELECTION (Drilling per Materi vs Soal Acak)
  // ==========================================
  if (!sessionId || !sessionData) {
    const tree: CatalogTreeItem[] =
      catalogData?.tree && catalogData.tree.length > 0
        ? catalogData.tree
        : Object.entries(
            (catalogData?.catalog || []).reduce<Record<string, Array<{ topic: string; question_count: number }>>>(
              (acc, item) => {
                if (!acc[item.subtest]) acc[item.subtest] = [];
                acc[item.subtest].push({ topic: item.topic, question_count: item.question_count });
                return acc;
              },
              {}
            )
          ).map(([subtest, items]) => ({
            subtest,
            totalQuestions: items.reduce((s, t) => s + t.question_count, 0),
            topics: items.map((t) => ({ topic: t.topic, totalQuestions: t.question_count, subtopics: [] })),
          }));

    const totalPublished = catalogData?.totalPublished ?? tree.reduce((s, t) => s + t.totalQuestions, 0);

    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6 flex flex-col justify-between">
        <div className="max-w-6xl mx-auto w-full space-y-8">
          <FloatingBackButton onClick={() => onNavigate('dashboard')} />

          {/* Header & Primary Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl sm:text-4xl font-extrabold uppercase tracking-wide">
                Drilling Latsol Terpadu
              </h2>
              <p className="text-sm text-sky-100/85">
                Seluruh soal drilling dari upload per materi maupun soal acak tersimpan dalam satu bank soal terpadu ({totalPublished} soal siap dikerjakan).
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDrillTab('by_topic')}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer ${
                  drillTab === 'by_topic'
                    ? 'bg-[#D5BF50] text-[#101B45]'
                    : 'bg-[#101B45] text-white hover:bg-[#14244F]'
                }`}
              >
                <Layers className="w-4 h-4" /> Drilling Berdasarkan Materi
              </button>
              <button
                type="button"
                onClick={() => setDrillTab('random')}
                className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer ${
                  drillTab === 'random'
                    ? 'bg-[#D5BF50] text-[#101B45]'
                    : 'bg-[#101B45] text-white hover:bg-[#14244F]'
                }`}
              >
                <Shuffle className="w-4 h-4" /> Drilling Soal Acak
              </button>
            </div>
          </div>

          {/* Controls Strip */}
          <div className="bg-[#101B45]/90 rounded-2xl p-5 border border-white/15 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-xs font-semibold flex items-center gap-2">
                <span>Jumlah Soal:</span>
                <select
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="bg-[#0757B8] border border-white/25 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                >
                  {[5, 10, 15, 20, 30, 40].map((n) => (
                    <option key={n} value={n}>
                      {n} soal
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-semibold flex items-center gap-2">
                <span>Pembahasan:</span>
                <select
                  value={showInstant ? 'instant' : 'end'}
                  onChange={(e) => setShowInstant(e.target.value === 'instant')}
                  className="bg-[#0757B8] border border-white/25 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                >
                  <option value="instant">Langsung setelah menjawab</option>
                  <option value="end">Di akhir sesi drilling</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleStartDrill({ subtest: 'ALL', topic: 'ALL', mode: 'random' })}
                className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5" /> Acak Semua Materi
              </button>
              <button
                type="button"
                onClick={() => handleStartDrill({ subtest: 'ALL', topic: 'ALL', mode: 'retry_ragu_wrong' })}
                className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Ulangi Soal Ragu / Salah
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/25 border border-red-300/50 text-sm">{error}</div>
          )}

          {/* Mode A: Drilling Berdasarkan Materi (Subtest -> Materi -> Submateri) */}
          {drillTab === 'by_topic' && (
            <div className="space-y-8">
              {tree.map((sub) => (
                <section key={sub.subtest} className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-[#101B45] border-2 border-[#D5BF50] flex items-center justify-center shrink-0">
                        <Gamepad2 className="w-7 h-7 text-[#D5BF50]" />
                      </div>
                      <div>
                        <h3 className="font-display text-3xl sm:text-4xl font-extrabold tracking-wide uppercase">
                          LATSOL - {sub.subtest}
                        </h3>
                        <p className="text-xs text-sky-200">{sub.totalQuestions} soal tersedia pada subtest ini</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStartDrill({ subtest: sub.subtest, topic: 'ALL', mode: 'random' })}
                      className="px-3.5 py-2 rounded-lg bg-[#101B45] hover:bg-[#14244F] border border-[#D5BF50]/50 text-xs font-bold text-[#D5BF50] cursor-pointer"
                    >
                      Acak Subtest Ini
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pl-2 sm:pl-6">
                    {sub.topics.map((t) => (
                      <div
                        key={t.topic}
                        className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-2xl p-4 border border-white/15 flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="font-display text-2xl font-extrabold tracking-wide uppercase">
                              {t.topic}
                            </h4>
                            <span className="text-xs font-mono-num text-[#D5BF50] font-bold shrink-0">
                              {t.totalQuestions} soal
                            </span>
                          </div>

                          {t.subtopics.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {t.subtopics.map((st) => (
                                <button
                                  key={st.subtopic}
                                  type="button"
                                  onClick={() =>
                                    handleStartDrill({
                                      subtest: sub.subtest,
                                      topic: t.topic,
                                      subtopic: st.subtopic,
                                      mode: 'topic',
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-[#D5BF50] hover:text-[#101B45] text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  {st.subtopic} ({st.count})
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleStartDrill({ subtest: sub.subtest, topic: t.topic, mode: 'topic' })}
                          className="pixel-btn w-full py-2 font-display text-xl font-bold tracking-wide cursor-pointer"
                        >
                          Start
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Mode B: Drilling Soal Acak */}
          {drillTab === 'random' && (
            <div className="bg-[#101B45]/90 rounded-2xl p-6 sm:p-8 border border-[#D5BF50]/50 space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#0757B8] border border-[#D5BF50] flex items-center justify-center shrink-0">
                  <Shuffle className="w-6 h-6 text-[#D5BF50]" />
                </div>
                <div>
                  <h3 className="font-display text-3xl font-extrabold uppercase text-[#D5BF50]">
                    Mode Soal Acak (Campuran Bank Soal Terpadu)
                  </h3>
                  <p className="text-sm text-sky-100/85 mt-1">
                    Soal diambil secara acak dari seluruh bank soal terpadu (termasuk soal yang diimpor dari PDF per materi maupun PDF acak). Pilih filter subtest atau acak seluruh materi.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-sky-200 mb-1.5">
                    Cakupan Subtest
                  </label>
                  <select
                    value={randomSubtest}
                    onChange={(e) => setRandomSubtest(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0757B8] border border-white/25 text-sm font-semibold"
                  >
                    <option value="ALL">Semua Subtest ({totalPublished} soal)</option>
                    {SUBTESTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleStartDrill({ subtest: randomSubtest, topic: 'ALL', mode: 'random' })}
                    className="pixel-btn flex-1 py-2.5 px-6 font-display text-2xl font-extrabold tracking-wider cursor-pointer"
                  >
                    MULAI SOAL ACAK ({questionCount} SOAL)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Riwayat Drilling */}
          {catalogData && catalogData.history.length > 0 && (
            <section className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15">
              <h3 className="font-display text-2xl font-bold uppercase mb-3 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#D5BF50]" /> Riwayat Drilling Terakhir
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-sky-200 border-b border-white/15">
                      <th className="py-2 pr-3">Subtest / Topik</th>
                      <th className="py-2 pr-3">Skor</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {catalogData.history.slice(0, 6).map((h) => (
                      <tr key={h.id}>
                        <td className="py-2 pr-3 font-medium">
                          {h.subtest} · {h.topic}
                        </td>
                        <td className="py-2 pr-3 font-mono-num">
                          {h.correct_count || 0} / {h.answered_count}
                        </td>
                        <td className="py-2 pr-3 text-xs uppercase">{h.status}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSessionId(h.id);
                              setCurrentIdx(0);
                              loadSession(h.id);
                            }}
                            className="text-xs font-bold text-[#D5BF50] hover:underline cursor-pointer"
                          >
                            Buka Pembahasan
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="max-w-6xl mx-auto w-full flex items-center justify-between pt-8">
          <span className="font-display text-lg font-bold">{user.username}</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: DRILLING EXECUTION & PEMBAHASAN (SWAPPED COLOR PALETTE)
  // Body: White (Light Mode) / Deep Navy #0D142E (Dark Mode)
  // TopNav Header: Swapped to Blue #0757B8 / #0A1128 via onExecutionChange
  // ==========================================
  const questions = sessionData.questions;
  const activeQ = questions[currentIdx] || questions[0];
  if (!activeQ) return null;

  const ans = sessionData.answers[activeQ.id];
  const isCompleted = sessionData.session.status === 'completed';
  const showSolution = isCompleted || (sessionData.session.show_instant_explanation && Boolean(ans?.selected.length));
  const isRagu = ans?.is_ragu ?? activeQ.mastery?.isRaguActive ?? false;

  return (
    <div
      data-exam-body="swapped"
      className="min-h-[calc(100vh-4rem)] bg-white dark:bg-[#0D142E] text-slate-900 dark:text-slate-100 px-4 sm:px-8 lg:px-12 py-6 flex flex-col justify-between"
    >
      <div className="max-w-7xl mx-auto w-full space-y-5">
        <FloatingBackButton onClick={exitExecution} label="BACK" variant="exam" />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#0757B8] dark:text-sky-300">
              {activeQ.subtest} · {activeQ.topic}
              {activeQ.subtopic ? ` (${activeQ.subtopic})` : ''}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Progres: {Object.keys(sessionData.answers).length} dari {questions.length} soal dijawab
            </p>
          </div>

          {!isCompleted && (
            <button
              type="button"
              onClick={handleFinishSession}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer"
            >
              Selesaikan Sesi Latsol
            </button>
          )}
        </div>

        {notice && (
          <div className="px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-800 dark:text-emerald-200">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Question + Pembahasan */}
          <div className="lg:col-span-8 bg-[#F3F5F8] dark:bg-[#111B3A] rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-2xl font-extrabold text-[#0757B8] dark:text-sky-300">
                No. {currentIdx + 1}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAnswer(activeQ.id, ans?.selected || [], !isRagu)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                    isRagu
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#23346B]'
                  }`}
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>{isRagu ? 'Ragu-ragu Aktif' : 'Tandai Ragu-ragu'}</span>
                </button>

                {activeQ.mastery?.isRaguActive && (
                  <button
                    type="button"
                    onClick={() => handleUnderstand(activeQ.id)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Saya Sudah Paham
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setReportTarget({ id: activeQ.id, code: activeQ.external_code })}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-[#23346B] text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Laporkan
                </button>
              </div>
            </div>

            <MathContent
              text={activeQ.question_text}
              className="text-slate-900 dark:text-slate-100 text-base sm:text-lg leading-relaxed"
            />

            {(() => {
              const questionAssets: QuestionAsset[] =
                activeQ.assets && activeQ.assets.length > 0
                  ? [...activeQ.assets].sort((a, b) => a.display_order - b.display_order)
                  : activeQ.image_url
                  ? [{ asset_url: activeQ.image_url, asset_type: 'manual', display_order: 0 }]
                  : [];

              if (questionAssets.length > 0) {
                return (
                  <div className="space-y-3">
                    {questionAssets.map((asset, aIdx) => (
                      <figure
                        key={`${asset.asset_url}-${aIdx}`}
                        className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white p-2 inline-block max-w-full"
                      >
                        <img
                          src={asset.asset_url}
                          alt={asset.caption || `Ilustrasi soal ${activeQ.external_code} (${aIdx + 1})`}
                          referrerPolicy="no-referrer"
                          className="max-h-80 max-w-full rounded object-contain mx-auto"
                        />
                        {asset.caption && (
                          <figcaption className="mt-1.5 text-[11px] text-slate-600 text-center">
                            {asset.caption}
                          </figcaption>
                        )}
                      </figure>
                    ))}
                  </div>
                );
              }

              if (activeQ.visual_description) {
                return (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200">
                    <strong>Catatan Ilustrasi:</strong> {activeQ.visual_description}
                  </div>
                );
              }
              return null;
            })()}

            <div className="space-y-2.5">
              {activeQ.options.map((opt) => {
                const isSel = ans?.selected.includes(opt.key);
                const isCorrectOpt = showSolution && activeQ.correct_answer?.includes(opt.key);
                const isWrongSel = showSolution && isSel && !isCorrectOpt;

                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={isCompleted}
                    onClick={() => handleAnswer(activeQ.id, [opt.key], isRagu)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                      isCorrectOpt
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-950 dark:text-emerald-100 font-semibold'
                        : isWrongSel
                        ? 'bg-red-50 dark:bg-red-950/60 border-red-500 text-red-950 dark:text-red-100 font-semibold'
                        : isSel
                        ? 'bg-[#0757B8] dark:bg-[#D5BF50] text-white dark:text-[#101B45] border-[#0757B8] dark:border-[#D5BF50] font-semibold'
                        : 'bg-white dark:bg-[#192650] hover:border-[#0757B8] text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <span className="font-bold shrink-0">{opt.key}.</span>
                    <div className="flex-1">
                      <MathContent text={opt.content} className="text-inherit" />
                    </div>
                    {isCorrectOpt && (
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Benar</span>
                    )}
                  </button>
                );
              })}
            </div>

            {showSolution && (
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 bg-white dark:bg-[#0A1128] rounded-xl p-4">
                <h4 className="font-display text-xl font-extrabold text-[#0757B8] dark:text-[#D5BF50]">
                  Pembahasan:
                </h4>
                <MathContent
                  text={activeQ.explanation_text || 'Pembahasan belum tersedia.'}
                  className="text-slate-800 dark:text-slate-100 text-sm"
                />
                {activeQ.solution_text && (
                  <div className="p-3 rounded-lg bg-[#F3F5F8] dark:bg-[#111B3A] border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200">
                    <strong className="block mb-1 text-[#0757B8] dark:text-[#D5BF50]">Langkah Penyelesaian:</strong>
                    <MathContent text={activeQ.solution_text} className="text-inherit text-xs" />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="px-4 py-2 rounded-lg bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-[#23346B] disabled:opacity-40 text-sm font-semibold cursor-pointer"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                disabled={currentIdx >= questions.length - 1}
                onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                className="px-4 py-2 rounded-lg bg-white dark:bg-[#192650] border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-[#23346B] disabled:opacity-40 text-sm font-semibold cursor-pointer"
              >
                Berikutnya
              </button>
            </div>
          </div>

          {/* Right: Question Grid & Legend */}
          <div className="lg:col-span-4 bg-[#F3F5F8] dark:bg-[#111B3A] rounded-2xl p-6 border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
            <h3 className="font-display text-2xl font-extrabold text-center text-[#0757B8] dark:text-sky-300">No.</h3>

            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const qAns = sessionData.answers[q.id];
                const qRagu = qAns?.is_ragu || q.mastery?.isRaguActive;
                const qRev = isCompleted || (sessionData.session.show_instant_explanation && Boolean(qAns?.selected.length));

                let colorCls =
                  'bg-white dark:bg-[#192650] text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600';
                if (qRagu) {
                  colorCls = 'bg-amber-400 text-slate-950 border-amber-500';
                } else if (qRev && qAns?.selected.length) {
                  colorCls = qAns.is_correct
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-red-600 text-white border-red-500';
                } else if (qAns?.selected.length) {
                  colorCls = 'bg-emerald-600 text-white border-emerald-500';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-10 rounded-lg font-mono-num font-bold text-sm border-2 cursor-pointer ${
                      idx === currentIdx ? 'ring-2 ring-[#0757B8] dark:ring-[#D5BF50] scale-105' : ''
                    } ${colorCls}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5 text-xs pt-2 border-t border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              <div className="flex items-center justify-between">
                <span>Ragu</span>
                <span className="w-6 h-3 rounded-full bg-amber-400 border border-amber-500" />
              </div>
              <div className="flex items-center justify-between">
                <span>Terjawab / Benar</span>
                <span className="w-6 h-3 rounded-full bg-emerald-600" />
              </div>
              <div className="flex items-center justify-between">
                <span>Salah</span>
                <span className="w-6 h-3 rounded-full bg-red-600" />
              </div>
              <div className="flex items-center justify-between">
                <span>Belum dijawab</span>
                <span className="w-6 h-3 rounded-full bg-white dark:bg-[#192650] border border-slate-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {reportTarget && (
        <ReportQuestionModal
          questionId={reportTarget.id}
          questionCode={reportTarget.code}
          sourceType="drill"
          onClose={() => setReportTarget(null)}
          onSubmitted={(msg) => setNotice(msg)}
        />
      )}
    </div>
  );
}
