import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Crop, Move, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { normalizeCropBoxWithPadding } from '../lib/utbkLogic';
import { apiFetch } from '../utils/api';
import type { PdfImportDraftItem, PdfImportJob, QuestionAsset } from '../types';

type VisualCropModalProps =
  | {
      mode?: 'pdf_job';
      job: PdfImportJob;
      draftItem: PdfImportDraftItem;
      assetIndex?: number;
      initialAsset?: QuestionAsset;
      onClose: () => void;
      onCropped: (updatedJob: PdfImportJob) => void;
    }
  | {
      mode: 'standalone_image';
      imageUrl: string;
      title?: string;
      initialCropBox?: [number, number, number, number] | null;
      onClose: () => void;
      onStandaloneCropped: (result: { asset_url: string; crop_box: [number, number, number, number] }) => void;
    };

type DragMode =
  | { type: 'draw'; startX: number; startY: number }
  | { type: 'move'; startX: number; startY: number; originBox: [number, number, number, number] }
  | {
      type: 'resize';
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      originBox: [number, number, number, number];
    };

const MIN_BOX_SPAN = 20;

export function VisualCropModal(props: VisualCropModalProps) {
  const isStandalone = props.mode === 'standalone_image';
  const pageImages = !isStandalone ? props.job.page_images || [] : [];
  const defaultPage = !isStandalone
    ? props.initialAsset?.source_page || props.draftItem.source_page || pageImages[0]?.page || 1
    : 1;

  const rawInitialBox = isStandalone ? props.initialCropBox : props.initialAsset?.crop_box;
  const initialBox: [number, number, number, number] =
    rawInitialBox && rawInitialBox.length === 4
      ? [
          Math.max(0, Math.min(1000, Number(rawInitialBox[0]))),
          Math.max(0, Math.min(1000, Number(rawInitialBox[1]))),
          Math.max(0, Math.min(1000, Number(rawInitialBox[2]))),
          Math.max(0, Math.min(1000, Number(rawInitialBox[3]))),
        ]
      : [120, 80, 560, 920];

  const [selectedPage, setSelectedPage] = useState<number>(defaultPage);
  const [bbox, setBbox] = useState<[number, number, number, number]>(initialBox);
  const [caption, setCaption] = useState<string>(!isStandalone ? props.initialAsset?.caption || '' : '');
  const [padding, setPadding] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [imgLoadedTick, setImgLoadedTick] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentPageMeta = !isStandalone
    ? pageImages.find((p) => p.page === selectedPage) || pageImages[0] || null
    : null;

  const activeImageUrl = isStandalone ? props.imageUrl : currentPageMeta?.image_url || '';

  useEffect(() => {
    if (!isStandalone && !pageImages.some((p) => p.page === selectedPage) && pageImages[0]) {
      setSelectedPage(pageImages[0].page);
    }
  }, [isStandalone, pageImages, selectedPage]);

  const toNormalizedCoords = (clientX: number, clientY: number) => {
    const target = imgRef.current || stageRef.current;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const nx = Math.max(0, Math.min(1000, Math.round(((clientX - rect.left) / rect.width) * 1000)));
    const ny = Math.max(0, Math.min(1000, Math.round(((clientY - rect.top) / rect.height) * 1000)));
    return { x: nx, y: ny };
  };

  const clampOrderedBox = (box: [number, number, number, number]): [number, number, number, number] => {
    const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
    let ymin = clamp(Math.min(box[0], box[2]));
    let xmin = clamp(Math.min(box[1], box[3]));
    let ymax = clamp(Math.max(box[0], box[2]));
    let xmax = clamp(Math.max(box[1], box[3]));
    if (ymax - ymin < MIN_BOX_SPAN) {
      if (ymin + MIN_BOX_SPAN <= 1000) ymax = ymin + MIN_BOX_SPAN;
      else ymin = Math.max(0, 1000 - MIN_BOX_SPAN);
    }
    if (xmax - xmin < MIN_BOX_SPAN) {
      if (xmin + MIN_BOX_SPAN <= 1000) xmax = xmin + MIN_BOX_SPAN;
      else xmin = Math.max(0, 1000 - MIN_BOX_SPAN);
    }
    return [ymin, xmin, ymax, xmax];
  };

  const activeBox = clampOrderedBox(bbox);
  const paddedFinalBox = padding > 0 ? normalizeCropBoxWithPadding(activeBox, padding) : activeBox;

  // Render Live Crop Preview onto canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return;

    const [ymin, xmin, ymax, xmax] = paddedFinalBox;
    const sx = Math.max(0, Math.floor((xmin / 1000) * img.naturalWidth));
    const sy = Math.max(0, Math.floor((ymin / 1000) * img.naturalHeight));
    const sw = Math.max(4, Math.min(img.naturalWidth - sx, Math.ceil(((xmax - xmin) / 1000) * img.naturalWidth)));
    const sh = Math.max(4, Math.min(img.naturalHeight - sy, Math.ceil(((ymax - ymin) / 1000) * img.naturalHeight)));

    const maxPreviewW = 240;
    const maxPreviewH = 170;
    const scale = Math.min(maxPreviewW / sw, maxPreviewH / sh, 1.5);
    const dw = Math.max(16, Math.round(sw * scale));
    const dh = Math.max(16, Math.round(sh * scale));

    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  }, [paddedFinalBox, imgLoadedTick, activeImageUrl]);

  const startNewDraw = (e: ReactPointerEvent<HTMLElement>) => {
    const pt = toNormalizedCoords(e.clientX, e.clientY);
    if (!pt || !stageRef.current) return;
    e.stopPropagation();
    stageRef.current.setPointerCapture(e.pointerId);
    setDragMode({ type: 'draw', startX: pt.x, startY: pt.y });
    setBbox(clampOrderedBox([pt.y, pt.x, Math.min(1000, pt.y + MIN_BOX_SPAN), Math.min(1000, pt.x + MIN_BOX_SPAN)]));
  };

  const startMoveBox = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pt = toNormalizedCoords(e.clientX, e.clientY);
    if (!pt || !stageRef.current) return;
    e.stopPropagation();
    stageRef.current.setPointerCapture(e.pointerId);
    setDragMode({ type: 'move', startX: pt.x, startY: pt.y, originBox: [...bbox] as [number, number, number, number] });
  };

  const startResizeBox = (
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
    e: ReactPointerEvent<HTMLDivElement>
  ) => {
    e.stopPropagation();
    if (!stageRef.current) return;
    stageRef.current.setPointerCapture(e.pointerId);
    setDragMode({ type: 'resize', handle, originBox: [...bbox] as [number, number, number, number] });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    const pt = toNormalizedCoords(e.clientX, e.clientY);
    if (!pt) return;

    if (dragMode.type === 'draw') {
      const ymin = Math.min(dragMode.startY, pt.y);
      const xmin = Math.min(dragMode.startX, pt.x);
      const ymax = Math.max(dragMode.startY, pt.y);
      const xmax = Math.max(dragMode.startX, pt.x);
      setBbox(clampOrderedBox([ymin, xmin, ymax, xmax]));
      return;
    }

    if (dragMode.type === 'move') {
      const [oy1, ox1, oy2, ox2] = dragMode.originBox;
      const boxH = oy2 - oy1;
      const boxW = ox2 - ox1;
      let dy = pt.y - dragMode.startY;
      let dx = pt.x - dragMode.startX;
      if (oy1 + dy < 0) dy = -oy1;
      if (oy2 + dy > 1000) dy = 1000 - oy2;
      if (ox1 + dx < 0) dx = -ox1;
      if (ox2 + dx > 1000) dx = 1000 - ox2;
      setBbox([
        Math.round(oy1 + dy),
        Math.round(ox1 + dx),
        Math.round(oy1 + dy + boxH),
        Math.round(ox1 + dx + boxW),
      ]);
      return;
    }

    const [oy1, ox1, oy2, ox2] = dragMode.originBox;
    let ymin = oy1;
    let xmin = ox1;
    let ymax = oy2;
    let xmax = ox2;
    const h = dragMode.handle;

    if (h.includes('n')) ymin = Math.min(oy2 - MIN_BOX_SPAN, Math.max(0, pt.y));
    if (h.includes('s')) ymax = Math.max(oy1 + MIN_BOX_SPAN, Math.min(1000, pt.y));
    if (h.includes('w')) xmin = Math.min(ox2 - MIN_BOX_SPAN, Math.max(0, pt.x));
    if (h.includes('e')) xmax = Math.max(ox1 + MIN_BOX_SPAN, Math.min(1000, pt.x));

    setBbox([Math.round(ymin), Math.round(xmin), Math.round(ymax), Math.round(xmax)]);
  };

  const handlePointerEnd = () => {
    setDragMode(null);
  };

  const handleConfirmCrop = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isStandalone) {
        const res = await apiFetch<{ asset_url: string; crop_box: [number, number, number, number] }>(
          '/api/admin/questions/crop-image',
          {
            method: 'POST',
            body: JSON.stringify({
              image_url: props.imageUrl,
              bbox: paddedFinalBox,
            }),
          }
        );
        props.onStandaloneCropped({ asset_url: res.asset_url, crop_box: res.crop_box });
        props.onClose();
        return;
      }

      if (!currentPageMeta) return;
      const res = await apiFetch<{ job: PdfImportJob; asset: QuestionAsset }>(
        `/api/admin/import/jobs/${props.job.id}/recrop`,
        {
          method: 'POST',
          body: JSON.stringify({
            temp_id: props.draftItem.temp_id,
            asset_index: props.assetIndex,
            page: currentPageMeta.page,
            bbox: paddedFinalBox,
            padding: 0,
            caption: caption.trim(),
          }),
        }
      );
      props.onCropped(res.job);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal melakukan crop gambar.');
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = isStandalone
    ? props.title || 'Crop Manual Gambar Soal'
    : `Crop Ulang Area Gambar PDF — No. ${props.draftItem.question_number} (${props.draftItem.external_code})`;

  const canRenderStage = isStandalone ? Boolean(props.imageUrl) : pageImages.length > 0 && Boolean(currentPageMeta);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={headerTitle}
      className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-2 sm:p-5"
    >
      <div className="bg-[#101B45] text-white rounded-2xl max-w-5xl w-full max-h-[95vh] flex flex-col border border-[#D5BF50] shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/15 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg sm:text-2xl font-bold text-[#D5BF50] flex items-center gap-2">
              <Crop className="w-5 h-5 shrink-0" /> {headerTitle}
            </h3>
            <p className="text-xs text-sky-200 mt-0.5">
              Seret di area kosong untuk menggambar kotak baru, geser kotak untuk memindahkan, atau tarik 8 titik tepi. Gunakan Zoom untuk presisi tinggi.
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Tutup modal crop"
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {!canRenderStage ? (
            <div className="p-6 rounded-xl bg-amber-500/15 border border-amber-400/50 text-xs text-amber-100">
              Pratinjau gambar belum tersedia. Pastikan gambar sudah diunggah atau jalankan Ekstrak Ulang pada batch PDF ini.
            </div>
          ) : (
            <>
              {/* Top Controls Bar */}
              <div className="flex flex-wrap items-end justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-end gap-3 flex-1">
                  {!isStandalone && (
                    <label className="space-y-1 min-w-[200px]">
                      <span className="text-sky-200 block font-semibold">Halaman PDF</span>
                      <select
                        value={currentPageMeta?.page || 1}
                        onChange={(e) => setSelectedPage(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/25 font-semibold"
                      >
                        {pageImages.map((p) => (
                          <option key={p.page} value={p.page}>
                            Halaman {p.page} ({p.filename} · hal {p.file_page})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="space-y-1 w-40">
                    <span className="text-sky-200 block font-semibold">Margin Ekstra (0-80)</span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={padding}
                      onChange={(e) => setPadding(Math.max(0, Math.min(80, Number(e.target.value) || 0)))}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20 font-mono-num"
                    />
                  </label>

                  {!isStandalone && (
                    <label className="space-y-1 flex-1 min-w-[180px]">
                      <span className="text-sky-200 block font-semibold">Keterangan Gambar (Opsional)</span>
                      <input
                        type="text"
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        placeholder="Mis: Grafik kecepatan vs waktu"
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20"
                      />
                    </label>
                  )}
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-1.5 bg-slate-900/90 border border-white/20 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
                    disabled={zoom <= 1}
                    aria-label="Perkecil zoom"
                    className="p-1.5 rounded hover:bg-white/15 disabled:opacity-35 cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono-num font-bold text-[#D5BF50] min-w-[48px] text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                    disabled={zoom >= 3}
                    aria-label="Perbesar zoom"
                    className="p-1.5 rounded hover:bg-white/15 disabled:opacity-35 cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setBbox([100, 60, 900, 940]);
                    }}
                    className="ml-1 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                </div>
              </div>

              {/* Main Stage + Live Crop Preview Sidebar */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-9 bg-slate-950 rounded-xl p-3 border border-white/15 overflow-auto max-h-[54vh] text-center">
                  <div
                    ref={stageRef}
                    data-testid="crop-stage"
                    onPointerDown={startNewDraw}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? '740px' : 'none' }}
                    className="relative inline-block align-top select-none cursor-crosshair touch-none overflow-hidden rounded shadow-lg"
                  >
                    <img
                      ref={imgRef}
                      src={activeImageUrl}
                      alt="Pratinjau area crop"
                      draggable={false}
                      onLoad={() => setImgLoadedTick((t) => t + 1)}
                      className="block w-full h-auto select-none pointer-events-none"
                    />

                    {/* 4-strip darkened backdrop outside crop box */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 right-0 top-0 bg-black/50"
                      style={{ height: `${activeBox[0] / 10}%` }}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 right-0 bottom-0 bg-black/50"
                      style={{ top: `${activeBox[2] / 10}%` }}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 bg-black/50"
                      style={{
                        top: `${activeBox[0] / 10}%`,
                        height: `${(activeBox[2] - activeBox[0]) / 10}%`,
                        width: `${activeBox[1] / 10}%`,
                      }}
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute right-0 bg-black/50"
                      style={{
                        top: `${activeBox[0] / 10}%`,
                        height: `${(activeBox[2] - activeBox[0]) / 10}%`,
                        left: `${activeBox[3] / 10}%`,
                      }}
                    />

                    {padding > 0 && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute border border-dashed border-sky-300/90"
                        style={{
                          top: `${paddedFinalBox[0] / 10}%`,
                          left: `${paddedFinalBox[1] / 10}%`,
                          height: `${(paddedFinalBox[2] - paddedFinalBox[0]) / 10}%`,
                          width: `${(paddedFinalBox[3] - paddedFinalBox[1]) / 10}%`,
                        }}
                      />
                    )}

                    <div
                      data-testid="crop-selection-box"
                      onPointerDown={startMoveBox}
                      className="absolute border-2 border-[#D5BF50] bg-[#D5BF50]/10 cursor-move"
                      style={{
                        top: `${activeBox[0] / 10}%`,
                        left: `${activeBox[1] / 10}%`,
                        height: `${(activeBox[2] - activeBox[0]) / 10}%`,
                        width: `${(activeBox[3] - activeBox[1]) / 10}%`,
                      }}
                    >
                      <span className="pointer-events-none absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#101B45]/90 text-[#D5BF50] text-[10px] font-mono-num">
                        <Move className="w-2.5 h-2.5" />
                        {Math.round(activeBox[0] / 10)}%–{Math.round(activeBox[2] / 10)}%
                      </span>

                      <div
                        onPointerDown={(e) => startResizeBox('nw', e)}
                        className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-nwse-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('n', e)}
                        className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-3 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-ns-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('ne', e)}
                        className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-nesw-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('e', e)}
                        className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-3 h-5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-ew-resize"
                      />
                      <div
                        data-testid="crop-handle-se"
                        onPointerDown={(e) => startResizeBox('se', e)}
                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-nwse-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('s', e)}
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-3 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-ns-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('sw', e)}
                        className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-nesw-resize"
                      />
                      <div
                        onPointerDown={(e) => startResizeBox('w', e)}
                        className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-5 bg-[#D5BF50] border border-[#101B45] rounded-sm cursor-ew-resize"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Crop Preview & Coordinate Inputs */}
                <div className="lg:col-span-3 space-y-3 bg-[#0B1434] p-3.5 rounded-xl border border-white/15">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#D5BF50] mb-1.5">
                      Live Crop Preview
                    </p>
                    <div className="min-h-[120px] rounded-lg bg-white p-2 flex items-center justify-center border border-white/20">
                      <canvas
                        ref={previewCanvasRef}
                        data-testid="crop-live-preview"
                        className="max-w-full max-h-[160px] object-contain"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(['ymin', 'xmin', 'ymax', 'xmax'] as const).map((label, idx) => (
                      <label key={label} className="space-y-1">
                        <span className="text-sky-200 block uppercase font-mono text-[10px]">{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          value={activeBox[idx]}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                            const next: [number, number, number, number] = [...activeBox] as [number, number, number, number];
                            next[idx] = val;
                            setBbox(next);
                          }}
                          className="w-full px-2 py-1 rounded bg-slate-900 border border-white/20 font-mono-num"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 border border-red-400 text-xs text-red-100">{error}</div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-white/15 flex items-center justify-end gap-2 bg-[#0B122B]">
          <button
            type="button"
            onClick={props.onClose}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold cursor-pointer"
          >
            Batal
          </button>
          {canRenderStage && (
            <button
              type="button"
              disabled={saving}
              onClick={handleConfirmCrop}
              className="px-5 py-2 rounded-lg bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {saving
                ? 'Memotong Gambar...'
                : isStandalone
                ? 'Simpan Hasil Crop Manual'
                : props.assetIndex !== undefined
                ? 'Simpan Hasil Crop Ulang'
                : 'Tambahkan Potongan Gambar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
