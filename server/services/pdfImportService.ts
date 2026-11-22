import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { Type } from '@google/genai';
import { db, PDF_PAGES_DIR, QUESTION_ASSETS_DIR } from '../db';
import { runStructuredAiExtraction } from './aiProviderService';
import {
  bboxIoU,
  deduplicateAndOrderDraftAssets,
  normalizeCropBoxWithPadding,
  normalizeQuestionHash,
} from '../../src/lib/utbkLogic';
import type {
  PdfImportDraftItem,
  PdfImportJob,
  PdfPageImageMeta,
  QuestionAsset,
  TryoutDraftSubtest,
} from '../../src/types';

const execFileAsync = promisify(execFile);
const PAGES_PER_CHUNK = 4;

export interface StoredFileMeta {
  filename: string;
  storedPath: string;
  pageCount: number;
}

export interface EmbeddedImageMeta {
  page: number; // 1-indexed global page
  asset_url: string;
  width: number;
  height: number;
  sha256: string;
}

export interface ChunkRef {
  fileIndex: number;
  filename: string;
  storedPath: string;
  startPage: number; // 0-indexed within file
  endPage: number; // exclusive within file
  globalStartPage: number; // 1-indexed global page of startPage
  chunkIndex: number;
}

export async function buildChunksForFiles(
  files: StoredFileMeta[]
): Promise<{ chunks: ChunkRef[]; totalPages: number }> {
  const chunks: ChunkRef[] = [];
  let totalPages = 0;
  let chunkCounter = 0;

  for (let fIdx = 0; fIdx < files.length; fIdx++) {
    const f = files[fIdx];
    const bytes = fs.readFileSync(f.storedPath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const count = doc.getPageCount();
    f.pageCount = count;

    for (let start = 0; start < count; start += PAGES_PER_CHUNK) {
      const end = Math.min(count, start + PAGES_PER_CHUNK);
      chunks.push({
        fileIndex: fIdx,
        filename: f.filename,
        storedPath: f.storedPath,
        startPage: start,
        endPage: end,
        globalStartPage: totalPages + start + 1,
        chunkIndex: chunkCounter++,
      });
    }
    totalPages += count;
  }

  return { chunks, totalPages };
}

async function extractPdfChunkBytes(chunk: ChunkRef): Promise<string> {
  const srcBytes = fs.readFileSync(chunk.storedPath);
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const subDoc = await PDFDocument.create();
  const indices: number[] = [];
  for (let i = chunk.startPage; i < chunk.endPage; i++) {
    indices.push(i);
  }
  const copied = await subDoc.copyPages(srcDoc, indices);
  for (const page of copied) {
    subDoc.addPage(page);
  }
  const pdfBytes = await subDoc.save();
  return Buffer.from(pdfBytes).toString('base64');
}

/**
 * Condition 1: Extract raw embedded raster XObject images directly from PDF pages
 * without screenshot quality loss whenever embedded JPEG/FlateDecode images exist.
 */
export async function extractEmbeddedPdfImages(
  filesMeta: StoredFileMeta[],
  jobId: number
): Promise<Map<number, EmbeddedImageMeta[]>> {
  const byGlobalPage = new Map<number, EmbeddedImageMeta[]>();
  const shaCache = new Map<string, string>(); // sha256 -> asset_url
  let globalPageOffset = 0;

  const getNum = (dict: PDFDict, key: string): number => {
    const val = dict.lookup(PDFName.of(key));
    return val instanceof PDFNumber ? val.asNumber() : 0;
  };

  const getNameStrings = (obj: unknown): string[] => {
    if (obj instanceof PDFName) return [obj.decodeText()];
    if (obj instanceof PDFArray) {
      const out: string[] = [];
      for (let i = 0; i < obj.size(); i++) {
        const item = obj.lookup(i);
        if (item instanceof PDFName) out.push(item.decodeText());
      }
      return out;
    }
    return [];
  };

  for (let fIdx = 0; fIdx < filesMeta.length; fIdx++) {
    const file = filesMeta[fIdx];
    const bytes = fs.readFileSync(file.storedPath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = doc.getPages();

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const globalPage = globalPageOffset + pIdx + 1;
      const pageList: EmbeddedImageMeta[] = [];
      const visitedRefs = new Set<unknown>();

      const scanResources = async (resources: unknown) => {
        if (!(resources instanceof PDFDict)) return;
        const xobj = resources.lookup(PDFName.of('XObject'));
        if (!(xobj instanceof PDFDict)) return;

        for (const key of xobj.keys()) {
          const refOrObj = xobj.get(key);
          if (visitedRefs.has(refOrObj)) continue;
          visitedRefs.add(refOrObj);

          const stream = xobj.lookup(key);
          if (!(stream instanceof PDFRawStream)) continue;

          const subtype = stream.dict.lookup(PDFName.of('Subtype'));
          if (!(subtype instanceof PDFName)) continue;

          if (subtype.decodeText() === 'Form') {
            const subRes = stream.dict.lookup(PDFName.of('Resources'));
            await scanResources(subRes);
            continue;
          }

          if (subtype.decodeText() !== 'Image') continue;
          const isMask = stream.dict.lookup(PDFName.of('ImageMask'));
          if (isMask && String(isMask) === 'true') continue;

          const width = getNum(stream.dict, 'Width');
          const height = getNum(stream.dict, 'Height');
          if (width < 28 || height < 28) continue;

          const filters = getNameStrings(stream.dict.lookup(PDFName.of('Filter')));
          const rawBytes = Buffer.from(stream.contents);
          const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

          if (shaCache.has(sha256)) {
            pageList.push({
              page: globalPage,
              asset_url: shaCache.get(sha256)!,
              width,
              height,
              sha256,
            });
            continue;
          }

          if (filters.includes('DCTDecode')) {
            const filename = `emb_j${jobId}_p${globalPage}_${sha256.slice(0, 10)}.jpg`;
            fs.writeFileSync(path.join(QUESTION_ASSETS_DIR, filename), rawBytes);
            const url = `/uploads/question_assets/${filename}`;
            shaCache.set(sha256, url);
            pageList.push({ page: globalPage, asset_url: url, width, height, sha256 });
          } else if (filters.includes('FlateDecode') || filters.length === 0) {
            try {
              const decoded = filters.includes('FlateDecode') ? zlib.inflateSync(rawBytes) : rawBytes;
              const bpc = getNum(stream.dict, 'BitsPerComponent') || 8;
              if (bpc !== 8) continue;
              const cs = getNameStrings(stream.dict.lookup(PDFName.of('ColorSpace')));
              let header = '';
              let expectedLen = 0;
              if (cs.includes('DeviceRGB')) {
                header = `P6\n${width} ${height}\n255\n`;
                expectedLen = width * height * 3;
              } else if (cs.includes('DeviceGray')) {
                header = `P5\n${width} ${height}\n255\n`;
                expectedLen = width * height;
              } else {
                continue;
              }
              if (decoded.length < expectedLen) continue;
              const pnmBuf = Buffer.concat([Buffer.from(header, 'ascii'), decoded.subarray(0, expectedLen)]);
              const tmpPnm = path.join(QUESTION_ASSETS_DIR, `_tmp_${jobId}_${sha256.slice(0, 8)}.pnm`);
              const outName = `emb_j${jobId}_p${globalPage}_${sha256.slice(0, 10)}.png`;
              const outPath = path.join(QUESTION_ASSETS_DIR, outName);
              fs.writeFileSync(tmpPnm, pnmBuf);
              await execFileAsync('convert', [tmpPnm, outPath]);
              if (fs.existsSync(tmpPnm)) fs.unlinkSync(tmpPnm);
              const url = `/uploads/question_assets/${outName}`;
              shaCache.set(sha256, url);
              pageList.push({ page: globalPage, asset_url: url, width, height, sha256 });
            } catch {
              // Fall back gracefully to Ghostscript page raster crop if exotic PDF encoding
            }
          }
        }
      };

      await scanResources(pages[pIdx].node.Resources());
      if (pageList.length > 0) {
        byGlobalPage.set(globalPage, pageList);
      }
    }

    globalPageOffset += pages.length;
  }

  return byGlobalPage;
}

/**
 * Renders every PDF page cleanly to 180-DPI PNG using Ghostscript without touching source PDFs.
 */
export async function renderPdfPagesToImages(
  filesMeta: StoredFileMeta[],
  jobId: number
): Promise<PdfPageImageMeta[]> {
  const pageImages: PdfPageImageMeta[] = [];
  let globalPageCounter = 0;

  for (let fIdx = 0; fIdx < filesMeta.length; fIdx++) {
    const file = filesMeta[fIdx];
    const pattern = path.join(PDF_PAGES_DIR, `job_${jobId}_f${fIdx}_p%04d.png`);
    await execFileAsync('gs', [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=png16m',
      '-r180',
      `-sOutputFile=${pattern}`,
      file.storedPath,
    ]);

    const count = file.pageCount || 1;
    for (let fp = 1; fp <= count; fp++) {
      globalPageCounter += 1;
      const padded = String(fp).padStart(4, '0');
      const pngName = `job_${jobId}_f${fIdx}_p${padded}.png`;
      const pngPath = path.join(PDF_PAGES_DIR, pngName);
      if (!fs.existsSync(pngPath)) continue;

      let width = 1240;
      let height = 1754;
      try {
        const { stdout } = await execFileAsync('identify', ['-format', '%w %h', pngPath]);
        const parts = stdout.trim().split(/\s+/);
        width = Number(parts[0]) || width;
        height = Number(parts[1]) || height;
      } catch {
        // default A4 180dpi fallback
      }

      pageImages.push({
        page: globalPageCounter,
        file_index: fIdx,
        file_page: fp,
        filename: file.filename,
        image_url: `/uploads/pdf_pages/${pngName}`,
        width,
        height,
      });
    }
  }

  return pageImages;
}

/**
 * Crops a region from a rendered PDF page PNG with generous margin safety padding.
 */
export async function cropPdfPageRegion(opts: {
  pageMeta: PdfPageImageMeta;
  bbox: [number, number, number, number];
  jobId: number;
  padding?: number;
  prefix?: string;
}): Promise<{ asset_url: string; crop_box: [number, number, number, number] }> {
  const padded = normalizeCropBoxWithPadding(opts.bbox, opts.padding ?? 28);
  const [ymin, xmin, ymax, xmax] = padded;

  const pxX = Math.max(0, Math.floor((xmin / 1000) * opts.pageMeta.width));
  const pxY = Math.max(0, Math.floor((ymin / 1000) * opts.pageMeta.height));
  const pxW = Math.max(32, Math.min(opts.pageMeta.width - pxX, Math.ceil(((xmax - xmin) / 1000) * opts.pageMeta.width)));
  const pxH = Math.max(32, Math.min(opts.pageMeta.height - pxY, Math.ceil(((ymax - ymin) / 1000) * opts.pageMeta.height)));

  const sourcePngName = path.basename(opts.pageMeta.image_url);
  const sourcePngPath = path.join(PDF_PAGES_DIR, sourcePngName);
  const outName = `${opts.prefix || 'crop'}_j${opts.jobId}_p${opts.pageMeta.page}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 6)}.png`;
  const outPath = path.join(QUESTION_ASSETS_DIR, outName);

  await execFileAsync('convert', [sourcePngPath, '-crop', `${pxW}x${pxH}+${pxX}+${pxY}`, '+repage', outPath]);

  return {
    asset_url: `/uploads/question_assets/${outName}`,
    crop_box: padded,
  };
}

export interface AiVisualRegionRaw {
  page_in_chunk?: number;
  bbox?: number[];
  visual_type?: string;
  label?: string;
  shared_group_key?: string;
}

export interface AiChunkQuestionRaw {
  question_number?: number;
  page_in_chunk?: number;
  subtest?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  question_type?: string;
  question_text?: string;
  has_visual?: boolean;
  visual_description?: string;
  visual_regions?: AiVisualRegionRaw[];
  options?: Array<{ key?: string; content?: string }>;
  correct_answer?: string[];
  explanation_text?: string;
  solution_text?: string;
  needs_manual_review?: boolean;
  review_note?: string;
}

interface AiChunkSectionRaw {
  detected_heading?: string;
  subtest_name?: string;
  subtest_code?: string;
  start_number?: number;
  end_number?: number;
  suggested_duration_minutes?: number;
}

async function extractChunkWithAi(
  chunk: ChunkRef,
  chunkPageImages: PdfPageImageMeta[],
  opts: {
    targetType: 'drill' | 'tryout';
    uploadMode: 'by_topic' | 'random' | 'tryout';
    defaultSubtest: string;
    defaultTopic: string;
    defaultSubtopic: string;
  }
): Promise<{ questions: AiChunkQuestionRaw[]; sections: AiChunkSectionRaw[] }> {
  const base64Pdf = await extractPdfChunkBytes(chunk);
  const chunkPageCount = chunk.endPage - chunk.startPage;

  const modeNote =
    opts.targetType === 'tryout'
      ? `Dokumen ini adalah PAKET TRY OUT UTBK/SNBT. Selain mengekstrak setiap soal satu per satu, deteksi SEMUA judul/penanda batas subtest yang muncul pada halaman-halaman ini ke dalam array "sections" lengkap dengan rentang nomor soalnya (start_number sampai end_number) tanpa mengasumsikan jumlah soal tetap.`
      : opts.uploadMode === 'by_topic'
      ? `Mode Upload: Berdasarkan Materi (Default Subtest: "${opts.defaultSubtest}", Materi Utama: "${opts.defaultTopic || 'deteksi otomatis'}", Submateri: "${opts.defaultSubtopic || 'deteksi otomatis'}"). Tetap analisis isi SETIAP soal secara individual untuk menentukan materi dan submateri yang paling akurat.`
      : `Mode Upload: Soal Acak. Analisis isi SETIAP soal secara individual untuk mengklasifikasikan subtest, topic (materi), dan subtopic (submateri) secara otomatis berdasarkan isi soal.`;

  const prompt = `Anda adalah sistem ekstraksi soal UTBK/SNBT presisi tinggi dengan kemampuan OCR visual & deteksi lokasi gambar/diagram/grafik.

Potongan ini berisi ${chunkPageCount} halaman (halaman asli ${chunk.startPage + 1}–${chunk.endPage} dari file "${chunk.filename}"). Di dalam potongan ini, page_in_chunk bernomor 1 s.d. ${chunkPageCount}.
${modeNote}

ATURAN WAJIB (TIDAK BOLEH DILANGGAR):
1. Pecah setiap nomor soal menjadi SATU objek terpisah di array "questions". Jangan pernah menggabungkan dua nomor soal menjadi satu item.
2. JANGAN PERNAH MENGARANG kunci jawaban ("correct_answer") atau pembahasan ("explanation_text"/"solution_text") jika tidak tertulis di PDF! Jika tidak tercantum, kosongkan dan set "needs_manual_review": true.
3. Konversi rumus ke format LaTeX ($...$ / $$...$$) dan pertahankan tabel teks sebagai Markdown jika memungkinkan.
4. EKSTRAKSI GAMBAR / DIAGRAM / GRAFIK / VISUAL:
   - Setiap kali soal mengandung atau merujuk pada gambar, foto, diagram, grafik, kurva, bangun geometri, pola gambar, tabel bergambar, atau ilustrasi visual apa pun (MESKIPUN abstrak, tidak terbaca, atau Anda tidak yakin artinya):
     * WAJIB set "has_visual": true dan "page_in_chunk" sesuai halaman (1..${chunkPageCount}).
     * WAJIB isi "visual_regions" dengan daftar setiap area visual milik soal tersebut (bisa 1, 2, atau lebih gambar jika soal punya banyak gambar!).
     * Pada setiap objek di "visual_regions", sertakan:
       - "page_in_chunk": nomor halaman dalam potongan ini (1..${chunkPageCount})
       - "bbox": koordinat [ymin, xmin, ymax, xmax] dalam skala 0..1000 yang mencakup SELURUH gambar beserta sumbu grafik, angka, huruf sudut, keterangan/label di sekelilingnya (lebih baik sedikit lebih longgar daripada terpotong!).
       - "visual_type": pilih salah satu "photo", "diagram", "chart", "mixed", "abstract"
       - "label": keterangan singkat gambar
       - "shared_group_key": JIKA satu gambar/diagram/infografis yang sama dipakai bersama oleh beberapa soal (misalnya "Perhatikan gambar berikut untuk soal nomor 5 dan 6"), gunakan string "shared_group_key" YANG PERSIS SAMA (misal "fig_p2_shared_1") pada semua soal yang merujuk gambar tersebut!
   - JANGAN PERNAH mengabaikan atau membuang visual meskipun AI tidak dapat menginterpretasikan maknanya; tetap kembalikan "has_visual": true + "visual_regions" dan beri catatan "needs_manual_review": true.
5. Pilihan jawaban standar gunakan key "A", "B", "C", "D", "E" jika tersedia.
6. Kembalikan HANYA JSON objek valid dengan properti "sections" (array) dan "questions" (array).`;

  const openAiContentParts: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
  > = [{ type: 'text', text: prompt }];

  for (const pm of chunkPageImages) {
    const filePath = path.join(PDF_PAGES_DIR, path.basename(pm.image_url));
    if (fs.existsSync(filePath)) {
      const b64Img = fs.readFileSync(filePath).toString('base64');
      openAiContentParts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64Img}`, detail: 'high' },
      });
    }
  }

  const result = await runStructuredAiExtraction<{
    questions?: AiChunkQuestionRaw[];
    sections?: AiChunkSectionRaw[];
  }>({
    operation: `pdf_chunk_${opts.targetType}`,
    geminiParts: [
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Pdf,
        },
      },
      { text: prompt },
    ],
    openAiMessages: [
      {
        role: 'system',
        content: 'You are a precise Indonesian UTBK/SNBT PDF question extraction engine. Return strict JSON object only with keys "sections" and "questions".',
      },
      {
        role: 'user',
        content: openAiContentParts,
      },
    ],
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              detected_heading: { type: Type.STRING },
              subtest_name: { type: Type.STRING },
              subtest_code: { type: Type.STRING },
              start_number: { type: Type.INTEGER },
              end_number: { type: Type.INTEGER },
              suggested_duration_minutes: { type: Type.INTEGER },
            },
          },
        },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question_number: { type: Type.INTEGER },
              page_in_chunk: { type: Type.INTEGER },
              subtest: { type: Type.STRING },
              topic: { type: Type.STRING },
              subtopic: { type: Type.STRING },
              difficulty: { type: Type.STRING },
              question_type: { type: Type.STRING },
              question_text: { type: Type.STRING },
              has_visual: { type: Type.BOOLEAN },
              visual_description: { type: Type.STRING },
              visual_regions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    page_in_chunk: { type: Type.INTEGER },
                    bbox: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                    },
                    visual_type: { type: Type.STRING },
                    label: { type: Type.STRING },
                    shared_group_key: { type: Type.STRING },
                  },
                },
              },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                },
              },
              correct_answer: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              explanation_text: { type: Type.STRING },
              solution_text: { type: Type.STRING },
              needs_manual_review: { type: Type.BOOLEAN },
              review_note: { type: Type.STRING },
            },
          },
        },
      },
    },
  });

  return {
    questions: Array.isArray(result.data.questions) ? result.data.questions : [],
    sections: Array.isArray(result.data.sections) ? result.data.sections : [],
  };
}

export interface SharedCropEntry {
  page: number;
  bbox: [number, number, number, number];
  sharedKey?: string;
  asset_url: string;
  asset_type: 'embedded' | 'cropped' | 'shared';
}

export async function resolveAssetsForRawQuestions(
  rawItems: AiChunkQuestionRaw[],
  chunk: ChunkRef,
  opts: {
    jobId: number;
    targetType: 'drill' | 'tryout';
    defaultSubtest: string;
    defaultTopic: string;
    defaultSubtopic: string;
    existingHashes: Set<string>;
    pageImagesByPage: Map<number, PdfPageImageMeta>;
    embeddedByPage: Map<number, EmbeddedImageMeta[]>;
    sharedCropCache: SharedCropEntry[];
  },
  runningCounter: { value: number }
): Promise<PdfImportDraftItem[]> {
  const results: PdfImportDraftItem[] = [];
  const filtered = rawItems.filter((r) => (r.question_text || '').trim().length > 0);

  for (const r of filtered) {
    runningCounter.value += 1;
    const qNum = Number(r.question_number) || runningCounter.value;
    const pageInChunk = Math.max(1, Math.min(chunk.endPage - chunk.startPage, Number(r.page_in_chunk) || 1));
    const defaultGlobalPage = chunk.globalStartPage + pageInChunk - 1;

    const options = Array.isArray(r.options)
      ? r.options
          .map((o, idx) => ({
            key: (o.key || String.fromCharCode(65 + idx)).trim().toUpperCase(),
            content: (o.content || '').trim(),
          }))
          .filter((o) => o.content.length > 0)
      : [];

    const correct = Array.isArray(r.correct_answer)
      ? r.correct_answer.map((k) => String(k).trim().toUpperCase()).filter(Boolean)
      : [];
    const explanation = (r.explanation_text || '').trim();
    const qText = (r.question_text || '').trim();
    const hash = normalizeQuestionHash(qText);
    const isDuplicate = opts.targetType === 'drill' && hash.length > 0 && opts.existingHashes.has(hash);

    const regions = Array.isArray(r.visual_regions) ? r.visual_regions : [];
    const hasVisual = Boolean(r.has_visual || regions.length > 0);
    const resolvedAssets: QuestionAsset[] = [];

    for (let rIdx = 0; rIdx < regions.length; rIdx++) {
      const reg = regions[rIdx];
      const regPageInChunk = Math.max(
        1,
        Math.min(chunk.endPage - chunk.startPage, Number(reg.page_in_chunk || pageInChunk) || 1)
      );
      const regGlobalPage = chunk.globalStartPage + regPageInChunk - 1;
      const pageMeta = opts.pageImagesByPage.get(regGlobalPage) || opts.pageImagesByPage.get(defaultGlobalPage);
      const rawBbox = Array.isArray(reg.bbox) && reg.bbox.length === 4 ? reg.bbox : null;
      const bbox: [number, number, number, number] = rawBbox
        ? [Number(rawBbox[0]), Number(rawBbox[1]), Number(rawBbox[2]), Number(rawBbox[3])]
        : [80, 60, 560, 940];

      const sharedKey = (reg.shared_group_key || '').trim();
      const cachedMatch = opts.sharedCropCache.find(
        (c) =>
          (sharedKey && c.sharedKey === sharedKey) ||
          (c.page === regGlobalPage && bboxIoU(c.bbox, bbox) >= 0.72)
      );

      if (cachedMatch) {
        resolvedAssets.push({
          temp_id: `ast_${opts.jobId}_${runningCounter.value}_${rIdx}`,
          asset_url: cachedMatch.asset_url,
          asset_type: 'shared',
          display_order: resolvedAssets.length,
          source_page: regGlobalPage,
          crop_box: cachedMatch.bbox,
          is_shared: true,
          caption: (reg.label || '').trim(),
        });
        continue;
      }

      // Condition 1: Prefer lossless embedded raster XObject when visual_type is 'photo' or single standalone image matching aspect ratio
      const embeddedOnPage = opts.embeddedByPage.get(regGlobalPage) || [];
      let chosenEmbedded: EmbeddedImageMeta | null = null;
      if (embeddedOnPage.length > 0 && reg.visual_type !== 'chart' && reg.visual_type !== 'diagram') {
        const bboxW = Math.max(1, bbox[3] - bbox[1]);
        const bboxH = Math.max(1, bbox[2] - bbox[0]);
        const bboxRatio = (bboxW * (pageMeta?.width || 1240)) / (bboxH * (pageMeta?.height || 1754));
        const match = embeddedOnPage.find((e) => {
          const embRatio = e.width / Math.max(1, e.height);
          const diff = Math.abs(embRatio - bboxRatio) / Math.max(embRatio, bboxRatio);
          return diff <= 0.35;
        });
        if (match && (embeddedOnPage.length === 1 || reg.visual_type === 'photo')) {
          chosenEmbedded = match;
        }
      }

      if (chosenEmbedded) {
        opts.sharedCropCache.push({
          page: regGlobalPage,
          bbox,
          sharedKey: sharedKey || undefined,
          asset_url: chosenEmbedded.asset_url,
          asset_type: 'embedded',
        });
        resolvedAssets.push({
          temp_id: `ast_${opts.jobId}_${runningCounter.value}_${rIdx}`,
          asset_url: chosenEmbedded.asset_url,
          asset_type: 'embedded',
          display_order: resolvedAssets.length,
          source_page: regGlobalPage,
          crop_box: bbox,
          is_shared: Boolean(sharedKey),
          caption: (reg.label || '').trim(),
        });
      } else if (pageMeta) {
        // Condition 2 & 3: High-DPI rendered page crop with generous padding to protect labels, axes, and uninterpretable visuals
        try {
          const cropped = await cropPdfPageRegion({
            pageMeta,
            bbox,
            jobId: opts.jobId,
            padding: 28,
            prefix: 'qcrop',
          });
          opts.sharedCropCache.push({
            page: regGlobalPage,
            bbox: cropped.crop_box,
            sharedKey: sharedKey || undefined,
            asset_url: cropped.asset_url,
            asset_type: 'cropped',
          });
          resolvedAssets.push({
            temp_id: `ast_${opts.jobId}_${runningCounter.value}_${rIdx}`,
            asset_url: cropped.asset_url,
            asset_type: 'cropped',
            display_order: resolvedAssets.length,
            source_page: regGlobalPage,
            crop_box: cropped.crop_box,
            is_shared: Boolean(sharedKey),
            caption: (reg.label || '').trim(),
          });
        } catch {
          // If convert crop failed, fallback to embedded image if present
          if (embeddedOnPage[0]) {
            resolvedAssets.push({
              temp_id: `ast_${opts.jobId}_${runningCounter.value}_${rIdx}`,
              asset_url: embeddedOnPage[0].asset_url,
              asset_type: 'embedded',
              display_order: resolvedAssets.length,
              source_page: regGlobalPage,
              crop_box: null,
              is_shared: false,
              caption: (reg.label || '').trim(),
            });
          }
        }
      }
    }

    // Condition 3 Fallback: Question marked as having visual content yet AI omitted visual_regions
    if (hasVisual && resolvedAssets.length === 0) {
      const embeddedFallback = opts.embeddedByPage.get(defaultGlobalPage) || [];
      if (embeddedFallback.length > 0) {
        embeddedFallback.forEach((emb, eIdx) => {
          resolvedAssets.push({
            temp_id: `ast_fb_${opts.jobId}_${runningCounter.value}_${eIdx}`,
            asset_url: emb.asset_url,
            asset_type: 'embedded',
            display_order: resolvedAssets.length,
            source_page: defaultGlobalPage,
            crop_box: null,
            is_shared: false,
            caption: 'Gambar diekstrak langsung dari halaman PDF',
          });
        });
      } else {
        const pageMeta = opts.pageImagesByPage.get(defaultGlobalPage);
        if (pageMeta) {
          try {
            const cropped = await cropPdfPageRegion({
              pageMeta,
              bbox: [60, 40, 920, 960],
              jobId: opts.jobId,
              padding: 20,
              prefix: 'qfallback',
            });
            resolvedAssets.push({
              temp_id: `ast_fb_${opts.jobId}_${runningCounter.value}_0`,
              asset_url: cropped.asset_url,
              asset_type: 'cropped',
              display_order: 0,
              source_page: defaultGlobalPage,
              crop_box: cropped.crop_box,
              is_shared: false,
              caption: 'Potongan halaman otomatis (tinjau & sesuaikan area crop bila perlu)',
            });
          } catch {
            // ignore
          }
        }
      }
    }

    const orderedAssets = deduplicateAndOrderDraftAssets(resolvedAssets);

    const notes: string[] = [];
    if (r.review_note) notes.push(r.review_note.trim());
    if (correct.length === 0) notes.push('Kunci jawaban tidak tercantum di PDF.');
    if (!explanation) notes.push('Pembahasan belum tersedia di PDF.');
    if (hasVisual && orderedAssets.length === 0) {
      notes.push('Memuat gambar/diagram namun belum ada gambar terekstrak — mohon unggah atau crop manual.');
    } else if (hasVisual) {
      notes.push('Memuat gambar/diagram — periksa hasil crop di preview.');
    }
    if (isDuplicate) notes.push('Terindikasi duplikat dengan soal di Question Bank.');

    const needsReview = Boolean(
      r.needs_manual_review || correct.length === 0 || !explanation || hasVisual || isDuplicate
    );
    const diffRaw = (r.difficulty || 'medium').toLowerCase();
    const difficulty = diffRaw === 'easy' || diffRaw === 'hard' || diffRaw === 'medium' ? diffRaw : 'medium';

    results.push({
      temp_id: `chunk${chunk.chunkIndex}_q${runningCounter.value}_${Date.now()}`,
      question_number: qNum,
      external_code: `${opts.targetType === 'tryout' ? 'TO' : 'DR'}-${qNum}`,
      subtest: (r.subtest || opts.defaultSubtest || 'Penalaran Umum').trim(),
      topic: (r.topic || opts.defaultTopic || 'Umum').trim(),
      subtopic: (r.subtopic || opts.defaultSubtopic || '').trim(),
      difficulty,
      question_type: r.question_type === 'multiple_choice' || correct.length > 1 ? 'multiple_choice' : 'single_choice',
      question_text: qText,
      image_url: orderedAssets[0]?.asset_url || null,
      assets: orderedAssets,
      source_page: orderedAssets[0]?.source_page || defaultGlobalPage,
      has_visual: hasVisual,
      visual_description: (r.visual_description || '').trim(),
      options,
      correct_answer: correct,
      explanation_text: explanation,
      solution_text: (r.solution_text || '').trim(),
      needs_review: needsReview,
      review_note: Array.from(new Set(notes)).join(' '),
      is_duplicate: isDuplicate,
      source_file: chunk.filename,
      chunk_index: chunk.chunkIndex,
    });
  }

  return results;
}

function mergeTryoutSections(
  rawSections: AiChunkSectionRaw[],
  questions: PdfImportDraftItem[]
): TryoutDraftSubtest[] {
  if (rawSections.length === 0) {
    const grouped: TryoutDraftSubtest[] = [];
    const sorted = [...questions].sort((a, b) => a.question_number - b.question_number);
    for (const q of sorted) {
      const subName = q.subtest || 'Subtest 1';
      const last = grouped[grouped.length - 1];
      if (!last || last.subtest_name.toLowerCase() !== subName.toLowerCase()) {
        const order = grouped.length + 1;
        grouped.push({
          temp_id: `sub_${order}`,
          subtest_code:
            subName
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 5) || `S${order}`,
          subtest_name: subName,
          duration_seconds: 1500,
          sort_order: order,
          start_number: q.question_number,
          end_number: q.question_number,
          detected_heading: subName,
        });
      } else {
        last.end_number = Math.max(last.end_number, q.question_number);
      }
    }
    return grouped;
  }

  const merged: TryoutDraftSubtest[] = [];
  for (const sec of rawSections) {
    const name = (sec.subtest_name || sec.detected_heading || 'Subtest').trim();
    const startNum = Number(sec.start_number) || 1;
    const endNum = Math.max(startNum, Number(sec.end_number) || startNum);
    const existing = merged.find((m) => m.subtest_name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.start_number = Math.min(existing.start_number, startNum);
      existing.end_number = Math.max(existing.end_number, endNum);
    } else {
      const order = merged.length + 1;
      merged.push({
        temp_id: `sub_${order}`,
        subtest_code:
          (sec.subtest_code || '').trim().toUpperCase() ||
          name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 5) ||
          `S${order}`,
        subtest_name: name,
        duration_seconds: Math.max(300, (Number(sec.suggested_duration_minutes) || 25) * 60),
        sort_order: order,
        start_number: startNum,
        end_number: endNum,
        detected_heading: sec.detected_heading || name,
      });
    }
  }
  return merged;
}

export function formatPdfJobRow(row: Record<string, unknown>): PdfImportJob {
  const filesRaw = JSON.parse(String(row.files_json || '[]')) as StoredFileMeta[];
  return {
    id: Number(row.id),
    target_type: row.target_type as 'drill' | 'tryout',
    upload_mode: row.upload_mode as 'by_topic' | 'random' | 'tryout',
    default_subtest: String(row.default_subtest || 'Penalaran Umum'),
    default_topic: String(row.default_topic || ''),
    default_subtopic: String(row.default_subtopic || ''),
    package_title: String(row.package_title || ''),
    package_provider: String(row.package_provider || ''),
    package_description: String(row.package_description || ''),
    files: filesRaw.map((f) => ({ filename: f.filename, pageCount: f.pageCount || 0 })),
    page_images: JSON.parse(String(row.page_images_json || '[]')),
    status: row.status as PdfImportJob['status'],
    total_pages: Number(row.total_pages || 0),
    processed_chunks: Number(row.processed_chunks || 0),
    total_chunks: Number(row.total_chunks || 0),
    draft_questions: JSON.parse(String(row.draft_questions_json || '[]')),
    draft_subtests: JSON.parse(String(row.draft_subtests_json || '[]')),
    error_message: String(row.error_message || ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function createAndRunPdfImportJob(params: {
  targetType: 'drill' | 'tryout';
  uploadMode: 'by_topic' | 'random' | 'tryout';
  defaultSubtest: string;
  defaultTopic: string;
  defaultSubtopic: string;
  packageTitle?: string;
  packageProvider?: string;
  packageDescription?: string;
  uploadedFiles: Array<{ originalname: string; path: string }>;
  userId: number;
}): Promise<PdfImportJob> {
  const filesMeta: StoredFileMeta[] = params.uploadedFiles.map((f) => ({
    filename: f.originalname,
    storedPath: f.path,
    pageCount: 0,
  }));

  const { chunks, totalPages } = await buildChunksForFiles(filesMeta);
  const nowIso = new Date().toISOString();

  const jobId = Number(
    db
      .prepare(
        `INSERT INTO pdf_import_jobs
         (target_type, upload_mode, default_subtest, default_topic, default_subtopic, package_title, package_provider, package_description, files_json, status, total_pages, processed_chunks, total_chunks, draft_questions_json, draft_subtests_json, page_images_json, error_message, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, 0, ?, '[]', '[]', '[]', '', ?, ?, ?)`
      )
      .run(
        params.targetType,
        params.uploadMode,
        params.defaultSubtest,
        params.defaultTopic,
        params.defaultSubtopic,
        params.packageTitle || '',
        params.packageProvider || '',
        params.packageDescription || '',
        JSON.stringify(filesMeta),
        totalPages,
        chunks.length,
        params.userId,
        nowIso,
        nowIso
      ).lastInsertRowid
  );

  void processPdfImportJob(jobId, chunks, filesMeta);

  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
  return formatPdfJobRow(row);
}

async function processPdfImportJob(jobId: number, chunks: ChunkRef[], filesMeta: StoredFileMeta[]): Promise<void> {
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row) return;

  const targetType = row.target_type as 'drill' | 'tryout';
  const uploadMode = row.upload_mode as 'by_topic' | 'random' | 'tryout';
  const defaultSubtest = String(row.default_subtest || 'Penalaran Umum');
  const defaultTopic = String(row.default_topic || '');
  const defaultSubtopic = String(row.default_subtopic || '');

  const existingHashes = new Set(
    (
      db
        .prepare("SELECT content_hash FROM questions WHERE content_hash IS NOT NULL AND content_hash != ''")
        .all() as Array<{ content_hash: string }>
    ).map((r) => r.content_hash)
  );

  const allQuestions: PdfImportDraftItem[] = [];
  const allSections: AiChunkSectionRaw[] = [];
  const runningCounter = { value: 0 };
  const sharedCropCache: SharedCropEntry[] = [];

  try {
    // Step 1: Render PDF pages cleanly (for cropping + admin visual re-crop) & extract embedded XObjects (Condition 1)
    const [pageImages, embeddedByPage] = await Promise.all([
      renderPdfPagesToImages(filesMeta, jobId),
      extractEmbeddedPdfImages(filesMeta, jobId),
    ]);

    const pageImagesByPage = new Map<number, PdfPageImageMeta>();
    for (const p of pageImages) {
      pageImagesByPage.set(p.page, p);
    }

    db.prepare('UPDATE pdf_import_jobs SET page_images_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(pageImages),
      new Date().toISOString(),
      jobId
    );

    // Step 2: Process PDF chunks via Multi-AI Provider service & resolve embedded/cropped/shared assets
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkPages: PdfPageImageMeta[] = [];
      for (let gp = chunk.globalStartPage; gp < chunk.globalStartPage + (chunk.endPage - chunk.startPage); gp++) {
        const pm = pageImagesByPage.get(gp);
        if (pm) chunkPages.push(pm);
      }
      const extracted = await extractChunkWithAi(chunk, chunkPages, {
        targetType,
        uploadMode,
        defaultSubtest,
        defaultTopic,
        defaultSubtopic,
      });

      const normalized = await resolveAssetsForRawQuestions(
        extracted.questions,
        chunk,
        {
          jobId,
          targetType,
          defaultSubtest,
          defaultTopic,
          defaultSubtopic,
          existingHashes,
          pageImagesByPage,
          embeddedByPage,
          sharedCropCache,
        },
        runningCounter
      );

      allQuestions.push(...normalized);
      allSections.push(...extracted.sections);

      db.prepare(
        'UPDATE pdf_import_jobs SET processed_chunks = ?, draft_questions_json = ?, updated_at = ? WHERE id = ?'
      ).run(i + 1, JSON.stringify(allQuestions), new Date().toISOString(), jobId);
    }

    const draftSubtests = targetType === 'tryout' ? mergeTryoutSections(allSections, allQuestions) : [];

    if (targetType === 'tryout' && draftSubtests.length > 0) {
      for (const q of allQuestions) {
        const match = draftSubtests.find(
          (s) => q.question_number >= s.start_number && q.question_number <= s.end_number
        );
        if (match) {
          q.subtest_temp_id = match.temp_id;
          q.subtest = match.subtest_name;
        }
      }
    }

    db.prepare(
      `UPDATE pdf_import_jobs
       SET status = 'preview_ready', files_json = ?, page_images_json = ?, draft_questions_json = ?, draft_subtests_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      JSON.stringify(filesMeta),
      JSON.stringify(pageImages),
      JSON.stringify(allQuestions),
      JSON.stringify(draftSubtests),
      new Date().toISOString(),
      jobId
    );
  } catch (err) {
    db.prepare(
      "UPDATE pdf_import_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
    ).run(err instanceof Error ? err.message : 'Gagal mengekstrak PDF dengan AI.', new Date().toISOString(), jobId);
  }
}

export async function reextractPdfImportJob(jobId: number): Promise<PdfImportJob> {
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('Job import PDF tidak ditemukan.');
  }
  const filesMeta = JSON.parse(String(row.files_json || '[]')) as StoredFileMeta[];
  if (filesMeta.length === 0 || !fs.existsSync(filesMeta[0].storedPath)) {
    throw new Error('File PDF sumber sudah tidak tersedia di penyimpanan sementara.');
  }
  const { chunks, totalPages } = await buildChunksForFiles(filesMeta);
  db.prepare(
    "UPDATE pdf_import_jobs SET status = 'processing', processed_chunks = 0, total_chunks = ?, total_pages = ?, error_message = '', updated_at = ? WHERE id = ?"
  ).run(chunks.length, totalPages, new Date().toISOString(), jobId);

  void processPdfImportJob(jobId, chunks, filesMeta);
  const updated = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
  return formatPdfJobRow(updated);
}

export async function recropPdfJobQuestionAsset(
  jobId: number,
  params: {
    temp_id: string;
    asset_index?: number;
    page: number;
    bbox: [number, number, number, number];
    caption?: string;
    padding?: number;
  }
): Promise<{ job: PdfImportJob; asset: QuestionAsset }> {
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('Job import PDF tidak ditemukan.');
  }

  let pageImages = JSON.parse(String(row.page_images_json || '[]')) as PdfPageImageMeta[];
  if (pageImages.length === 0) {
    const filesMeta = JSON.parse(String(row.files_json || '[]')) as StoredFileMeta[];
    if (filesMeta.length > 0 && fs.existsSync(filesMeta[0].storedPath)) {
      pageImages = await renderPdfPagesToImages(filesMeta, jobId);
      db.prepare('UPDATE pdf_import_jobs SET page_images_json = ? WHERE id = ?').run(JSON.stringify(pageImages), jobId);
    }
  }

  const pageMeta = pageImages.find((p) => p.page === Number(params.page)) || pageImages[0];
  if (!pageMeta) {
    throw new Error('Halaman PDF yang dipilih tidak tersedia untuk di-crop.');
  }

  const cropped = await cropPdfPageRegion({
    pageMeta,
    bbox: params.bbox,
    jobId,
    padding: params.padding ?? 8,
    prefix: 'recrop',
  });

  const drafts = JSON.parse(String(row.draft_questions_json || '[]')) as PdfImportDraftItem[];
  const targetIdx = drafts.findIndex((d) => d.temp_id === params.temp_id);
  if (targetIdx < 0) {
    throw new Error('Draft soal tidak ditemukan.');
  }

  const item = drafts[targetIdx];
  const currentAssets: QuestionAsset[] = Array.isArray(item.assets) ? [...item.assets] : [];
  if (currentAssets.length === 0 && item.image_url) {
    currentAssets.push({
      asset_url: item.image_url,
      asset_type: 'manual',
      display_order: 0,
      source_page: item.source_page || pageMeta.page,
    });
  }

  const newAsset: QuestionAsset = {
    temp_id: `recrop_${Date.now()}`,
    asset_url: cropped.asset_url,
    asset_type: 'cropped',
    display_order:
      typeof params.asset_index === 'number' && params.asset_index >= 0 && params.asset_index < currentAssets.length
        ? params.asset_index
        : currentAssets.length,
    source_page: pageMeta.page,
    crop_box: cropped.crop_box,
    is_shared: false,
    caption: params.caption ?? currentAssets[params.asset_index ?? -1]?.caption ?? '',
  };

  if (typeof params.asset_index === 'number' && params.asset_index >= 0 && params.asset_index < currentAssets.length) {
    currentAssets[params.asset_index] = newAsset;
  } else {
    currentAssets.push(newAsset);
  }

  const normalizedAssets = deduplicateAndOrderDraftAssets(currentAssets);
  drafts[targetIdx] = {
    ...item,
    assets: normalizedAssets,
    image_url: normalizedAssets[0]?.asset_url || null,
    has_visual: normalizedAssets.length > 0 || item.has_visual,
    source_page: pageMeta.page,
  };

  db.prepare('UPDATE pdf_import_jobs SET draft_questions_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(drafts),
    new Date().toISOString(),
    jobId
  );

  const updatedRow = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
  return { job: formatPdfJobRow(updatedRow), asset: newAsset };
}
