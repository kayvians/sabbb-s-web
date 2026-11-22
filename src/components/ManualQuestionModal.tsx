import { useState } from 'react';
import { Crop, Eye, EyeOff, Image as ImageIcon, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { deduplicateAndOrderDraftAssets } from '../lib/utbkLogic';
import { SUBTESTS, type QuestionAsset, type QuestionOption } from '../types';
import { MathContent } from './MathContent';
import { VisualCropModal } from './VisualCropModal';

interface ManualQuestionModalProps {
  onClose: () => void;
  onCreated: (message: string) => Promise<void> | void;
}

const DEFAULT_OPTIONS: QuestionOption[] = [
  { key: 'A', content: '' },
  { key: 'B', content: '' },
  { key: 'C', content: '' },
  { key: 'D', content: '' },
  { key: 'E', content: '' },
];

export function ManualQuestionModal({ onClose, onCreated }: ManualQuestionModalProps) {
  const [externalCode, setExternalCode] = useState(`M-${Date.now().toString().slice(-5)}`);
  const [subtest, setSubtest] = useState<string>(SUBTESTS[0]);
  const [topic, setTopic] = useState('');
  const [subtopic, setSubtopic] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [questionType, setQuestionType] = useState<'single_choice' | 'multiple_choice'>('single_choice');
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState<QuestionOption[]>(DEFAULT_OPTIONS);
  const [correctAnswer, setCorrectAnswer] = useState<string[]>(['A']);
  const [explanationText, setExplanationText] = useState('');
  const [solutionText, setSolutionText] = useState('');
  const [assets, setAssets] = useState<QuestionAsset[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [cropTargetIndex, setCropTargetIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUploadImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
          method: 'POST',
          body: JSON.stringify({ data_url: String(reader.result) }),
        });
        setAssets((prev) =>
          deduplicateAndOrderDraftAssets([
            ...prev,
            { asset_url: res.url, asset_type: 'manual', display_order: prev.length },
          ])
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleCorrectKey = (key: string) => {
    if (questionType === 'single_choice') {
      setCorrectAnswer([key]);
    } else {
      setCorrectAnswer((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()
      );
    }
  };

  const addOption = () => {
    const nextChar = String.fromCharCode(65 + options.length);
    if (options.length >= 7) return;
    setOptions((prev) => [...prev, { key: nextChar, content: '' }]);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    const removedKey = options[idx].key;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    setCorrectAnswer((prev) => prev.filter((k) => k !== removedKey));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanedOptions = options
      .map((o) => ({ key: o.key.trim().toUpperCase(), content: o.content.trim() }))
      .filter((o) => o.content.length > 0);
    if (cleanedOptions.length < 2) {
      setError('Minimal harus ada 2 pilihan jawaban yang terisi.');
      return;
    }
    const validKeys = new Set(cleanedOptions.map((o) => o.key));
    const filteredCorrect = correctAnswer.filter((k) => validKeys.has(k));
    if (filteredCorrect.length === 0) {
      setError('Pilih minimal 1 kunci jawaban yang cocok dengan opsi terisi.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<{ id: number; review_status: string }>('/api/admin/questions', {
        method: 'POST',
        body: JSON.stringify({
          external_code: externalCode.trim(),
          subtest,
          topic: topic.trim() || 'Umum',
          subtopic: subtopic.trim(),
          difficulty,
          question_type: questionType,
          question_text: questionText.trim(),
          assets,
          image_url: assets[0]?.asset_url || null,
          options: cleanedOptions,
          correct_answer: filteredCorrect,
          explanation_text: explanationText.trim(),
          solution_text: solutionText.trim(),
        }),
      });
      await onCreated(
        `Soal manual "${externalCode.trim()}" berhasil disimpan dan masuk antrean Review & Audit sebelum tampil di Latsol.`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan soal manual.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Input Soal Manual"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-5"
    >
      <div className="bg-[#101B45] text-white rounded-2xl max-w-4xl w-full max-h-[93vh] flex flex-col border border-[#D5BF50] shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/15 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Input Soal Manual (Drilling)</h3>
            <p className="text-xs text-sky-200">
              Soal baru otomatis masuk status Menunggu Review di Review & Audit Console hingga disetujui Admin.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? 'Mode Editor' : 'Preview Siswa'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup modal input manual"
              className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 border border-red-400 text-red-100">{error}</div>
          )}

          {showPreview ? (
            <div className="p-5 rounded-xl bg-[#0757B8]/70 border border-white/20 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-sky-200">
                <span className="font-mono-num font-bold text-[#D5BF50]">{externalCode}</span>
                <span>· {subtest}</span>
                <span>· {topic || 'Umum'}</span>
                {subtopic && <span>({subtopic})</span>}
                <span>· {difficulty.toUpperCase()}</span>
              </div>
              <MathContent text={questionText || '(Teks soal belum diisi)'} className="text-base text-white" />
              {assets.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {assets.map((a, i) => (
                    <img
                      key={`${a.asset_url}-${i}`}
                      src={a.asset_url}
                      alt={`Ilustrasi ${i + 1}`}
                      className="max-h-56 rounded-lg bg-white p-1 border border-white/20"
                    />
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {options
                  .filter((o) => o.content.trim())
                  .map((o) => {
                    const isKey = correctAnswer.includes(o.key);
                    return (
                      <div
                        key={o.key}
                        className={`px-3.5 py-2.5 rounded-xl border flex items-start gap-2.5 text-sm ${
                          isKey ? 'bg-emerald-500/25 border-emerald-400' : 'bg-white/5 border-white/15'
                        }`}
                      >
                        <span className="font-bold text-[#D5BF50]">{o.key}.</span>
                        <div className="flex-1">
                          <MathContent text={o.content} className="text-inherit" />
                        </div>
                        {isKey && <span className="text-[11px] font-bold text-emerald-300">Kunci</span>}
                      </div>
                    );
                  })}
              </div>
              {explanationText && (
                <div className="pt-3 border-t border-white/20">
                  <p className="font-bold text-[#D5BF50] mb-1">Pembahasan:</p>
                  <MathContent text={explanationText} className="text-sm text-sky-50" />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Kode Soal</span>
                  <input
                    type="text"
                    required
                    value={externalCode}
                    onChange={(e) => setExternalCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Subtest</span>
                  <select
                    value={subtest}
                    onChange={(e) => setSubtest(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 font-semibold"
                  >
                    {SUBTESTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Kesulitan</span>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                    className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 font-semibold"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Materi</span>
                  <input
                    type="text"
                    required
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Mis: Aljabar / Silogisme"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Submateri</span>
                  <input
                    type="text"
                    value={subtopic}
                    onChange={(e) => setSubtopic(e.target.value)}
                    placeholder="Opsional"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Tipe Soal</span>
                  <select
                    value={questionType}
                    onChange={(e) => {
                      const nextType = e.target.value as 'single_choice' | 'multiple_choice';
                      setQuestionType(nextType);
                      if (nextType === 'single_choice' && correctAnswer.length > 1) {
                        setCorrectAnswer([correctAnswer[0]]);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 font-semibold"
                  >
                    <option value="single_choice">Pilihan Ganda Tunggal</option>
                    <option value="multiple_choice">Pilihan Ganda Kompleks (&gt;1 kunci)</option>
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-sky-200 font-semibold block">Teks Soal (Mendukung Markdown & LaTeX $...$)</span>
                <textarea
                  rows={4}
                  required
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="Tulis teks soal di sini..."
                  className="w-full p-3 rounded-lg bg-slate-950 border border-white/20 text-sm"
                />
              </label>

              {/* Image Upload & Standalone Crop */}
              <div className="space-y-2 p-3.5 rounded-xl bg-white/5 border border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sky-200 font-semibold">Lampiran Gambar & Crop Manual</span>
                  <label className="px-3 py-1.5 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] font-bold cursor-pointer inline-flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" /> + Unggah Gambar
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleUploadImage(e.target.files?.[0])}
                    />
                  </label>
                </div>

                {assets.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {assets.map((asset, i) => (
                      <div key={`${asset.asset_url}-${i}`} className="p-2 rounded-lg bg-black/35 border border-white/15 space-y-1.5">
                        <img src={asset.asset_url} alt={`Asset ${i + 1}`} className="h-24 w-auto object-contain rounded bg-white" />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setCropTargetIndex(i)}
                            className="px-2 py-1 rounded bg-[#D5BF50] text-[#101B45] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Crop className="w-3 h-3" /> Crop Manual
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAssets((prev) =>
                                prev.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, display_order: idx }))
                              )
                            }
                            className="px-2 py-1 rounded bg-red-500/25 text-red-200 hover:bg-red-500/40 cursor-pointer"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Options + Answer Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sky-200 font-semibold">Pilihan Jawaban & Kunci Benar</span>
                  {options.length < 7 && (
                    <button
                      type="button"
                      onClick={addOption}
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Tambah Opsi
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {options.map((opt, idx) => {
                    const isKey = correctAnswer.includes(opt.key);
                    return (
                      <div key={opt.key} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCorrectKey(opt.key)}
                          title="Tandai sebagai kunci jawaban"
                          className={`w-9 h-9 rounded-lg font-bold shrink-0 cursor-pointer border ${
                            isKey
                              ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                              : 'bg-white/10 text-white border-white/20 hover:border-[#D5BF50]'
                          }`}
                        >
                          {opt.key}
                        </button>
                        <input
                          type="text"
                          value={opt.content}
                          onChange={(e) =>
                            setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, content: e.target.value } : o)))
                          }
                          placeholder={`Isi pilihan ${opt.key}...`}
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/20"
                        />
                        {options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOption(idx)}
                            aria-label={`Hapus opsi ${opt.key}`}
                            className="p-2 text-white/50 hover:text-red-300 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-emerald-300">
                  Kunci terpilih: <strong className="font-mono">{correctAnswer.join(', ') || 'Belum dipilih'}</strong> (klik huruf opsi untuk memilih)
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Pembahasan</span>
                  <textarea
                    rows={3}
                    value={explanationText}
                    onChange={(e) => setExplanationText(e.target.value)}
                    placeholder="Penjelasan konsep & jawaban benar..."
                    className="w-full p-2.5 rounded-lg bg-slate-950 border border-white/20"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sky-200 font-semibold block">Langkah Penyelesaian (Opsional)</span>
                  <textarea
                    rows={3}
                    value={solutionText}
                    onChange={(e) => setSolutionText(e.target.value)}
                    placeholder="Langkah demi langkah..."
                    className="w-full p-2.5 rounded-lg bg-slate-950 border border-white/20"
                  />
                </label>
              </div>
            </>
          )}

          <div className="pt-3 border-t border-white/15 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : 'Simpan ke Antrean Review'}
            </button>
          </div>
        </form>
      </div>

      {cropTargetIndex !== null && assets[cropTargetIndex] && (
        <VisualCropModal
          mode="standalone_image"
          imageUrl={assets[cropTargetIndex].asset_url}
          title={`Crop Manual Gambar #${cropTargetIndex + 1}`}
          initialCropBox={assets[cropTargetIndex].crop_box}
          onClose={() => setCropTargetIndex(null)}
          onStandaloneCropped={(res) => {
            setAssets((prev) =>
              prev.map((a, idx) =>
                idx === cropTargetIndex
                  ? { ...a, asset_url: res.asset_url, asset_type: 'cropped', crop_box: res.crop_box }
                  : a
              )
            );
          }}
        />
      )}
    </div>
  );
}
