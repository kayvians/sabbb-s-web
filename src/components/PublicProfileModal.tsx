import { useEffect, useState } from 'react';
import { Award, Clock, Lock, Target, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { formatDurationMinutes } from '../lib/utbkLogic';
import type { PublicProfileResponse } from '../types';

interface PublicProfileModalProps {
  userId: number;
  initialUsername: string;
  onClose: () => void;
}

export function PublicProfileModal({ userId, initialUsername, onClose }: PublicProfileModalProps) {
  const [data, setData] = useState<PublicProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<PublicProfileResponse>(`/api/users/${userId}/public-profile`);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat profil publik.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [userId]);

  const initials = (data?.user.username || initialUsername).slice(0, 2).toUpperCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Profil Publik ${initialUsername}`}
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5"
    >
      <div
        data-testid="public-profile-modal"
        className="bg-[#101B45] text-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col border border-[#D5BF50] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {data?.user.avatar_url ? (
              <img
                src={data.user.avatar_url}
                alt={data.user.username}
                className="w-11 h-11 rounded-full object-cover border-2 border-[#D5BF50] shrink-0"
              />
            ) : (
              <span className="w-11 h-11 rounded-full bg-white text-[#0757B8] font-extrabold flex items-center justify-center border-2 border-[#D5BF50] shrink-0">
                {initials}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="font-display text-2xl font-bold text-white truncate">
                {data?.user.username || initialUsername}
              </h3>
              {data?.user.joined_at && (
                <p className="text-xs text-sky-200">
                  Bergabung {new Date(data.user.joined_at).toLocaleDateString('id-ID')}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup profil publik"
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {loading ? (
            <p className="py-8 text-center text-sky-200">Memuat profil anggota...</p>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-500/20 border border-red-400 text-xs text-red-100">{error}</div>
          ) : !data || !data.profileVisible ? (
            <div className="p-6 rounded-xl bg-white/5 border border-white/15 text-center space-y-2">
              <Lock className="w-8 h-8 text-[#D5BF50] mx-auto" />
              <p className="font-bold text-white">Profil Bersifat Privat</p>
              <p className="text-xs text-sky-200">
                Anggota ini memilih untuk menyembunyikan detail progres belajar dan statistiknya dari anggota lain.
              </p>
            </div>
          ) : (
            <>
              {/* Target Score */}
              {data.targetScore !== null && data.targetScore !== undefined && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/15 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sky-200 text-xs font-bold uppercase tracking-wider">
                    <Target className="w-4 h-4 text-[#D5BF50]" /> Target Skor UTBK
                  </div>
                  <span className="font-display text-3xl font-extrabold font-mono-num text-[#D5BF50]">
                    {data.targetScore}
                  </span>
                </div>
              )}

              {/* Try Out Stats */}
              {data.tryoutStats && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-200 flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-[#D5BF50]" /> Statistik Try Out
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">TO Selesai</span>
                      <strong className="font-mono-num text-xl text-white">{data.tryoutStats.completedCount}</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">Skor Terbaik</span>
                      <strong className="font-mono-num text-xl text-[#D5BF50]">
                        {data.tryoutStats.bestScore ?? '—'}
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">Rata-rata</span>
                      <strong className="font-mono-num text-xl text-emerald-300">
                        {data.tryoutStats.averageScore ?? '—'}
                      </strong>
                    </div>
                  </div>
                  {data.tryoutStats.recentScores.length > 0 && (
                    <ul className="divide-y divide-white/10 text-xs">
                      {data.tryoutStats.recentScores.map((rs, idx) => (
                        <li key={idx} className="py-1.5 flex items-center justify-between">
                          <span className="truncate pr-2">{rs.packageTitle}</span>
                          <strong className="font-mono-num text-[#D5BF50]">{rs.utbkScore}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Study Time Stats */}
              {data.studyTimeStats && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-200 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#D5BF50]" /> Akumulasi Waktu Belajar
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">Total Jam</span>
                      <strong className="font-mono-num text-sm text-[#D5BF50]">
                        {formatDurationMinutes(data.studyTimeStats.totalMinutes)}
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">Minggu Ini</span>
                      <strong className="font-mono-num text-sm text-white">
                        {formatDurationMinutes(data.studyTimeStats.thisWeekMinutes)}
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/25">
                      <span className="block text-[11px] text-sky-200">Sesi Catatan</span>
                      <strong className="font-mono-num text-sm text-emerald-300">
                        {data.studyTimeStats.sessionsCount}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Subtest Mastery */}
              {data.subtestMastery && data.subtestMastery.length > 0 && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-200">
                    Indikator Pemahaman Subtest
                  </h4>
                  <div className="space-y-2">
                    {data.subtestMastery.map((m) => (
                      <div key={m.subtest} className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span>{m.subtest}</span>
                          <span className="font-mono-num font-bold text-[#D5BF50]">{m.masteryPct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-black/35 overflow-hidden">
                          <div className="h-full bg-[#D5BF50]" style={{ width: `${m.masteryPct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.targetScore === null &&
                !data.tryoutStats &&
                !data.studyTimeStats &&
                (!data.subtestMastery || data.subtestMastery.length === 0) && (
                  <p className="text-center text-xs text-sky-200 py-4">
                    Anggota ini belum membagikan statistik publik tambahan pada profilnya.
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
