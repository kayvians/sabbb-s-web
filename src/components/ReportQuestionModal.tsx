import { useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface ReportQuestionModalProps {
  questionId: number;
  questionCode: string;
  sourceType?: 'drill' | 'tryout';
  onClose: () => void;
  onSubmitted: (msg: string) => void;
}

const ISSUE_TYPES = [
  'Kunci jawaban diduga salah',
  'Pembahasan kurang jelas',
  'Soal memiliki kesalahan penulisan',
  'Gambar tidak muncul',
  'Pilihan jawaban bermasalah',
  'Soal ambigu',
];

export function ReportQuestionModal({
  questionId,
  questionCode,
  sourceType = 'drill',
  onClose,
  onSubmitted,
}: ReportQuestionModalProps) {
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Mohon jelaskan detail kendala pada soal ini.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          question_id: questionId,
          source_type: sourceType,
          issue_type: issueType,
          description: description.trim(),
        }),
      });
      onSubmitted('Laporan soal berhasil dikirim dan menunggu peninjauan Admin.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim laporan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Laporkan Soal ${questionCode}`}
      className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-[#111B3A] text-slate-900 dark:text-slate-100 rounded-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-2xl font-bold text-[#0757B8] dark:text-sky-300">
            Laporkan Soal ({questionCode})
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal laporan"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
              Jenis Masalah
            </label>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
              Deskripsi Detail
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tuliskan bagian yang keliru atau perlu diperjelas..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-white text-sm font-bold cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Mengirim...' : 'Kirim Laporan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
