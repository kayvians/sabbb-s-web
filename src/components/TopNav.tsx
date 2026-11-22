import { useState } from 'react';
import { LogOut, Menu, Moon, Shield, Sun, X } from 'lucide-react';
import type { PageRoute, SiteAssetConfig, User, VisualAssets } from '../types';
import { SiteAssetImage } from './SiteAssetImage';

interface TopNavProps {
  currentPage: PageRoute;
  onNavigate: (page: PageRoute) => void;
  user: User;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  visualAssets: VisualAssets;
  siteAssets?: SiteAssetConfig[];
  headerBadge?: string;
  isExamExecution?: boolean;
}

export function TopNav({
  currentPage,
  onNavigate,
  user,
  isDark,
  onToggleTheme,
  onLogout,
  visualAssets,
  siteAssets,
  headerBadge,
  isExamExecution = false,
}: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const go = (page: PageRoute) => {
    setMenuOpen(false);
    onNavigate(page);
  };

  return (
    <>
      <header
        data-exam-header={isExamExecution ? 'swapped' : 'standard'}
        className={`sticky top-0 z-30 flex items-center justify-between h-16 pl-4 sm:pl-6 border-b ${
          isExamExecution
            ? 'bg-[#0757B8] dark:bg-[#0A1128] border-[#0D4FA8] dark:border-slate-800 text-white'
            : 'bg-white dark:bg-[#0D142E] border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white'
        }`}
      >
        <div className="flex items-center gap-4 sm:gap-7 min-w-0">
          <button
            type="button"
            onClick={() => go('dashboard')}
            aria-label="Beranda Ganesha Circle"
            className={`shrink-0 rounded-xl overflow-hidden border w-11 h-11 flex items-center justify-center focus-visible:outline-2 ${
              isExamExecution
                ? 'border-white/35 bg-[#101B45] focus-visible:outline-[#D5BF50]'
                : 'border-slate-200 dark:border-slate-700 bg-[#0757B8] focus-visible:outline-[#0757B8]'
            }`}
          >
            <SiteAssetImage
              slotKey="logo"
              siteAssets={siteAssets}
              fallbackUrl={visualAssets.logo}
              fallbackAlt="Logo Komunitas"
              className="w-full h-full object-cover"
            />
          </button>

          {currentPage === 'dashboard' ? (
            <nav aria-label="Navigasi utama" className="hidden md:flex items-center gap-7">
              {(
                [
                  { id: 'profile', label: 'PROFILE' },
                  { id: 'tryout', label: 'TRYOUT' },
                  { id: 'latsol', label: 'LATSOL' },
                  { id: 'leaderboard', label: 'LEADERBOARD' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  className="font-display text-2xl font-bold tracking-wide text-[#0757B8] dark:text-sky-300 hover:opacity-80 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          ) : (
            <div className="flex items-center gap-5 min-w-0">
              <span
                className={`font-display text-2xl sm:text-3xl font-extrabold tracking-wide uppercase whitespace-nowrap ${
                  isExamExecution ? 'text-white' : 'text-[#0757B8] dark:text-sky-300'
                }`}
              >
                {currentPage === 'dwu'
                  ? 'DWU REVIEW'
                  : currentPage === 'feedback'
                  ? 'QUESTION FEEDBACK'
                  : currentPage === 'bank'
                  ? 'QUESTION BANK'
                  : currentPage === 'admin'
                  ? 'ADMIN PANEL'
                  : currentPage.toUpperCase()}
              </span>
              {headerBadge && (
                <span
                  className={`hidden sm:inline-block font-display text-xl font-bold truncate max-w-xs ${
                    isExamExecution ? 'text-[#D5BF50]' : 'text-[#0D4FA8] dark:text-amber-300'
                  }`}
                >
                  {headerBadge}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center h-full shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={() => go('admin')}
              className={`hidden sm:flex items-center gap-1.5 mr-3 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isExamExecution
                  ? 'bg-white/15 hover:bg-white/25 text-white'
                  : currentPage === 'admin'
                  ? 'bg-[#0757B8] text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-[#0757B8] dark:text-sky-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          )}

          {/* Plan A / B / C / D inspired quick menu trigger matching mockup Page 2-11 */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Buka Menu Navigasi"
            className={`flex items-center gap-2 px-3 py-1.5 mr-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              isExamExecution
                ? 'text-white hover:bg-white/15'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <div
              className={`hidden lg:grid grid-cols-1 text-[10px] leading-[11px] text-right font-semibold ${
                isExamExecution ? 'text-sky-100' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <span>Menu A ○</span>
              <span>Menu B ○</span>
              <span>Menu C ○</span>
              <span>Menu D ○</span>
            </div>
            <Menu className={`w-5 h-5 ${isExamExecution ? 'text-white' : 'text-[#0757B8] dark:text-sky-300'}`} />
          </button>

          {/* Signature Switch Mode block matching mockup top-right */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch ke Light Mode' : 'Switch ke Dark Mode'}
            className={`h-full px-3.5 sm:px-5 text-white flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer shrink-0 ${
              isExamExecution
                ? 'bg-[#101B45] hover:bg-[#14244F] border-l border-white/15'
                : 'bg-[#0D4FA8] dark:bg-[#14244F] hover:bg-[#0757B8]'
            }`}
          >
            {isDark ? <Sun className="w-5 h-5 text-[#D5BF50]" /> : <Moon className="w-5 h-5 text-white fill-white" />}
            <span className="text-[11px] font-medium whitespace-nowrap">Switch Mode</span>
          </button>
        </div>
      </header>

      {/* Page 4 Mockup Full-Screen Navigation Overlay */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu Navigasi Lengkap"
          className="fixed inset-0 z-50 flex flex-col justify-between p-6 sm:p-12 text-white"
          style={{
            background: 'radial-gradient(circle at 30% 25%, #27538C 0%, #14244F 48%, #09122C 100%)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center font-bold text-sm">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-sm">{user.username}</p>
                <p className="text-xs text-sky-200 uppercase tracking-wider">{user.role.replace('_', ' ')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar</span>
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Tutup Menu"
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 my-auto py-6">
            <div className="flex flex-col gap-3 sm:gap-5">
              {(
                [
                  { id: 'dashboard', label: 'DASHBOARD' },
                  { id: 'profile', label: 'PROFILE' },
                  { id: 'tryout', label: 'TRYOUT' },
                  { id: 'latsol', label: 'LATSOL' },
                  { id: 'leaderboard', label: 'LEADERBOARD' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  className={`text-left font-display text-4xl sm:text-6xl font-extrabold tracking-tight transition-transform hover:translate-x-2 cursor-pointer ${
                    currentPage === item.id ? 'text-[#D5BF50]' : 'text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4 sm:gap-6 md:justify-center">
              {(
                [
                  { id: 'library', label: 'LIBRARY', size: 'text-4xl sm:text-5xl' },
                  { id: 'dwu', label: 'DWU REVIEW', size: 'text-4xl sm:text-5xl' },
                  { id: 'feedback', label: 'QUESTION FEEDBACK', size: 'text-2xl sm:text-4xl' },
                  { id: 'bank', label: 'QUESTION BANK', size: 'text-2xl sm:text-4xl' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  className={`text-left font-display ${item.size} font-extrabold tracking-tight transition-transform hover:translate-x-2 cursor-pointer ${
                    currentPage === item.id ? 'text-[#D5BF50]' : 'text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => go('admin')}
                  className={`text-left font-display text-2xl sm:text-3xl font-extrabold tracking-tight transition-transform hover:translate-x-2 cursor-pointer ${
                    currentPage === 'admin' ? 'text-[#D5BF50]' : 'text-sky-300'
                  }`}
                >
                  ADMIN DASHBOARD
                </button>
              )}
            </div>
          </div>

          <div className="text-xs text-sky-200/70 flex flex-wrap items-center justify-between gap-2">
            <span>Ganesha Circle — Komunitas Belajar UTBK</span>
            <span>Discord ID: {user.discord_id}</span>
          </div>
        </div>
      )}
    </>
  );
}
