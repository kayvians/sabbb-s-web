import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { PageRoute, User } from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { PublicProfileModal } from './PublicProfileModal';

interface LeaderboardPageProps {
  user: User;
  onNavigate: (page: PageRoute) => void;
}

interface LeaderboardResponse {
  packages: Array<{ id: number; title: string; provider: string }>;
  selectedPackageId: number;
  entries: Array<{
    rank: number;
    userId: number;
    username: string;
    avatarUrl: string;
    utbkScore: number;
    activeDurationSeconds: number;
    completedAt: string;
  }>;
}

export function LeaderboardPage({ user, onNavigate }: LeaderboardPageProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<{ userId: number; username: string } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const url = packageId ? `/api/leaderboard?packageId=${packageId}` : '/api/leaderboard';
        const res = await apiFetch<LeaderboardResponse>(url);
        if (active) {
          setData(res);
          if (!packageId && res.selectedPackageId) {
            setPackageId(res.selectedPackageId);
          }
        }
      } catch {
        // Handled cleanly without unhandled promise rejection
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [packageId]);

  const currentPkg = data?.packages.find((p) => p.id === (packageId ?? data.selectedPackageId));
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6 flex flex-col justify-between">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />
        {/* Header matching Page 5 Mockup */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <h2 className="font-display text-4xl sm:text-5xl font-extrabold italic leading-none">
              Top ranks
            </h2>
            <p className="text-sm text-sky-100">
              of the tryout · Klik nama anggota untuk melihat profil publik
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(data?.packages || []).map((pkg) => {
              const active = pkg.id === (packageId ?? data?.selectedPackageId);
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setPackageId(pkg.id)}
                  className={`px-3.5 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#D5BF50] text-[#101B45]'
                      : 'bg-[#101B45]/70 text-white hover:bg-[#101B45]'
                  }`}
                >
                  {pkg.title}
                </button>
              );
            })}
          </div>
        </div>

        {currentPkg && (
          <div className="flex items-baseline gap-2 border-b border-white/20 pb-3">
            <span className="font-display text-4xl font-extrabold">TO</span>
            <span className="text-base font-bold">{currentPkg.title}</span>
          </div>
        )}

        {/* Ranked List matching Page 5 Mockup */}
        <div className="bg-[#0D4FA8]/45 dark:bg-[#111B3A] rounded-2xl p-6 border border-white/15">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest text-sky-200 pb-3 border-b border-white/15">
            <span>USER</span>
            <span>SKOR (WAKTU AKTIF)</span>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-sky-100">Memuat peringkat paket...</p>
          ) : !data || data.entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-sky-100">
              Belum ada anggota yang menyelesaikan paket ini.
            </p>
          ) : (
            <ol className="divide-y divide-white/10">
              {data.entries.slice(0, 15).map((entry) => {
                const medal =
                  entry.rank === 1
                    ? 'bg-[#D5BF50] text-[#101B45]'
                    : entry.rank === 2
                    ? 'bg-slate-200 text-slate-900'
                    : entry.rank === 3
                    ? 'bg-amber-600 text-white'
                    : 'bg-white/15 text-white';

                return (
                  <li
                    key={entry.userId}
                    className={`flex items-center justify-between gap-3 py-3.5 ${
                      entry.userId === user.id ? 'bg-white/10 -mx-3 px-3 rounded-lg' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={`w-8 h-8 rounded-full font-display font-extrabold text-base flex items-center justify-center shrink-0 ${medal}`}
                      >
                        {entry.rank}
                      </span>
                      <button
                        type="button"
                        data-testid={`leaderboard-user-${entry.userId}`}
                        onClick={() => setSelectedUser({ userId: entry.userId, username: entry.username })}
                        className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
                      >
                        {entry.avatarUrl ? (
                          <img
                            src={entry.avatarUrl}
                            alt={entry.username}
                            className="w-8 h-8 rounded-full object-cover border border-white/40 group-hover:border-[#D5BF50] shrink-0"
                          />
                        ) : (
                          <span className="w-8 h-8 rounded-full bg-white text-[#0757B8] text-xs font-extrabold flex items-center justify-center shrink-0">
                            {entry.username.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="font-display text-2xl sm:text-3xl font-extrabold tracking-wide truncate group-hover:text-[#D5BF50] transition-colors">
                          {entry.username.toUpperCase()}
                        </span>
                      </button>
                      <span className="hidden sm:block flex-1 border-b-2 border-dotted border-white/30 mx-2" />
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-display text-3xl font-extrabold font-mono-num text-white">
                        {entry.utbkScore}
                      </span>
                      <span className="block text-[11px] font-mono-num text-sky-200">
                        {formatDuration(entry.activeDurationSeconds)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full flex items-center justify-between pt-8">
        <div className="inline-flex items-center gap-2.5 text-sm font-display font-bold text-white/90">
          <span className="w-7 h-7 rounded-full bg-white text-[#0757B8] flex items-center justify-center text-xs">
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <span>{user.username}</span>
        </div>
      </div>

      {selectedUser && (
        <PublicProfileModal
          userId={selectedUser.userId}
          initialUsername={selectedUser.username}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}
