import { useEffect, useState } from 'react';
import { Moon, Sun, Users, X } from 'lucide-react';
import { computeCountdownParts, isTrustedPostMessageOrigin } from '../lib/utbkLogic';
import { parseJsonResponse } from '../utils/api';
import type { CountdownEvent, SiteAssetConfig, VisualAssets } from '../types';
import { SiteAssetImage, findSiteAsset } from './SiteAssetImage';

interface PreviewAccount {
  id: number;
  discord_id: string;
  username: string;
  role: string;
  target_score: number;
}

interface LandingPageProps {
  activeCountdown: CountdownEvent | null;
  serverOffsetMs: number;
  visualAssets: VisualAssets;
  siteAssets?: SiteAssetConfig[];
  discordConfigured: boolean;
  previewAccounts: PreviewAccount[];
  callbackUrl: string;
  allCallbackUrls?: string[];
  sessionNotice?: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  onAuthSuccess: (handoffToken?: string) => Promise<void> | void;
}

export function LandingPage({
  activeCountdown,
  serverOffsetMs,
  visualAssets,
  siteAssets,
  discordConfigured,
  previewAccounts,
  callbackUrl,
  allCallbackUrls,
  sessionNotice,
  isDark,
  onToggleTheme,
  onAuthSuccess,
}: LandingPageProps) {
  const [nowMs, setNowMs] = useState(() => Date.now() + serverOffsetMs);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [oauthDiagnostic, setOauthDiagnostic] = useState<{ clientId?: string; redirectUri?: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now() + serverOffsetMs);
    }, 1000);
    return () => clearInterval(timer);
  }, [serverOffsetMs]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const trustedCallbacks = allCallbackUrls && allCallbackUrls.length > 0 ? allCallbackUrls : [callbackUrl];
      if (!isTrustedPostMessageOrigin(event.origin, window.location.origin, trustedCallbacks)) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setLoggingIn(true);
        setErrorMsg(null);
        try {
          const handoffToken = typeof event.data?.handoffToken === 'string' ? event.data.handoffToken : undefined;
          await onAuthSuccess(handoffToken);
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Gagal menyelesaikan sesi login Discord.');
        } finally {
          setLoggingIn(false);
        }
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setLoggingIn(false);
        setErrorMsg(String(event.data.message || 'Otorisasi Discord ditolak.'));
      }
    };
    const onMsg = (event: MessageEvent) => {
      void handleMessage(event);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onAuthSuccess, allCallbackUrls, callbackUrl]);

  const countdown = activeCountdown
    ? computeCountdownParts(activeCountdown.target_iso, nowMs)
    : { days: 150, hours: 24, minutes: 0, seconds: 0, isExpired: false };

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');

  const handleDiscordLogin = async () => {
    setErrorMsg(null);
    if (!discordConfigured) {
      setShowPreviewModal(true);
      return;
    }

    setLoggingIn(true);
    try {
      const currentOrigin =
        window.location.origin && /^https?:\/\//i.test(window.location.origin) ? window.location.origin : '';
      const query = currentOrigin ? `?origin=${encodeURIComponent(currentOrigin)}` : '';
      const resp = await fetch(`/api/auth/discord/url${query}`, { credentials: 'include' });
      const data = await parseJsonResponse<{ url?: string; redirectUri?: string; clientId?: string; error?: string }>(
        resp,
        'Gagal menyiapkan URL Discord OAuth'
      );
      if (!data.url) {
        throw new Error(data.error || 'Gagal menyiapkan URL Discord OAuth.');
      }
      setOauthDiagnostic({ clientId: data.clientId, redirectUri: data.redirectUri });
      const popup = window.open(data.url, 'discord_oauth_popup', 'width=540,height=720');
      if (!popup) {
        setErrorMsg('Popup diblokir browser. Izinkan popup untuk melanjutkan login Discord.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghubungi server Discord.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handlePreviewAccountLogin = async (discordId: string) => {
    setLoggingIn(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/auth/preview-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ discord_id: discordId }),
      });
      await parseJsonResponse(resp, 'Gagal masuk');
      setShowPreviewModal(false);
      onAuthSuccess();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal masuk.');
    } finally {
      setLoggingIn(false);
    }
  };

  const bgAsset = findSiteAsset(siteAssets, 'landingBackground');
  const hasCustomBg = Boolean(bgAsset?.desktop_url || bgAsset?.mobile_url);
  const callbacksToDisplay = allCallbackUrls && allCallbackUrls.length > 0 ? allCallbackUrls : [callbackUrl];
  const alertMessage = errorMsg || sessionNotice;

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#192856] dark:bg-[#0B122B] text-white flex flex-col justify-between p-6 sm:p-10 md:p-14">
      {hasCustomBg && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-20">
          <SiteAssetImage
            slotKey="landingBackground"
            siteAssets={siteAssets}
            fallbackUrl=""
            fallbackAlt="Latar Landing Ganesha Circle"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Top Row: Gold Emblem (top-left) + Community Banner & Switch Mode (top-right) */}
      <div className="relative z-10 flex flex-col md:flex-row items-start justify-between gap-8">
        <div className="flex items-center gap-4">
          {/* Original geometric academic seal inspired by gold crest aesthetic */}
          <div className="w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 120 126" className="w-full h-full text-[#D5BF50]" aria-label="Lambang Komunitas Ganesha Circle">
              <circle cx="60" cy="54" r="45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" />
              <circle cx="60" cy="54" r="36" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M60 20 L70 39 L90 43 L75 58 L79 79 L60 69 L41 79 L45 58 L30 43 L50 39 Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M46 56 Q60 47 74 56 M49 63 Q60 57 71 63" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <text x="60" y="116" textAnchor="middle" fill="currentColor" fontSize="9.5" fontWeight="700" letterSpacing="1.8">
                GANESHA CIRCLE
              </text>
            </svg>
          </div>
          <div>
            <p className="font-display text-lg tracking-widest text-[#D5BF50] uppercase">Komunitas Belajar UTBK</p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              GANESHA CIRCLE
            </h1>
          </div>
        </div>

        <div className="flex items-start gap-4 self-end md:self-auto">
          <div className="w-64 sm:w-80 md:w-96 aspect-video rounded-md overflow-hidden border-2 border-white/25 shadow-2xl bg-[#101B45]">
            <SiteAssetImage
              slotKey="landingBanner"
              siteAssets={siteAssets}
              fallbackUrl={visualAssets.landingBanner}
              fallbackAlt="Banner Komunitas Belajar"
              className="w-full h-full object-cover"
            />
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Switch Mode"
            className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 transition-colors cursor-pointer shrink-0"
            title="Switch Mode"
          >
            {isDark ? <Sun className="w-5 h-5 text-[#D5BF50]" /> : <Moon className="w-5 h-5 text-white" />}
          </button>
        </div>
      </div>

      {/* Center-Left Login & Glassmorphic Countdown */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 items-center gap-8 my-auto py-8">
        <div className="lg:col-span-6 flex flex-col items-start gap-4 lg:pl-8">
          <button
            type="button"
            onClick={handleDiscordLogin}
            disabled={loggingIn}
            className="group flex items-center gap-4 focus-visible:outline-2 focus-visible:outline-[#D5BF50] cursor-pointer disabled:opacity-70"
          >
            <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#5865F2] group-hover:bg-[#4752C4] transition-transform group-hover:scale-105 flex items-center justify-center shadow-xl shrink-0">
              <svg viewBox="0 0 24 24" className="w-9 h-9 sm:w-11 sm:h-11 fill-white" aria-hidden="true">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </span>
            <span className="font-display text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-wide text-[#9AA8FF] group-hover:text-white transition-colors text-left">
              LOGIN WITH DISCORD
            </span>
          </button>

          <p className="text-sm text-sky-100/80 max-w-md">
            Eksklusif untuk anggota server Discord komunitas. Try Out, Latsol PDF AI, Leaderboard, DWU Review, dan Bank Soal terpadu.
          </p>

          {alertMessage && (
            <div role="alert" className="px-4 py-3 rounded-lg bg-red-500/20 border border-red-400/50 text-sm text-red-100 max-w-md space-y-1.5">
              <p>{alertMessage}</p>
              {oauthDiagnostic?.redirectUri && (
                <p className="text-[11px] text-red-100/90 font-mono break-all">
                  App ID: {oauthDiagnostic.clientId || '-'} · Redirect URI: {oauthDiagnostic.redirectUri}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Glassmorphic Countdown Capsule matching Page 1 Mockup */}
        <div className="lg:col-span-6 flex flex-col items-center lg:items-end lg:pr-6">
          <div className="flex flex-col items-center">
            <div className="glass-countdown rounded-3xl px-7 sm:px-10 py-4 sm:py-5 text-center">
              <div className="font-display text-5xl sm:text-7xl font-extrabold tracking-wider text-white font-mono-num">
                {pad3(countdown.days)}:{pad2(countdown.hours)}:{pad2(countdown.minutes)}
              </div>
            </div>
            <div className="flex items-center justify-center gap-8 sm:gap-12 mt-2 text-xs sm:text-sm font-bold tracking-[0.2em] text-white uppercase">
              <span>DAY</span>
              <span>HOURS</span>
              <span>MINUTES</span>
            </div>
            <p className="mt-2 text-xs font-medium text-[#D5BF50] tracking-wide">
              {activeCountdown?.title || 'SNBT UTBK 2027'} · {pad2(countdown.seconds)} detik
            </p>
          </div>
        </div>
      </div>

      {/* Bottom-left peeking cat mascot matching Page 1 Mockup */}
      <div className="pointer-events-none select-none relative z-0 flex items-end justify-between mt-4">
        <div
          className="w-36 h-36 sm:w-44 sm:h-44 -mb-6 -ml-4 overflow-hidden opacity-90"
          style={{
            WebkitMaskImage: 'radial-gradient(ellipse at 35% 75%, black 42%, transparent 82%)',
            maskImage: 'radial-gradient(ellipse at 35% 75%, black 42%, transparent 82%)',
          }}
        >
          <SiteAssetImage
            slotKey="catMascot"
            siteAssets={siteAssets}
            fallbackUrl={visualAssets.catMascot}
            fallbackAlt="Maskot Kucing Komunitas"
            className="w-full h-full object-cover mix-blend-lighten"
          />
        </div>
        <span className="text-xs text-white/50">Server-synced countdown & membership verification</span>
      </div>

      {/* Preview Account Switcher Modal when Discord OAuth env vars are not yet set */}
      {showPreviewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pilih Akun Komunitas atau Konfigurasi Discord OAuth2"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-[#111B3A] text-slate-900 dark:text-slate-100 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#0757B8] dark:text-sky-300" />
                <h2 className="font-display text-2xl font-bold">Masuk ke Komunitas</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                aria-label="Tutup"
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              Kredensial Discord OAuth2 (<code className="font-mono">DISCORD_CLIENT_ID</code>,{' '}
              <code className="font-mono">DISCORD_CLIENT_SECRET</code>, <code className="font-mono">DISCORD_GUILD_ID</code>) belum
              diisi pada environment server. Untuk deployment produksi, daftarkan Callback URL berikut di Discord Developer Portal:
              <div className="mt-1.5 space-y-1">
                {callbacksToDisplay.map((url) => (
                  <span key={url} className="block p-2 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[11px] break-all">
                    {url}
                  </span>
                ))}
              </div>
            </div>

            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
              Mode Preview — Pilih anggota komunitas untuk menguji setiap peran:
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {previewAccounts.map((acc) => (
                <button
                  key={acc.discord_id}
                  type="button"
                  disabled={loggingIn}
                  onClick={() => handlePreviewAccountLogin(acc.discord_id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#0757B8] hover:bg-sky-50/60 dark:hover:bg-slate-800 transition-colors text-left cursor-pointer"
                >
                  <div>
                    <p className="font-semibold text-sm">{acc.username}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Discord ID: {acc.discord_id} · Target {acc.target_score}
                    </p>
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#0757B8] dark:text-sky-300">
                    {acc.role.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
