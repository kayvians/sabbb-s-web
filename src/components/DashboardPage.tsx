import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Compass, FolderKanban, GraduationCap, Sparkles } from 'lucide-react';
import { computeCountdownParts, filterCarouselCardsForPackages } from '../lib/utbkLogic';
import type {
  CountdownEvent,
  DwuSchedule,
  PageRoute,
  SiteAssetConfig,
  ThemeSettings,
  TryoutCarouselCard,
  TryoutPackage,
  User,
  VisualAssets,
} from '../types';
import { SiteAssetImage, findSiteAsset } from './SiteAssetImage';
import { TryoutScoreChart } from './ScoreCharts';

interface DashboardPageProps {
  user: User;
  activeCountdown: CountdownEvent | null;
  serverOffsetMs: number;
  theme: ThemeSettings;
  visualAssets: VisualAssets;
  siteAssets?: SiteAssetConfig[];
  carouselCards?: TryoutCarouselCard[];
  topRanks: Array<{ rank: number; username: string; utbkScore: number }>;
  packages: TryoutPackage[];
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
    };
    dwuSchedules: DwuSchedule[];
  } | null;
  onNavigate: (page: PageRoute) => void;
  onSelectPackage: (pkgId: number) => void;
}

export function DashboardPage({
  user,
  activeCountdown,
  serverOffsetMs,
  theme,
  visualAssets,
  siteAssets,
  carouselCards = [],
  topRanks,
  packages,
  dashboardData,
  onNavigate,
  onSelectPackage,
}: DashboardPageProps) {
  const [nowMs, setNowMs] = useState(() => Date.now() + serverOffsetMs);
  const [pkgFilter, setPkgFilter] = useState<number | 'all'>('all');
  const [slideIdx, setSlideIdx] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [cardsPerSlide, setCardsPerSlide] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : 2
  );

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now() + serverOffsetMs), 1000);
    return () => clearInterval(timer);
  }, [serverOffsetMs]);

  useEffect(() => {
    const onResize = () => setCardsPerSlide(window.innerWidth < 768 ? 1 : 2);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const visibleCards = useMemo(
    () => filterCarouselCardsForPackages(carouselCards, packages, isAdmin),
    [carouselCards, packages, isAdmin]
  );

  const slides = useMemo(() => {
    const out: TryoutCarouselCard[][] = [];
    for (let i = 0; i < visibleCards.length; i += cardsPerSlide) {
      out.push(visibleCards.slice(i, i + cardsPerSlide));
    }
    return out;
  }, [visibleCards, cardsPerSlide]);

  useEffect(() => {
    if (slideIdx >= slides.length && slides.length > 0) {
      setSlideIdx(0);
    }
  }, [slides.length, slideIdx]);

  useEffect(() => {
    if (slides.length <= 1 || carouselPaused) return;
    const interval = setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % slides.length);
    }, 5500);
    return () => clearInterval(interval);
  }, [slides.length, carouselPaused]);

  const countdown = activeCountdown
    ? computeCountdownParts(activeCountdown.target_iso, nowMs)
    : { days: 150, hours: 24, minutes: 0, seconds: 0, isExpired: false };

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const displayPackages = packages.slice(0, 3);

  const initials = user.username.slice(0, 2).toUpperCase();
  const heroBanner = findSiteAsset(siteAssets, 'dashboardHeroBanner');
  const hasHeroImg = Boolean(heroBanner?.desktop_url || heroBanner?.mobile_url);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col bg-[#F3F5F8] dark:bg-[#0A1128]">
      {/* Page 2 Mockup Hero Banner */}
      <section
        className="relative px-4 sm:px-8 lg:px-12 py-7 text-white overflow-hidden"
        style={{
          background: `radial-gradient(circle at 20% 25%, ${theme.secondaryColor} 0%, #14244F 58%, #0C1533 100%)`,
        }}
      >
        {hasHeroImg && (
          <div className="pointer-events-none absolute inset-0 opacity-15">
            <SiteAssetImage
              slotKey="dashboardHeroBanner"
              siteAssets={siteAssets}
              fallbackUrl=""
              fallbackAlt="Banner Hero Dashboard"
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="relative z-10 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: GRAFIK TRY OUT window card matching Page 2 Gold frame */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl font-bold tracking-widest uppercase text-white">
                GRAFIK TRY OUT
              </h2>
              <select
                aria-label="Filter grafik berdasarkan paket try out"
                value={pkgFilter}
                onChange={(e) => setPkgFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-[#101B45]/90 border border-[#D5BF50]/50 text-xs text-white rounded-md px-2.5 py-1 focus:outline-none focus:border-[#D5BF50]"
              >
                <option value="all">Semua Paket</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border-4 border-[#D5BF50] bg-[#101B45]/85 p-3 shadow-lg">
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

            {/* Bottom-left user identity capsule */}
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="inline-flex items-center gap-3 self-start px-3.5 py-2 rounded-full bg-[#0757B8] hover:bg-[#0D4FA8] border border-white/25 transition-colors cursor-pointer"
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.username} className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="w-7 h-7 rounded-full bg-white text-[#0757B8] font-bold text-xs flex items-center justify-center">
                  {initials}
                </span>
              )}
              <span className="font-display text-lg font-bold tracking-wide uppercase">
                {user.username}
              </span>
            </button>
          </div>

          {/* Center: Vertical Countdown UTBK matching Page 2 Mockup */}
          <div className="lg:col-span-3 flex items-center justify-center py-2">
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-2 text-center font-mono-num">
                <div>
                  <span className="block text-[11px] text-sky-200 uppercase tracking-wider">Hari</span>
                  <span className="font-display text-4xl sm:text-5xl font-extrabold leading-none">
                    {countdown.days}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-sky-200 uppercase tracking-wider">Jam</span>
                  <span className="font-display text-4xl sm:text-5xl font-extrabold leading-none">
                    {pad2(countdown.hours)}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-sky-200 uppercase tracking-wider">Menit</span>
                  <span className="font-display text-4xl sm:text-5xl font-extrabold leading-none">
                    {pad2(countdown.minutes)}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-sky-200 uppercase tracking-wider">Detik</span>
                  <span className="font-display text-4xl sm:text-5xl font-extrabold leading-none">
                    {pad2(countdown.seconds)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center select-none">
                <span
                  className="font-display text-2xl tracking-[0.2em] text-white/90 font-semibold"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  countdown
                </span>
                <span
                  className="font-display text-2xl tracking-[0.15em] text-[#D5BF50] font-extrabold mt-2"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {activeCountdown?.title || 'UTBK'}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Top Ranks card matching Page 2 Mockup */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-white dark:bg-[#111B3A] text-[#0757B8] dark:text-white rounded-2xl p-4 shadow-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => onNavigate('leaderboard')}
                className="w-full rounded-xl bg-[#0757B8] text-white py-2 px-4 text-center mb-3 hover:bg-[#0D4FA8] transition-colors cursor-pointer"
              >
                <span className="block font-display text-2xl font-extrabold italic leading-none">
                  Top ranks
                </span>
                <span className="block text-[11px] tracking-wider opacity-90">of the tryout</span>
              </button>

              <ol className="space-y-2.5">
                {[1, 2, 3].map((rankNum) => {
                  const entry = topRanks.find((r) => r.rank === rankNum);
                  const medalColors =
                    rankNum === 1
                      ? 'bg-[#D5BF50] text-[#101B45]'
                      : rankNum === 2
                      ? 'bg-slate-300 text-slate-900'
                      : 'bg-amber-600 text-white';
                  return (
                    <li key={rankNum} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-7 h-7 rounded-full font-display font-extrabold text-sm flex items-center justify-center shrink-0 ${medalColors}`}
                        >
                          {rankNum}
                        </span>
                        <span className="font-display text-xl font-bold tracking-wide truncate">
                          {entry ? entry.username.toUpperCase() : `RANK #${rankNum}`}
                        </span>
                      </div>
                      <span className="font-mono-num text-sm font-bold text-slate-700 dark:text-amber-300">
                        {entry ? entry.utbkScore : '—'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>

        {/* Bottom row of Hero: Try Out package quick-launch matching Page 2 */}
        <div className="max-w-7xl mx-auto mt-6 pt-5 border-t border-white/15 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 sm:gap-10">
            {displayPackages.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => onSelectPackage(pkg.id)}
                className="flex items-baseline gap-1.5 text-left group cursor-pointer"
              >
                <span className="font-display text-3xl sm:text-4xl font-extrabold text-white group-hover:text-[#D5BF50] transition-colors">
                  TO
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-bold text-white group-hover:text-[#D5BF50] transition-colors">
                    {pkg.provider}
                  </span>
                  <span className="text-xs text-sky-200">{pkg.title.replace(/^TO\s+\S+\s*/i, '') || '#1 2027'}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('tryout')}
            className="text-sm font-semibold text-sky-200 hover:text-[#D5BF50] underline underline-offset-4 cursor-pointer"
          >
            Lihat semua paket →
          </button>
        </div>
      </section>

      {/* Page 2 Middle White Strip: 4 Feature Cards + Quote */}
      <section className="bg-white dark:bg-[#111B3A] border-y border-slate-200 dark:border-slate-800 px-4 sm:px-8 lg:px-12 py-7">
        <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-6 gap-4 items-center">
          <button
            type="button"
            onClick={() => onNavigate('library')}
            className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-[#F3F5F8] dark:bg-[#192650] hover:ring-2 hover:ring-[#0757B8] transition-all cursor-pointer"
          >
            <BookOpen className="w-8 h-8 text-[#0757B8] dark:text-[#D5BF50]" />
            <span className="font-display text-lg font-bold text-[#0757B8] dark:text-sky-200">Library</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('feedback')}
            className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-[#F3F5F8] dark:bg-[#192650] hover:ring-2 hover:ring-[#0757B8] transition-all cursor-pointer"
          >
            <Compass className="w-8 h-8 text-[#0757B8] dark:text-[#D5BF50]" />
            <span className="font-display text-lg font-bold text-[#0757B8] dark:text-sky-200 text-center leading-tight">
              Question Feedback
            </span>
          </button>

          <div className="col-span-2 text-center px-3 py-2 order-first lg:order-none">
            <blockquote className="text-base sm:text-lg font-medium text-slate-800 dark:text-slate-100 leading-snug">
              “{theme.quoteText}”
            </blockquote>
            <p className="mt-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400">
              - {theme.quoteAuthor}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('dwu')}
            className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-[#F3F5F8] dark:bg-[#192650] hover:ring-2 hover:ring-[#0757B8] transition-all cursor-pointer"
          >
            <GraduationCap className="w-8 h-8 text-[#0757B8] dark:text-[#D5BF50]" />
            <span className="font-display text-lg font-bold text-[#0757B8] dark:text-sky-200">DWU Review</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('bank')}
            className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-[#F3F5F8] dark:bg-[#192650] hover:ring-2 hover:ring-[#0757B8] transition-all cursor-pointer"
          >
            <FolderKanban className="w-8 h-8 text-[#0757B8] dark:text-[#D5BF50]" />
            <span className="font-display text-lg font-bold text-[#0757B8] dark:text-sky-200 text-center leading-tight">
              Question Bank
            </span>
          </button>
        </div>
      </section>

      {/* Dashboard User Try Out Card Carousel (Horizontal 1:1 Image + Info) */}
      {visibleCards.length > 0 && (
        <section
          data-testid="dashboard-tryout-carousel"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
          className="px-4 sm:px-8 lg:px-12 pt-7 max-w-7xl mx-auto w-full"
        >
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <div>
              <h3 className="font-display text-2xl font-extrabold uppercase tracking-wide text-[#0757B8] dark:text-[#D5BF50] flex items-center gap-2">
                <Sparkles className="w-5 h-5" /> Paket & Info Try Out
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Akses cepat paket Try Out aktif beserta status pengerjaan Anda.
              </p>
            </div>

            {slides.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Slide Tryout Sebelumnya"
                  onClick={() => setSlideIdx((prev) => (prev - 1 + slides.length) % slides.length)}
                  className="p-2 rounded-lg bg-white dark:bg-[#111B3A] border border-slate-200 dark:border-slate-700 text-[#0757B8] dark:text-sky-200 hover:border-[#0757B8] transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Slide Tryout Berikutnya"
                  onClick={() => setSlideIdx((prev) => (prev + 1) % slides.length)}
                  className="p-2 rounded-lg bg-white dark:bg-[#111B3A] border border-slate-200 dark:border-slate-700 text-[#0757B8] dark:text-sky-200 hover:border-[#0757B8] transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl">
            <div
              className="flex transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${slideIdx * 100}%)` }}
            >
              {slides.map((group, gIdx) => (
                <div
                  key={`slide-${gIdx}`}
                  className={`w-full shrink-0 grid gap-4 ${
                    cardsPerSlide === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {group.map((card) => {
                    const linkedPkg =
                      card.package_id != null ? packages.find((p) => p.id === card.package_id) : undefined;
                    const statusText = linkedPkg?.user_active_session
                      ? 'Sesi Berlangsung'
                      : linkedPkg?.user_best_score != null
                      ? `Skor Terbaik: ${linkedPkg.user_best_score}`
                      : card.status_label;

                    const handleCardAction = () => {
                      if (card.package_id != null) {
                        onSelectPackage(card.package_id);
                      } else {
                        const target = (card.cta_target || 'tryout') as PageRoute;
                        onNavigate(target);
                      }
                    };

                    return (
                      <article
                        key={card.id}
                        data-testid={`dashboard-carousel-card-${card.id}`}
                        className="h-[144px] sm:h-[164px] bg-white dark:bg-[#111B3A] rounded-2xl border border-slate-200 dark:border-slate-700/80 shadow-sm hover:shadow-md hover:border-[#0757B8]/50 dark:hover:border-[#D5BF50]/60 transition-all p-3 flex items-stretch gap-3.5 sm:gap-4 overflow-hidden"
                      >
                        {/* Left: Strictly 1:1 Square Image */}
                        <div className="h-full aspect-square shrink-0 rounded-xl overflow-hidden bg-[#0D4FA8] relative border border-slate-200 dark:border-slate-700">
                          <img
                            src={card.image_url || visualAssets.defaultPackageCover}
                            alt={card.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Right: Uniform Alignment & Package Info */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                          <div className="min-w-0">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                              <span className="text-[#0757B8] dark:text-[#D5BF50] uppercase tracking-wider truncate">
                                {card.package_label || linkedPkg?.provider || 'Try Out UTBK'}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-[#F3F5F8] dark:bg-[#192650] text-slate-700 dark:text-sky-200 shrink-0">
                                {statusText}
                              </span>
                            </div>
                            <h4 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white truncate mt-1">
                              {card.title}
                            </h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5 leading-snug">
                              {card.description}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {linkedPkg
                                ? `${linkedPkg.subtests.length} subtest`
                                : 'Siap dikerjakan'}
                            </span>
                            <button
                              type="button"
                              onClick={handleCardAction}
                              className="px-3.5 py-1.5 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] dark:bg-[#D5BF50] dark:hover:bg-amber-300 text-white dark:text-[#101B45] font-bold text-xs transition-colors cursor-pointer shrink-0"
                            >
                              {card.cta_label || 'Lihat Detail'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {slides.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {slides.map((_, idx) => (
                <button
                  key={`dot-${idx}`}
                  type="button"
                  aria-label={`Tampilkan slide tryout ${idx + 1}`}
                  onClick={() => setSlideIdx(idx)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    idx === slideIdx
                      ? 'w-6 bg-[#0757B8] dark:bg-[#D5BF50]'
                      : 'w-2 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Page 2 Bottom Two Dark Cards: Rekapan Bulanan & Jadwal DWU */}
      <section className="px-4 sm:px-8 lg:px-12 py-8 max-w-7xl mx-auto w-full grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left Card: Rekapan bulanan */}
        <div className="bg-[#0B0E17] text-white rounded-md p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">Rekapan bulanan</h3>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="text-xs font-semibold tracking-wider text-slate-300 hover:text-[#D5BF50] uppercase cursor-pointer"
              >
                SHOW ALL
              </button>
            </div>

            <dl className="space-y-3 text-base">
              <div className="flex items-center justify-between">
                <dt className="text-slate-300">Target Skor UTBK</dt>
                <dd className="font-mono-num font-bold text-[#D5BF50]">{user.target_score}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-300">Try out selesai</dt>
                <dd className="font-mono-num font-bold">{dashboardData?.stats.completedTryouts ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-300">Drill soal</dt>
                <dd className="font-mono-num font-bold">{dashboardData?.stats.drilledQuestions ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-300">Soal masih ragu</dt>
                <dd className="font-mono-num font-bold text-amber-300">
                  {dashboardData?.stats.activeRaguCount ?? 0}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
            <span className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#0757B8] text-xs font-bold uppercase tracking-wider">
              <span className="w-5 h-5 rounded-full bg-white text-[#0757B8] flex items-center justify-center font-bold">
                {initials}
              </span>
              <span>{user.username}</span>
            </span>
            <span className="text-xs text-slate-400">
              {dashboardData?.stats.understoodCount ?? 0} soal sudah dikuasai
            </span>
          </div>
        </div>

        {/* Right Card: Jadwal DWU */}
        <div className="bg-[#0B0E17] text-white rounded-md p-6 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">Jadwal DWU</h3>
              <button
                type="button"
                onClick={() => onNavigate('dwu')}
                className="text-xs font-semibold tracking-wider text-slate-300 hover:text-[#D5BF50] uppercase cursor-pointer"
              >
                SHOW ALL
              </button>
            </div>

            <ul className="space-y-3 text-base">
              {(dashboardData?.dwuSchedules || []).slice(0, 5).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-200">{item.subtest_label}</span>
                  <span className="font-mono-num text-sm text-slate-300">
                    {new Date(item.scheduled_date).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </li>
              ))}
              {(!dashboardData?.dwuSchedules || dashboardData.dwuSchedules.length === 0) && (
                <li className="text-sm text-slate-400">Belum ada jadwal DWU terdaftar.</li>
              )}
            </ul>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Evaluasi dua arah tutor & anggota</span>
            <button
              type="button"
              onClick={() => onNavigate('dwu')}
              className="text-[#D5BF50] hover:underline cursor-pointer"
            >
              Isi DWU Review →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
