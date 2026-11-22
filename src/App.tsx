import { useCallback, useEffect, useState } from 'react';
import { apiFetch, parseJsonResponse, setSessionFallbackToken } from './utils/api';
import type {
  CountdownEvent,
  DwuSchedule,
  MasteryRecord,
  PageRoute,
  ScoringConfig,
  SiteAssetConfig,
  StudyTarget,
  ThemeSettings,
  TryoutCarouselCard,
  TryoutPackage,
  User,
  VisualAssets,
} from './types';
import { LandingPage } from './components/LandingPage';
import { TopNav } from './components/TopNav';
import { DashboardPage } from './components/DashboardPage';
import { ProfilePage } from './components/ProfilePage';
import { TryoutPage } from './components/TryoutPage';
import { LatsolPage } from './components/LatsolPage';
import { LeaderboardPage } from './components/LeaderboardPage';
import {
  DwuReviewPage,
  LibraryPage,
  QuestionBankPage,
  QuestionFeedbackPage,
} from './components/CommunityPages';
import { AdminPage } from './components/AdminPage';

interface BootstrapPayload {
  serverNow: string;
  theme: ThemeSettings;
  visualAssets: VisualAssets;
  siteAssets?: SiteAssetConfig[];
  carouselCards?: TryoutCarouselCard[];
  scoringConfig: ScoringConfig;
  activeCountdown: CountdownEvent | null;
  topRanks: Array<{ rank: number; username: string; utbkScore: number }>;
}

interface AuthStatusPayload {
  user: User | null;
  discordConfigured: boolean;
  previewAccounts: Array<{
    id: number;
    discord_id: string;
    username: string;
    role: string;
    target_score: number;
  }>;
  callbackUrl: string;
  allCallbackUrls?: string[];
}

interface DashboardPayload {
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
  dwuSchedules: DwuSchedule[];
}

export default function App() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ganesha_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [authStatus, setAuthStatus] = useState<AuthStatusPayload | null>(null);
  const [packages, setPackages] = useState<TryoutPackage[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardPayload | null>(null);
  const [currentPage, setCurrentPage] = useState<PageRoute>('dashboard');
  const [selectedTryoutPkgId, setSelectedTryoutPkgId] = useState<number | null>(null);
  const [headerBadge, setHeaderBadge] = useState<string | undefined>(undefined);
  const [isTryoutExecuting, setIsTryoutExecuting] = useState(false);
  const [isLatsolExecuting, setIsLatsolExecuting] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('ganesha_theme', isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  useEffect(() => {
    if (!bootstrap?.theme) return;
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', bootstrap.theme.primaryColor);
    root.style.setProperty('--brand-secondary', bootstrap.theme.secondaryColor);
    root.style.setProperty('--brand-accent', bootstrap.theme.accentColor);
  }, [bootstrap?.theme]);

  const loadBootstrap = useCallback(async () => {
    const data = await apiFetch<BootstrapPayload>('/api/bootstrap');
    setBootstrap(data);
    const serverMs = new Date(data.serverNow).getTime();
    if (!Number.isNaN(serverMs)) {
      setServerOffsetMs(serverMs - Date.now());
    }
  }, []);

  const loadAuthenticatedData = useCallback(async () => {
    const [pkgs, dash] = await Promise.all([
      apiFetch<TryoutPackage[]>('/api/tryout/packages'),
      apiFetch<DashboardPayload>('/api/dashboard'),
    ]);
    setPackages(pkgs);
    setDashboardData(dash);
  }, []);

  const refreshAuthAndData = useCallback(async () => {
    const status = await apiFetch<AuthStatusPayload>('/api/auth/status');
    setAuthStatus(status);
    if (status.user) {
      await loadAuthenticatedData();
    } else {
      setPackages([]);
      setDashboardData(null);
    }
  }, [loadAuthenticatedData]);

  const runInitialLoad = useCallback(async () => {
    setInitializing(true);
    setInitError(null);
    try {
      await Promise.all([loadBootstrap(), refreshAuthAndData()]);
    } catch (err) {
      setInitError(
        err instanceof Error ? err.message : 'Gagal terhubung ke server Ganesha Circle.'
      );
    } finally {
      setInitializing(false);
    }
  }, [loadBootstrap, refreshAuthAndData]);

  useEffect(() => {
    void runInitialLoad();
  }, [runInitialLoad]);

  const handleOAuthSuccess = useCallback(
    async (handoffToken?: string) => {
      setSessionNotice(null);
      if (handoffToken) {
        const handoffResp = await fetch('/api/auth/handoff', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handoffToken }),
        });
        const handoffData = await parseJsonResponse<{ user?: User; sessionToken?: string; error?: string }>(
          handoffResp,
          'Gagal menukar token sesi OAuth'
        );

        let status = await apiFetch<AuthStatusPayload>('/api/auth/status');
        if (!status.user && handoffData.sessionToken) {
          // Browser blocked iframe cookies (even CHIPS Partitioned) -> use tab-scoped sessionStorage fallback
          setSessionFallbackToken(handoffData.sessionToken);
          status = await apiFetch<AuthStatusPayload>('/api/auth/status');
        }

        if (!status.user) {
          throw new Error('Login Discord berhasil tetapi sesi gagal dimuat. Silakan coba muat ulang halaman.');
        }

        setAuthStatus(status);
        await loadAuthenticatedData();
        return;
      }

      await refreshAuthAndData();
    },
    [loadAuthenticatedData, refreshAuthAndData]
  );

  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      const detail = (ev as CustomEvent<{ message?: string }>).detail;
      setSessionFallbackToken(null);
      setAuthStatus((prev) => (prev ? { ...prev, user: null } : prev));
      setPackages([]);
      setDashboardData(null);
      setIsTryoutExecuting(false);
      setIsLatsolExecuting(false);
      setSelectedTryoutPkgId(null);
      setCurrentPage('dashboard');
      setSessionNotice(
        detail?.message || 'Sesi Anda telah diakhiri. Silakan login kembali melalui Discord.'
      );
    };
    window.addEventListener('ganesha:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ganesha:unauthorized', onUnauthorized);
  }, []);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session state cleanly even if network drops temporarily
    }
    setSessionFallbackToken(null);
    setAuthStatus((prev) => (prev ? { ...prev, user: null } : prev));
    setPackages([]);
    setDashboardData(null);
    setCurrentPage('dashboard');
    setIsTryoutExecuting(false);
    setIsLatsolExecuting(false);
    setSelectedTryoutPkgId(null);
    setSessionNotice(null);
    try {
      await refreshAuthAndData();
    } catch {
      // Keep local signed-out state if server is briefly restarting
    }
  };

  const navigateTo = useCallback((p: PageRoute) => {
    if (p !== 'tryout') {
      setSelectedTryoutPkgId(null);
      setIsTryoutExecuting(false);
    }
    if (p !== 'latsol') {
      setIsLatsolExecuting(false);
    }
    setCurrentPage(p);
  }, []);

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#101B45] text-white flex items-center justify-center font-display text-2xl tracking-wider">
        MEMUAT GANESHA CIRCLE...
      </div>
    );
  }

  if (!bootstrap || !authStatus) {
    return (
      <div className="min-h-screen bg-[#101B45] text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-display text-2xl tracking-wider text-[#D5BF50]">KONEKSI TERPUTUS SEMENTARA</p>
        <p className="text-sm text-sky-200 max-w-md">
          {initError || 'Server sedang memulai ulang atau jaringan tidak stabil.'}
        </p>
        <button
          type="button"
          onClick={() => void runInitialLoad()}
          className="px-5 py-2.5 rounded-xl bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] font-bold text-sm cursor-pointer"
        >
          Muat Ulang
        </button>
      </div>
    );
  }

  if (!authStatus.user) {
    return (
      <LandingPage
        activeCountdown={bootstrap.activeCountdown}
        serverOffsetMs={serverOffsetMs}
        visualAssets={bootstrap.visualAssets}
        siteAssets={bootstrap.siteAssets}
        discordConfigured={authStatus.discordConfigured}
        previewAccounts={authStatus.previewAccounts}
        callbackUrl={authStatus.callbackUrl}
        allCallbackUrls={authStatus.allCallbackUrls}
        sessionNotice={sessionNotice}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onAuthSuccess={handleOAuthSuccess}
      />
    );
  }

  const user = authStatus.user;
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const isExamExecution =
    (currentPage === 'tryout' && isTryoutExecuting) || (currentPage === 'latsol' && isLatsolExecuting);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav
        currentPage={currentPage}
        onNavigate={navigateTo}
        user={user}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onLogout={handleLogout}
        visualAssets={bootstrap.visualAssets}
        siteAssets={bootstrap.siteAssets}
        headerBadge={headerBadge}
        isExamExecution={isExamExecution}
      />

      <main className="flex-1">
        {currentPage === 'dashboard' && (
          <DashboardPage
            user={user}
            activeCountdown={bootstrap.activeCountdown}
            serverOffsetMs={serverOffsetMs}
            theme={bootstrap.theme}
            visualAssets={bootstrap.visualAssets}
            siteAssets={bootstrap.siteAssets}
            carouselCards={bootstrap.carouselCards || []}
            topRanks={bootstrap.topRanks}
            packages={packages}
            dashboardData={dashboardData}
            onNavigate={navigateTo}
            onSelectPackage={(pkgId) => {
              setSelectedTryoutPkgId(pkgId);
              navigateTo('tryout');
            }}
          />
        )}

        {currentPage === 'profile' && (
          <ProfilePage
            user={user}
            packages={packages}
            siteAssets={bootstrap.siteAssets}
            dashboardData={dashboardData}
            onRefresh={refreshAuthAndData}
            onNavigate={navigateTo}
          />
        )}

        {currentPage === 'tryout' && (
          <TryoutPage
            user={user}
            packages={packages}
            scoringConfig={bootstrap.scoringConfig}
            initialPackageId={selectedTryoutPkgId}
            onRefreshPackages={async () => {
              const pkgs = await apiFetch<TryoutPackage[]>('/api/tryout/packages');
              setPackages(pkgs);
            }}
            onRefreshDashboard={async () => {
              await Promise.all([loadBootstrap(), loadAuthenticatedData()]);
            }}
            onNavigate={navigateTo}
            onHeaderBadge={setHeaderBadge}
            onExecutionChange={setIsTryoutExecuting}
          />
        )}

        {currentPage === 'latsol' && (
          <LatsolPage
            user={user}
            onRefreshDashboard={loadAuthenticatedData}
            onNavigate={navigateTo}
            onExecutionChange={setIsLatsolExecuting}
          />
        )}

        {currentPage === 'leaderboard' && <LeaderboardPage user={user} onNavigate={navigateTo} />}

        {currentPage === 'library' && (
          <LibraryPage
            user={user}
            visualAssets={bootstrap.visualAssets}
            siteAssets={bootstrap.siteAssets}
            onNavigate={navigateTo}
          />
        )}

        {currentPage === 'dwu' && <DwuReviewPage user={user} onNavigate={navigateTo} />}

        {currentPage === 'feedback' && <QuestionFeedbackPage user={user} onNavigate={navigateTo} />}

        {currentPage === 'bank' && <QuestionBankPage user={user} onNavigate={navigateTo} />}

        {currentPage === 'admin' && isAdmin && (
          <AdminPage
            user={user}
            theme={bootstrap.theme}
            visualAssets={bootstrap.visualAssets}
            scoringConfig={bootstrap.scoringConfig}
            packages={packages}
            onRefreshBootstrap={loadBootstrap}
            onRefreshPackages={async () => {
              const pkgs = await apiFetch<TryoutPackage[]>('/api/tryout/packages');
              setPackages(pkgs);
            }}
            onNavigate={navigateTo}
          />
        )}
      </main>
    </div>
  );
}
