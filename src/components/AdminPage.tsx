import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Crop,
  FileText,
  Image as ImageIcon,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  UserX,
  X,
} from 'lucide-react';
import { apiFetch, getAuthHeaders, parseJsonResponse } from '../utils/api';
import { deduplicateAndOrderDraftAssets, findVisualMissingWarnings } from '../lib/utbkLogic';
import {
  SUBTESTS,
  type AiProviderConfig,
  type AiRequestLog,
  type CountdownEvent,
  type DwuSchedule,
  type PageRoute,
  type PdfImportDraftItem,
  type PdfImportJob,
  type Question,
  type QuestionAsset,
  type QuestionOption,
  type ScoringConfig,
  type SiteAssetCategory,
  type SiteAssetConfig,
  type ThemeSettings,
  type TryoutCarouselCard,
  type TryoutDraftSubtest,
  type TryoutPackage,
  type User,
  type UserRole,
  type VisualAssets,
} from '../types';
import { FloatingBackButton } from './FloatingBackButton';
import { QuestionReviewConsole } from './QuestionReviewConsole';
import { VisualCropModal } from './VisualCropModal';

interface AdminPageProps {
  user: User;
  theme: ThemeSettings;
  visualAssets: VisualAssets;
  scoringConfig: ScoringConfig;
  packages: TryoutPackage[];
  onRefreshBootstrap: () => Promise<void>;
  onRefreshPackages: () => Promise<void>;
  onNavigate: (page: PageRoute) => void;
}

interface AdminOverview {
  memberCount: number;
  questionCount: number;
  tryoutQuestionCount?: number;
  packageCount: number;
  completedTryoutCount: number;
  pendingReportsCount: number;
  pendingReviewCount?: number;
  recentLogs: Array<{ id: number; action: string; details: string; created_at: string; username: string | null }>;
}

interface AdminUserRow extends User {
  completed_tryouts: number;
  drill_count: number;
}

interface TryoutQuestionRow {
  id: number;
  package_id: number;
  subtest_id: number;
  question_number: number;
  external_code: string;
  subtest: string;
  topic: string;
  question_text: string;
  image_url: string | null;
  assets?: QuestionAsset[];
  options: QuestionOption[];
  correct_answer: string[];
  explanation_text: string;
  solution_text: string;
  needs_review: boolean;
}

export function AdminPage({
  user,
  theme,
  visualAssets,
  scoringConfig,
  packages,
  onRefreshBootstrap,
  onRefreshPackages,
  onNavigate,
}: AdminPageProps) {
  const isSuperAdmin = user.role === 'super_admin';

  const [tab, setTab] = useState<
    | 'overview'
    | 'review_console'
    | 'users'
    | 'tryout_pdf'
    | 'packages'
    | 'carousel'
    | 'countdown'
    | 'theme'
    | 'ai_providers'
    | 'site_assets'
  >('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [countdowns, setCountdowns] = useState<CountdownEvent[]>([]);
  const [schedules, setSchedules] = useState<DwuSchedule[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [aiProviders, setAiProviders] = useState<AiProviderConfig[]>([]);
  const [aiLogs, setAiLogs] = useState<AiRequestLog[]>([]);
  const [aiDrafts, setAiDrafts] = useState<
    Record<string, { is_enabled: boolean; is_primary: boolean; is_fallback: boolean; model_name: string; api_key: string }>
  >({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Tryout PDF Import state
  const [toPkgTitle, setToPkgTitle] = useState('');
  const [toPkgProvider, setToPkgProvider] = useState('Komunitas');
  const [toPkgDesc, setToPkgDesc] = useState('');
  const [toFiles, setToFiles] = useState<File[]>([]);
  const [uploadingToPdf, setUploadingToPdf] = useState(false);
  const [activeToJob, setActiveToJob] = useState<PdfImportJob | null>(null);
  const [recentToJobs, setRecentToJobs] = useState<PdfImportJob[]>([]);
  const [allowMissingToKeys, setAllowMissingToKeys] = useState(false);
  const [toCropTarget, setToCropTarget] = useState<{
    item: PdfImportDraftItem;
    assetIndex?: number;
    initialAsset?: QuestionAsset;
  } | null>(null);

  // Kick User confirmation modal (Super Admin only)
  const [kickTarget, setKickTarget] = useState<AdminUserRow | null>(null);
  const [kickingUser, setKickingUser] = useState(false);

  // Isolated Tryout package questions inspector
  const [inspectPkg, setInspectPkg] = useState<TryoutPackage | null>(null);
  const [inspectQuestions, setInspectQuestions] = useState<TryoutQuestionRow[]>([]);
  const [editingToQ, setEditingToQ] = useState<TryoutQuestionRow | null>(null);

  // Manual Package builder state
  const [pkgTitle, setPkgTitle] = useState('');
  const [pkgProvider, setPkgProvider] = useState('Sainsin');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgSubtestName, setPkgSubtestName] = useState<string>(SUBTESTS[0]);
  const [pkgDurationMin, setPkgDurationMin] = useState(15);
  const [selectedQIds, setSelectedQIds] = useState<number[]>([]);

  // Hero Carousel CRUD state
  const [carouselList, setCarouselList] = useState<TryoutCarouselCard[]>([]);
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [cardForm, setCardForm] = useState({
    package_id: '',
    title: '',
    description: '',
    image_url: visualAssets.defaultPackageCover,
    status_label: 'Terbaru',
    package_label: 'Try Out UTBK',
    cta_label: 'Mulai Try Out',
    cta_target: 'tryout',
    sort_order: 1,
    is_active: true,
  });

  // Countdown & DWU state
  const [cdTitle, setCdTitle] = useState('');
  const [cdDate, setCdDate] = useState('2027-05-15T08:00');
  const [cdTz, setCdTz] = useState('Asia/Jakarta');
  const [dwuLabel, setDwuLabel] = useState('PK');
  const [dwuDate, setDwuDate] = useState('2026-12-20');
  const [dwuTopic, setDwuTopic] = useState('');

  // Theme & Scoring state
  const [themeForm, setThemeForm] = useState<ThemeSettings>(theme);
  const [scoringForm, setScoringForm] = useState<ScoringConfig>(scoringConfig);

  // Global Site Assets (STRICTLY SUPER ADMIN ONLY)
  const [siteAssets, setSiteAssets] = useState<SiteAssetConfig[]>([]);
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<'all' | SiteAssetCategory>('all');
  const [assetDrafts, setAssetDrafts] = useState<Record<string, SiteAssetConfig>>({});

  const loadAll = useCallback(async () => {
    try {
      const basePromises = [
        apiFetch<AdminOverview>('/api/admin/overview'),
        apiFetch<AdminUserRow[]>('/api/admin/users'),
        apiFetch<CountdownEvent[]>('/api/admin/countdowns'),
        apiFetch<{ schedules: DwuSchedule[] }>('/api/dwu'),
        apiFetch<Question[]>('/api/questions'),
        apiFetch<PdfImportJob[]>('/api/admin/import/jobs?target_type=tryout'),
        apiFetch<TryoutCarouselCard[]>('/api/admin/carousel'),
      ] as const;

      const [ov, us, cds, dwu, qs, toJobs, carousels] = await Promise.all(basePromises);
      setOverview(ov);
      setUsersList(us);
      setCountdowns(cds);
      setSchedules(dwu.schedules);
      setQuestions(qs);
      setRecentToJobs(toJobs);
      setCarouselList(carousels);

      if (isSuperAdmin) {
        const [assets, aiRes] = await Promise.all([
          apiFetch<SiteAssetConfig[]>('/api/admin/site-assets'),
          apiFetch<{ providers: AiProviderConfig[]; logs: AiRequestLog[] }>('/api/admin/ai-providers'),
        ]);
        setSiteAssets(assets);
        const map: Record<string, SiteAssetConfig> = {};
        assets.forEach((a) => {
          map[a.slot_key] = a;
        });
        setAssetDrafts(map);

        setAiProviders(aiRes.providers);
        setAiLogs(aiRes.logs);
        const pMap: Record<
          string,
          { is_enabled: boolean; is_primary: boolean; is_fallback: boolean; model_name: string; api_key: string }
        > = {};
        aiRes.providers.forEach((p) => {
          pMap[p.provider_key] = {
            is_enabled: p.is_enabled,
            is_primary: p.is_primary,
            is_fallback: p.is_fallback,
            model_name: p.model_name,
            api_key: '',
          };
        });
        setAiDrafts(pMap);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal memuat data konsol admin.');
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Poll Tryout PDF Import Job while processing
  useEffect(() => {
    if (!activeToJob || activeToJob.status !== 'processing') return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeToJob.id}`);
        setActiveToJob(res.job);
        if (res.job.status !== 'processing') {
          loadAll();
          if (res.job.status === 'preview_ready') {
            setMsg(
              `Ekstraksi Try Out selesai: ${res.job.draft_questions.length} soal & ${res.job.draft_subtests.length} subtest terdeteksi.`
            );
          } else if (res.job.status === 'failed') {
            setMsg(`Ekstraksi Try Out gagal: ${res.job.error_message}`);
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeToJob, loadAll]);

  const handleRoleChange = async (targetId: number, role: UserRole) => {
    try {
      await apiFetch(`/api/admin/users/${targetId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMsg('Peran anggota berhasil diperbarui.');
      await loadAll();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengubah peran.');
    }
  };

  const handleConfirmKickUser = async () => {
    if (!kickTarget || !isSuperAdmin) return;
    setKickingUser(true);
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/users/${kickTarget.id}/kick`, {
        method: 'POST',
      });
      setKickTarget(null);
      setMsg(res.message);
      await Promise.all([loadAll(), onRefreshBootstrap()]);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengeluarkan pengguna.');
    } finally {
      setKickingUser(false);
    }
  };

  // ==========================================
  // TRYOUT PDF IMPORT HANDLERS
  // ==========================================
  const handleUploadTryoutPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (toFiles.length === 0) {
      setMsg('Pilih minimal 1 file PDF paket Try Out.');
      return;
    }
    const totalBytes = toFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > 30 * 1024 * 1024) {
      setMsg('Total ukuran file PDF melebihi 30 MB. Silakan unggah per bagian agar tidak melewati batas server.');
      return;
    }
    setMsg(null);
    setUploadingToPdf(true);
    try {
      const formData = new FormData();
      toFiles.forEach((f) => formData.append('pdfs', f));
      formData.append('package_title', toPkgTitle.trim());
      formData.append('package_provider', toPkgProvider.trim() || 'Komunitas');
      formData.append('package_description', toPkgDesc.trim());

      const resp = await fetch('/api/admin/import/tryout/pdf', {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await parseJsonResponse<{ job?: PdfImportJob; error?: string }>(
        resp,
        'Gagal mengunggah PDF Try Out'
      );
      if (!data.job) {
        throw new Error(data.error || 'Gagal mengunggah PDF Try Out.');
      }
      setActiveToJob(data.job);
      setToFiles([]);
      await loadAll();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengunggah PDF Try Out.');
    } finally {
      setUploadingToPdf(false);
    }
  };

  const updateToSubtest = (tempId: string, patch: Partial<TryoutDraftSubtest>) => {
    setActiveToJob((prev) =>
      prev
        ? {
            ...prev,
            draft_subtests: prev.draft_subtests.map((s) => (s.temp_id === tempId ? { ...s, ...patch } : s)),
          }
        : prev
    );
  };

  const addToSubtest = () => {
    setActiveToJob((prev) => {
      if (!prev) return prev;
      const nextOrder = prev.draft_subtests.length + 1;
      const lastEnd = prev.draft_subtests[prev.draft_subtests.length - 1]?.end_number || 0;
      const nextSub: TryoutDraftSubtest = {
        temp_id: `sub_${Date.now()}`,
        subtest_code: `ST${nextOrder}`,
        subtest_name: `Subtest ${nextOrder}`,
        duration_seconds: 1500,
        sort_order: nextOrder,
        start_number: lastEnd + 1,
        end_number: lastEnd + 20,
      };
      return { ...prev, draft_subtests: [...prev.draft_subtests, nextSub] };
    });
  };

  const removeToSubtest = (tempId: string) => {
    setActiveToJob((prev) =>
      prev
        ? {
            ...prev,
            draft_subtests: prev.draft_subtests.filter((s) => s.temp_id !== tempId),
          }
        : prev
    );
  };

  const moveToSubtest = (idx: number, dir: -1 | 1) => {
    setActiveToJob((prev) => {
      if (!prev) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.draft_subtests.length) return prev;
      const arr = [...prev.draft_subtests];
      const [item] = arr.splice(idx, 1);
      arr.splice(target, 0, item);
      return {
        ...prev,
        draft_subtests: arr.map((s, i) => ({ ...s, sort_order: i + 1 })),
      };
    });
  };

  const updateToDraftQ = (tempId: string, patch: Partial<PdfImportDraftItem>) => {
    setActiveToJob((prev) =>
      prev
        ? {
            ...prev,
            draft_questions: prev.draft_questions.map((q) => (q.temp_id === tempId ? { ...q, ...patch } : q)),
          }
        : prev
    );
  };

  const getToDraftAssets = (q: PdfImportDraftItem): QuestionAsset[] => {
    if (q.assets && q.assets.length > 0) return q.assets;
    if (q.image_url) {
      return [
        {
          asset_url: q.image_url,
          asset_type: 'manual',
          display_order: 0,
          source_page: q.source_page ?? null,
        },
      ];
    }
    return [];
  };

  const setToDraftAssets = (tempId: string, rawAssets: QuestionAsset[]) => {
    const ordered = deduplicateAndOrderDraftAssets(rawAssets);
    updateToDraftQ(tempId, {
      assets: ordered,
      image_url: ordered[0]?.asset_url || null,
      has_visual: ordered.length > 0,
    });
  };

  const moveToDraftAsset = (q: PdfImportDraftItem, idx: number, dir: -1 | 1) => {
    const list = [...getToDraftAssets(q)];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const [moved] = list.splice(idx, 1);
    list.splice(targetIdx, 0, moved);
    setToDraftAssets(
      q.temp_id,
      list.map((a, i) => ({ ...a, display_order: i }))
    );
  };

  const removeToDraftAsset = (q: PdfImportDraftItem, idx: number) => {
    const list = getToDraftAssets(q).filter((_, i) => i !== idx);
    setToDraftAssets(
      q.temp_id,
      list.map((a, i) => ({ ...a, display_order: i }))
    );
  };

  const handleUploadToDraftImage = (q: PdfImportDraftItem, file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
          method: 'POST',
          body: JSON.stringify({ data_url: String(reader.result) }),
        });
        const cur = getToDraftAssets(q);
        setToDraftAssets(q.temp_id, [
          ...cur,
          {
            asset_url: res.url,
            asset_type: 'manual',
            display_order: cur.length,
            source_page: q.source_page ?? null,
          },
        ]);
        setMsg('Gambar soal Try Out ditambahkan.');
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveToDraft = async () => {
    if (!activeToJob) return;
    const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeToJob.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        package_title: activeToJob.package_title,
        package_provider: activeToJob.package_provider,
        package_description: activeToJob.package_description,
        draft_subtests: activeToJob.draft_subtests,
        draft_questions: activeToJob.draft_questions,
      }),
    });
    setActiveToJob(res.job);
    setMsg('Draft paket & pembagian subtest Try Out disimpan.');
  };

  const handleReextractTo = async () => {
    if (!activeToJob) return;
    const res = await apiFetch<{ job: PdfImportJob }>(`/api/admin/import/jobs/${activeToJob.id}/reextract`, {
      method: 'POST',
    });
    setActiveToJob(res.job);
    setMsg('Ekstraksi ulang PDF Try Out dimulai...');
  };

  const handleCommitTryout = async () => {
    if (!activeToJob) return;
    setMsg(null);
    try {
      const res = await apiFetch<{ packageId: number; totalQuestionsInserted: number; subtestCount: number }>(
        `/api/admin/import/jobs/${activeToJob.id}/commit-tryout`,
        {
          method: 'POST',
          body: JSON.stringify({
            package_title: activeToJob.package_title,
            package_provider: activeToJob.package_provider,
            package_description: activeToJob.package_description,
            draft_subtests: activeToJob.draft_subtests,
            draft_questions: activeToJob.draft_questions,
            allow_missing_keys: allowMissingToKeys,
            is_published: true,
          }),
        }
      );
      setMsg(
        `Draft Paket Try Out #${res.packageId} dibuat (${res.subtestCount} subtest, ${res.totalQuestionsInserted} soal masuk Review & Audit). Setujui seluruh soal di tab Review & Audit sebelum dipublikasikan.`
      );
      setActiveToJob(null);
      await Promise.all([onRefreshPackages(), loadAll()]);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menyimpan paket Try Out.');
    }
  };

  const handleInspectTryoutPackage = async (pkg: TryoutPackage) => {
    const rows = await apiFetch<TryoutQuestionRow[]>(`/api/admin/tryout-packages/${pkg.id}/questions`);
    setInspectPkg(pkg);
    setInspectQuestions(rows);
  };

  const handleSaveIsolatedTryoutQ = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingToQ || !inspectPkg) return;
    const normalizedAssets = editingToQ.assets
      ? deduplicateAndOrderDraftAssets(editingToQ.assets)
      : undefined;
    await apiFetch(`/api/admin/tryout-questions/${editingToQ.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        question_text: editingToQ.question_text,
        options: editingToQ.options,
        correct_answer: editingToQ.correct_answer,
        explanation_text: editingToQ.explanation_text,
        solution_text: editingToQ.solution_text,
        image_url: normalizedAssets?.[0]?.asset_url || editingToQ.image_url,
        assets: normalizedAssets,
      }),
    });
    setEditingToQ(null);
    setMsg('Soal Try Out berhasil diperbarui (tidak memengaruhi bank Drilling).');
    await handleInspectTryoutPackage(inspectPkg);
  };

  // ==========================================
  // MANUAL PACKAGE BUILDER & PUBLISH
  // ==========================================
  const handleCreatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedQIds.length === 0) {
      setMsg('Pilih minimal 1 soal untuk paket Try Out baru.');
      return;
    }
    try {
      await apiFetch('/api/admin/tryout-packages', {
        method: 'POST',
        body: JSON.stringify({
          title: pkgTitle,
          provider: pkgProvider,
          description: pkgDesc,
          is_published: true,
          subtests: [
            {
              subtest_code: pkgSubtestName.slice(0, 4).toUpperCase(),
              subtest_name: pkgSubtestName,
              duration_seconds: pkgDurationMin * 60,
              question_ids: selectedQIds,
            },
          ],
        }),
      });
      setPkgTitle('');
      setPkgDesc('');
      setSelectedQIds([]);
      setMsg('Paket Try Out baru berhasil dibuat dan disalin ke tabel Try Out terisolasi.');
      await onRefreshPackages();
      await loadAll();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal membuat paket.');
    }
  };

  const handleTogglePublish = async (pkg: TryoutPackage) => {
    try {
      await apiFetch(`/api/admin/tryout-packages/${pkg.id}/publish`, {
        method: 'PATCH',
        body: JSON.stringify({ is_published: !pkg.is_published }),
      });
      await onRefreshPackages();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal mengubah status publikasi paket.');
    }
  };

  // ==========================================
  // CAROUSEL CRUD HANDLERS
  // ==========================================
  const handleUploadCarouselImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch<{ url: string }>('/api/admin/carousel/upload-image', {
          method: 'POST',
          body: JSON.stringify({ data_url: String(reader.result) }),
        });
        setCardForm((prev) => ({ ...prev, image_url: res.url }));
        setMsg('Gambar kartu carousel diunggah.');
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveCarouselCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...cardForm,
      package_id: cardForm.package_id ? Number(cardForm.package_id) : null,
      sort_order: Number(cardForm.sort_order) || 1,
    };
    if (editingCardId) {
      await apiFetch(`/api/admin/carousel/${editingCardId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setMsg('Kartu carousel diperbarui.');
    } else {
      await apiFetch('/api/admin/carousel', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMsg('Kartu carousel baru ditambahkan.');
    }
    setEditingCardId(null);
    setCardForm({
      package_id: '',
      title: '',
      description: '',
      image_url: visualAssets.defaultPackageCover,
      status_label: 'Terbaru',
      package_label: 'Try Out UTBK',
      cta_label: 'Mulai Try Out',
      cta_target: 'tryout',
      sort_order: carouselList.length + 1,
      is_active: true,
    });
    await Promise.all([loadAll(), onRefreshBootstrap()]);
  };

  const handleDeleteCarouselCard = async (id: number) => {
    await apiFetch(`/api/admin/carousel/${id}`, { method: 'DELETE' });
    setMsg('Kartu carousel dihapus.');
    await Promise.all([loadAll(), onRefreshBootstrap()]);
  };

  // ==========================================
  // COUNTDOWN, DWU, THEME, SCORING
  // ==========================================
  const handleCreateCountdown = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/countdowns', {
      method: 'POST',
      body: JSON.stringify({
        title: cdTitle,
        target_iso: new Date(cdDate).toISOString(),
        timezone: cdTz,
        is_active: true,
      }),
    });
    setCdTitle('');
    setMsg('Countdown baru diaktifkan dan langsung tampil di Landing & Dashboard.');
    await onRefreshBootstrap();
    await loadAll();
  };

  const handleActivateCountdown = async (id: number) => {
    await apiFetch(`/api/admin/countdowns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: true }),
    });
    await onRefreshBootstrap();
    await loadAll();
  };

  const handleDeleteCountdown = async (id: number) => {
    await apiFetch(`/api/admin/countdowns/${id}`, { method: 'DELETE' });
    await onRefreshBootstrap();
    await loadAll();
  };

  const handleAddDwuSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/dwu-schedules', {
      method: 'POST',
      body: JSON.stringify({ subtest_label: dwuLabel, scheduled_date: dwuDate, topic: dwuTopic }),
    });
    setDwuTopic('');
    await loadAll();
  };

  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/settings/theme', {
      method: 'PUT',
      body: JSON.stringify(themeForm),
    });
    setMsg('Tema & kutipan komunitas berhasil disimpan.');
    await onRefreshBootstrap();
  };

  const handleSaveScoring = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/settings/scoring', {
      method: 'PUT',
      body: JSON.stringify(scoringForm),
    });
    setMsg('Formula penilaian skor Try Out diperbarui.');
    await onRefreshBootstrap();
  };

  // ==========================================
  // SUPER ADMIN ONLY GLOBAL SITE ASSETS HANDLERS
  // ==========================================
  const handleUploadSiteAsset = (slotKey: string, device: 'desktop' | 'mobile', file: File | undefined) => {
    if (!file || !isSuperAdmin) return;
    if (file.size > 3 * 1024 * 1024) {
      setMsg('Ukuran file maksimal 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await apiFetch(`/api/admin/site-assets/${slotKey}/upload`, {
          method: 'POST',
          body: JSON.stringify({ device, data_url: String(reader.result) }),
        });
        setMsg(`Gambar ${device} untuk slot "${slotKey}" berhasil diperbarui.`);
        await Promise.all([loadAll(), onRefreshBootstrap()]);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar global.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSiteAssetConfig = async (slotKey: string) => {
    const draft = assetDrafts[slotKey];
    if (!draft || !isSuperAdmin) return;
    await apiFetch(`/api/admin/site-assets/${slotKey}`, {
      method: 'PATCH',
      body: JSON.stringify({
        alt_text: draft.alt_text,
        object_fit: draft.object_fit,
        object_position: draft.object_position,
        alignment: draft.alignment,
        aspect_ratio: draft.aspect_ratio,
      }),
    });
    setMsg(`Konfigurasi posisi & ukuran "${draft.label}" disimpan.`);
    await Promise.all([loadAll(), onRefreshBootstrap()]);
  };

  const handleRollbackSiteAsset = async (slotKey: string) => {
    if (!isSuperAdmin) return;
    try {
      await apiFetch(`/api/admin/site-assets/${slotKey}/rollback`, { method: 'POST' });
      setMsg(`Gambar "${slotKey}" dikembalikan ke versi sebelumnya.`);
      await Promise.all([loadAll(), onRefreshBootstrap()]);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Tidak ada versi sebelumnya.');
    }
  };

  const handleResetSiteAsset = async (slotKey: string) => {
    if (!isSuperAdmin) return;
    await apiFetch(`/api/admin/site-assets/${slotKey}`, { method: 'DELETE' });
    setMsg(`Gambar "${slotKey}" dikembalikan ke default bawaan.`);
    await Promise.all([loadAll(), onRefreshBootstrap()]);
  };

  const filteredSiteAssets =
    assetCategoryFilter === 'all' ? siteAssets : siteAssets.filter((a) => a.category === assetCategoryFilter);

  const handleSaveAiProvider = async (providerKey: 'gemini' | 'openai', clearKey = false) => {
    const draft = aiDrafts[providerKey];
    if (!draft || !isSuperAdmin) return;
    setSavingProvider(providerKey);
    try {
      const res = await apiFetch<{ providers: AiProviderConfig[] }>(`/api/admin/ai-providers/${providerKey}`, {
        method: 'PUT',
        body: JSON.stringify({
          is_enabled: draft.is_enabled,
          is_primary: draft.is_primary,
          is_fallback: draft.is_fallback,
          model_name: draft.model_name,
          api_key: !clearKey && draft.api_key.trim() ? draft.api_key.trim() : undefined,
          clear_api_key: clearKey,
        }),
      });
      setAiProviders(res.providers);
      setMsg(`Konfigurasi AI Provider "${providerKey}" berhasil disimpan.`);
      await loadAll();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi AI Provider.');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleTestAiProvider = async (providerKey: 'gemini' | 'openai') => {
    if (!isSuperAdmin) return;
    setTestingProvider(providerKey);
    try {
      const res = await apiFetch<{
        result: { ok: boolean; latencyMs: number; message: string };
        providers: AiProviderConfig[];
      }>(`/api/admin/ai-providers/${providerKey}/test`, { method: 'POST' });
      setAiProviders(res.providers);
      setMsg(
        res.result.ok
          ? `Tes koneksi ${providerKey} BERHASIL (${res.result.latencyMs}ms): ${res.result.message}`
          : `Tes koneksi ${providerKey} GAGAL: ${res.result.message}`
      );
      await loadAll();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menguji koneksi provider.');
    } finally {
      setTestingProvider(null);
    }
  };

  const visibleTabs = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'review_console',
      label: `Review & Audit Soal${overview?.pendingReviewCount ? ` (${overview.pendingReviewCount})` : ''}`,
    },
    { id: 'users', label: 'Anggota & Role' },
    { id: 'tryout_pdf', label: 'Import Try Out PDF' },
    { id: 'packages', label: 'Paket Try Out' },
    { id: 'carousel', label: 'Carousel Try Out' },
    { id: 'countdown', label: 'Countdown & DWU' },
    { id: 'theme', label: 'Tema & Skor' },
    ...(isSuperAdmin
      ? ([
          { id: 'ai_providers', label: 'AI Providers (Super Admin)' },
          { id: 'site_assets', label: 'Gambar Global (Super Admin)' },
        ] as const)
      : []),
  ] as const;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0757B8] dark:bg-[#0A1128] text-white px-4 sm:px-8 lg:px-12 py-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <FloatingBackButton onClick={() => onNavigate('dashboard')} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-extrabold uppercase">Admin & System Console</h2>
            <p className="text-xs text-sky-100/85">
              Login sebagai <strong>{user.username}</strong> ({user.role.replace('_', ' ')}). Akses fitur sensitif diperiksa di sisi server.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  tab === t.id ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-[#101B45] text-white hover:bg-[#14244F]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {msg && (
          <div className="px-4 py-2.5 rounded-lg bg-[#101B45] border border-[#D5BF50] text-xs text-[#D5BF50] flex items-center justify-between gap-2">
            <span>{msg}</span>
            <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">
              Tutup
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {tab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
              {[
                { label: 'Anggota', val: overview.memberCount },
                { label: 'Soal Drilling', val: overview.questionCount },
                { label: 'Soal Try Out', val: overview.tryoutQuestionCount ?? 0 },
                { label: 'Paket Try Out', val: overview.packageCount },
                { label: 'TO Selesai', val: overview.completedTryoutCount },
                { label: 'Laporan Pending', val: overview.pendingReportsCount },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#101B45]/90 rounded-2xl p-4 border border-white/15">
                  <p className="text-xs text-sky-200">{stat.label}</p>
                  <p className="font-display text-4xl font-extrabold font-mono-num text-[#D5BF50] mt-1">
                    {stat.val}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15 space-y-3">
                <h3 className="font-display text-xl font-bold uppercase">Aktivitas Terbaru</h3>
                <ul className="divide-y divide-white/10 text-xs">
                  {overview.recentLogs.map((log) => (
                    <li key={log.id} className="py-2 flex items-center justify-between gap-2">
                      <span>
                        <strong>{log.username || 'Sistem'}</strong>: {log.details}
                      </span>
                      <span className="text-sky-200/70 shrink-0">
                        {new Date(log.created_at).toLocaleDateString('id-ID')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15 space-y-3">
                <h3 className="font-display text-xl font-bold uppercase">Pintasan Pengelolaan</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onNavigate('bank')}
                    className="p-3 rounded-xl bg-[#101B45] hover:bg-[#14244F] text-left text-xs font-bold cursor-pointer"
                  >
                    Import Soal Drilling PDF →
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('tryout_pdf')}
                    className="p-3 rounded-xl bg-[#101B45] hover:bg-[#14244F] text-left text-xs font-bold cursor-pointer"
                  >
                    Import Try Out PDF (160 soal) →
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('feedback')}
                    className="p-3 rounded-xl bg-[#101B45] hover:bg-[#14244F] text-left text-xs font-bold cursor-pointer"
                  >
                    Tinjau Laporan Soal ({overview.pendingReportsCount}) →
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('library')}
                    className="p-3 rounded-xl bg-[#101B45] hover:bg-[#14244F] text-left text-xs font-bold cursor-pointer"
                  >
                    Kelola Library Drive →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: UNIFIED QUESTION REVIEW & AUDIT CONSOLE */}
        {tab === 'review_console' && (
          <QuestionReviewConsole
            currentUser={user}
            onStatusChanged={async () => {
              await Promise.all([loadAll(), onRefreshPackages()]);
            }}
          />
        )}

        {/* TAB 2: USERS & ROLES */}
        {tab === 'users' && (
          <div className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 overflow-x-auto space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-2xl font-bold">Manajemen Anggota Komunitas ({usersList.length})</h3>
              {isSuperAdmin && (
                <p className="text-xs text-sky-200">
                  Super Admin dapat mengubah peran maupun mengeluarkan (Kick) pengguna yang melanggar aturan.
                </p>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-sky-200 border-b border-white/15">
                  <th className="py-2 pr-3">Username</th>
                  <th className="py-2 pr-3">Discord ID</th>
                  <th className="py-2 pr-3">Statistik</th>
                  <th className="py-2 pr-3">Bergabung</th>
                  <th className="py-2 text-right">Role & Moderasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-3 font-bold">{u.username}</td>
                    <td className="py-2.5 pr-3 font-mono-num text-xs text-sky-200">{u.discord_id}</td>
                    <td className="py-2.5 pr-3 text-xs">
                      {u.completed_tryouts} TO · {u.drill_count} Drill
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-sky-200">
                      {new Date(u.joined_at).toLocaleDateString('id-ID')}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        {isSuperAdmin ? (
                          <select
                            aria-label={`Ubah role ${u.username}`}
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                            className="bg-[#0757B8] border border-white/25 rounded px-2.5 py-1 text-xs font-bold"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                        ) : (
                          <span className="text-xs font-bold uppercase text-[#D5BF50]">{u.role}</span>
                        )}

                        {isSuperAdmin && u.id !== user.id && (
                          <button
                            type="button"
                            data-testid={`kick-user-btn-${u.id}`}
                            onClick={() => setKickTarget(u)}
                            className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" /> Kick User
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: TRY OUT PDF IMPORT (ISOLATED FROM DRILLING) */}
        {tab === 'tryout_pdf' && (
          <div className="space-y-6">
            <form onSubmit={handleUploadTryoutPdf} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <div>
                <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                  Import Paket Try Out Berbasis PDF + AI (Bank Terisolasi)
                </h3>
                <p className="text-xs text-sky-200 mt-0.5">
                  Unggah PDF Try Out (misalnya ±160 soal lengkap atau dengan kunci/pembahasan). AI akan memecah seluruh soal satu per satu, mendeteksi judul/batas subtest otomatis, dan menyimpannya terpisah penuh dari Question Bank Drilling.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Nama Paket Try Out (mis: TO Akbar #2 2027)"
                  value={toPkgTitle}
                  onChange={(e) => setToPkgTitle(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  required
                  placeholder="Penyedia (mis: Sainsin / Komunitas)"
                  value={toPkgProvider}
                  onChange={(e) => setToPkgProvider(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  placeholder="Deskripsi singkat paket"
                  value={toPkgDesc}
                  onChange={(e) => setToPkgDesc(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
              </div>

              <div className="p-4 rounded-xl border-2 border-dashed border-[#D5BF50]/50 bg-black/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-7 h-7 text-[#D5BF50] shrink-0" />
                  <div>
                    <p className="text-sm font-bold">
                      {toFiles.length > 0
                        ? `${toFiles.length} PDF Try Out dipilih (${toFiles.map((f) => f.name).join(', ')})`
                        : 'Pilih file PDF Try Out (.pdf)'}
                    </p>
                    <p className="text-xs text-sky-200">Bisa mengunggah 1 PDF utuh atau beberapa PDF per bagian.</p>
                  </div>
                </div>
                <label className="px-4 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-xs font-bold cursor-pointer flex items-center gap-1.5 shrink-0">
                  <Upload className="w-4 h-4" /> Pilih PDF Try Out
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => setToFiles(Array.from(e.target.files || []))}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={uploadingToPdf || toFiles.length === 0}
                className="px-5 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {uploadingToPdf ? 'Mengunggah PDF Try Out...' : 'Ekstrak Soal & Batas Subtest dengan AI'}
              </button>
            </form>

            {recentToJobs.length > 0 && (
              <div className="bg-[#0D4FA8]/60 dark:bg-[#111B3A] rounded-2xl p-4 border border-white/15 space-y-2">
                <h4 className="font-display text-lg font-bold uppercase text-[#D5BF50]">
                  Riwayat Batch Import Try Out PDF
                </h4>
                <div className="flex flex-wrap gap-2">
                  {recentToJobs.slice(0, 6).map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setActiveToJob(j)}
                      className={`px-3 py-2 rounded-xl border text-left text-xs cursor-pointer ${
                        activeToJob?.id === j.id
                          ? 'bg-[#D5BF50] text-[#101B45] border-[#D5BF50] font-bold'
                          : 'bg-[#101B45] text-white border-white/20 hover:border-[#D5BF50]'
                      }`}
                    >
                      <span className="block">{j.package_title || `Batch TO #${j.id}`}</span>
                      <span className="text-[10px] opacity-80">
                        {j.draft_questions.length} soal · {j.draft_subtests.length} subtest · {j.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Interactive Tryout Boundary & Question Editor */}
            {activeToJob && (
              <div className="bg-[#101B45] rounded-2xl p-6 border-2 border-[#D5BF50] space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                      Editor Struktur Subtest & Preview Soal Try Out (#{activeToJob.id})
                    </h3>
                    <p className="text-xs text-sky-200">
                      {activeToJob.total_pages} halaman · Chunk {activeToJob.processed_chunks}/{activeToJob.total_chunks} ·{' '}
                      {activeToJob.draft_questions.length} soal terdeteksi
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleReextractTo}
                      disabled={activeToJob.status === 'processing'}
                      className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Ekstrak Ulang
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveToDraft}
                      disabled={activeToJob.status === 'processing'}
                      className="px-3.5 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" /> Simpan Draft
                    </button>
                    <button
                      type="button"
                      onClick={handleCommitTryout}
                      disabled={activeToJob.status === 'processing' || activeToJob.draft_questions.length === 0}
                      className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Setujui & Terbitkan Paket Try Out
                    </button>
                  </div>
                </div>

                {activeToJob.status === 'processing' && (
                  <div className="p-4 rounded-xl bg-white/10 border border-white/20 space-y-2">
                    <p className="text-sm font-bold text-[#D5BF50]">
                      AI sedang memproses PDF Try Out ({activeToJob.processed_chunks}/{activeToJob.total_chunks})...
                    </p>
                    <div className="w-full h-2.5 rounded-full bg-black/40 overflow-hidden">
                      <div
                        className="h-full bg-[#D5BF50] transition-all"
                        style={{
                          width: `${
                            activeToJob.total_chunks > 0
                              ? Math.round((activeToJob.processed_chunks / activeToJob.total_chunks) * 100)
                              : 10
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Package Info Edit */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <input
                    type="text"
                    value={activeToJob.package_title}
                    onChange={(e) => setActiveToJob({ ...activeToJob, package_title: e.target.value })}
                    placeholder="Judul Paket"
                    className="px-3 py-2 rounded bg-slate-900 border border-white/20"
                  />
                  <input
                    type="text"
                    value={activeToJob.package_provider}
                    onChange={(e) => setActiveToJob({ ...activeToJob, package_provider: e.target.value })}
                    placeholder="Penyedia"
                    className="px-3 py-2 rounded bg-slate-900 border border-white/20"
                  />
                  <input
                    type="text"
                    value={activeToJob.package_description}
                    onChange={(e) => setActiveToJob({ ...activeToJob, package_description: e.target.value })}
                    placeholder="Deskripsi Paket"
                    className="px-3 py-2 rounded bg-slate-900 border border-white/20"
                  />
                </div>

                {/* Subtest Boundary Editor */}
                <div className="bg-white/5 rounded-xl p-4 border border-white/15 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-xl font-bold text-[#D5BF50] flex items-center gap-2">
                      <Layers className="w-4 h-4" /> Batas Nomor & Urutan Subtest ({activeToJob.draft_subtests.length})
                    </h4>
                    <button
                      type="button"
                      onClick={addToSubtest}
                      className="px-3 py-1 rounded bg-[#0757B8] text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Tambah Subtest
                    </button>
                  </div>

                  <div className="space-y-2">
                    {activeToJob.draft_subtests.map((sub, idx) => (
                      <div key={sub.temp_id} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center text-xs bg-black/25 p-2.5 rounded-lg">
                        <input
                          type="text"
                          value={sub.subtest_code}
                          onChange={(e) => updateToSubtest(sub.temp_id, { subtest_code: e.target.value })}
                          placeholder="Kode"
                          className="sm:col-span-1 px-2 py-1.5 rounded bg-slate-900 border border-white/20 font-mono"
                        />
                        <input
                          type="text"
                          value={sub.subtest_name}
                          onChange={(e) => updateToSubtest(sub.temp_id, { subtest_name: e.target.value })}
                          placeholder="Nama Subtest"
                          className="sm:col-span-4 px-2 py-1.5 rounded bg-slate-900 border border-white/20"
                        />
                        <label className="sm:col-span-2 flex items-center gap-1">
                          <span className="text-sky-200">No:</span>
                          <input
                            type="number"
                            min={1}
                            value={sub.start_number}
                            onChange={(e) => updateToSubtest(sub.temp_id, { start_number: Number(e.target.value) })}
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-white/20 font-mono"
                          />
                        </label>
                        <label className="sm:col-span-2 flex items-center gap-1">
                          <span className="text-sky-200">s/d:</span>
                          <input
                            type="number"
                            min={1}
                            value={sub.end_number}
                            onChange={(e) => updateToSubtest(sub.temp_id, { end_number: Number(e.target.value) })}
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-white/20 font-mono"
                          />
                        </label>
                        <label className="sm:col-span-2 flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            value={Math.round(sub.duration_seconds / 60)}
                            onChange={(e) =>
                              updateToSubtest(sub.temp_id, { duration_seconds: Math.max(1, Number(e.target.value)) * 60 })
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-white/20 font-mono"
                          />
                          <span className="text-sky-200">mnt</span>
                        </label>
                        <div className="sm:col-span-1 flex items-center justify-end gap-1">
                          <button type="button" onClick={() => moveToSubtest(idx, -1)} className="p-1 hover:bg-white/10 rounded cursor-pointer">
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => moveToSubtest(idx, 1)} className="p-1 hover:bg-white/10 rounded cursor-pointer">
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => removeToSubtest(sub.temp_id)} className="p-1 text-red-300 hover:bg-white/10 rounded cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowMissingToKeys}
                    onChange={(e) => setAllowMissingToKeys(e.target.checked)}
                  />
                  <span>Izinkan menerbitkan paket walau ada soal yang belum memiliki kunci jawaban (ditandai untuk review)</span>
                </label>

                {(() => {
                  const visualWarnings = findVisualMissingWarnings(activeToJob.draft_questions);
                  if (visualWarnings.length === 0) return null;
                  return (
                    <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400 text-xs text-amber-100 space-y-1">
                      <p className="font-bold flex items-center gap-1.5 text-amber-300">
                        <AlertTriangle className="w-4 h-4" /> Peringatan Visual ({visualWarnings.length} soal)
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {visualWarnings.slice(0, 5).map((w, wi) => (
                          <li key={wi}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Preview Draft Tryout Questions */}
                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                  {activeToJob.draft_questions.map((q, idx) => {
                    const qAssets = getToDraftAssets(q);
                    return (
                      <div key={q.temp_id} className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-2.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono-num font-bold text-[#D5BF50]">
                              No. {q.question_number || idx + 1}
                            </span>
                            <select
                              value={q.subtest_temp_id || ''}
                              onChange={(e) => updateToDraftQ(q.temp_id, { subtest_temp_id: e.target.value })}
                              className="px-2 py-1 rounded bg-[#0757B8] border border-white/20"
                            >
                              <option value="">Otomatis berdasarkan rentang nomor</option>
                              {activeToJob.draft_subtests.map((sub) => (
                                <option key={sub.temp_id} value={sub.temp_id}>
                                  {sub.subtest_name}
                                </option>
                              ))}
                            </select>
                            {q.needs_review && (
                              <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Perlu Ditinjau
                              </span>
                            )}
                            {q.has_visual && (
                              <span className="px-2 py-0.5 rounded bg-sky-500/30 text-sky-100 font-semibold">
                                Visual ({qAssets.length} gambar)
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveToJob((prev) =>
                                prev
                                  ? { ...prev, draft_questions: prev.draft_questions.filter((x) => x.temp_id !== q.temp_id) }
                                  : prev
                              )
                            }
                            className="text-red-300 hover:underline cursor-pointer"
                          >
                            Hapus
                          </button>
                        </div>

                        <textarea
                          rows={2}
                          value={q.question_text}
                          onChange={(e) => updateToDraftQ(q.temp_id, { question_text: e.target.value })}
                          className="w-full p-2 rounded bg-slate-950 border border-white/20 font-mono"
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={q.correct_answer.join(',')}
                            onChange={(e) => {
                              const keys = e.target.value
                                .split(',')
                                .map((s) => s.trim().toUpperCase())
                                .filter(Boolean);
                              updateToDraftQ(q.temp_id, { correct_answer: keys, needs_review: keys.length === 0 });
                            }}
                            placeholder="Kunci (mis: A)"
                            className="px-2 py-1 rounded bg-slate-900 border border-white/20 font-mono"
                          />
                          <input
                            type="text"
                            value={q.explanation_text}
                            onChange={(e) => updateToDraftQ(q.temp_id, { explanation_text: e.target.value })}
                            placeholder="Pembahasan (opsional)"
                            className="sm:col-span-2 px-2 py-1 rounded bg-slate-900 border border-white/20"
                          />
                        </div>

                        {/* Multi-image preview & interactive re-crop */}
                        <div className="space-y-2 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer inline-flex items-center gap-1 font-semibold">
                              <ImageIcon className="w-3.5 h-3.5" /> + Unggah Gambar
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(e) => handleUploadToDraftImage(q, e.target.files?.[0])}
                              />
                            </label>
                            {activeToJob.page_images && activeToJob.page_images.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setToCropTarget({ item: q })}
                                className="px-2.5 py-1 rounded bg-[#0757B8] hover:bg-[#0D4FA8] font-semibold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Crop className="w-3.5 h-3.5" /> + Crop Area PDF
                              </button>
                            )}
                          </div>

                          {qAssets.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {qAssets.map((asset, aIdx) => (
                                <div
                                  key={`${asset.asset_url}-${aIdx}`}
                                  className="p-2 rounded-lg bg-black/30 border border-white/15 flex items-center gap-2.5"
                                >
                                  <img
                                    src={asset.asset_url}
                                    alt={asset.caption || `Preview TO ${aIdx + 1}`}
                                    className="w-16 h-16 object-contain rounded bg-white border border-white/20 shrink-0"
                                  />
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                                      <span className="px-1.5 py-0.5 rounded bg-[#0757B8] font-bold uppercase">
                                        #{aIdx + 1} · {asset.asset_type}
                                      </span>
                                      {asset.is_shared && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold uppercase">
                                          Shared
                                        </span>
                                      )}
                                      {asset.source_page && <span className="text-sky-200">Hal. {asset.source_page}</span>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1">
                                      {qAssets.length > 1 && (
                                        <>
                                          <button
                                            type="button"
                                            disabled={aIdx === 0}
                                            onClick={() => moveToDraftAsset(q, aIdx, -1)}
                                            className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer"
                                          >
                                            <ArrowUp className="w-3 h-3" />
                                          </button>
                                          <button
                                            type="button"
                                            disabled={aIdx === qAssets.length - 1}
                                            onClick={() => moveToDraftAsset(q, aIdx, 1)}
                                            className="p-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30 cursor-pointer"
                                          >
                                            <ArrowDown className="w-3 h-3" />
                                          </button>
                                        </>
                                      )}
                                      {activeToJob.page_images && activeToJob.page_images.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setToCropTarget({ item: q, assetIndex: aIdx, initialAsset: asset })
                                          }
                                          className="px-2 py-0.5 rounded bg-[#D5BF50] text-[#101B45] font-bold inline-flex items-center gap-1 cursor-pointer"
                                        >
                                          <Crop className="w-3 h-3" /> Crop Ulang
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => removeToDraftAsset(q, aIdx)}
                                        className="px-2 py-0.5 rounded bg-red-500/20 text-red-200 hover:bg-red-500/35 cursor-pointer"
                                      >
                                        Hapus
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TRY OUT PACKAGES */}
        {tab === 'packages' && (
          <div className="space-y-6">
            <form onSubmit={handleCreatePackage} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Buat Paket Try Out Manual</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Nama Paket (mis: TO Sainsin #2 2027)"
                  value={pkgTitle}
                  onChange={(e) => setPkgTitle(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  required
                  placeholder="Penyedia (mis: Sainsin)"
                  value={pkgProvider}
                  onChange={(e) => setPkgProvider(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  placeholder="Deskripsi singkat"
                  value={pkgDesc}
                  onChange={(e) => setPkgDesc(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={pkgSubtestName}
                  onChange={(e) => setPkgSubtestName(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 text-sm"
                >
                  {SUBTESTS.map((s) => (
                    <option key={s} value={s}>
                      Subtest: {s}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={pkgDurationMin}
                  onChange={(e) => setPkgDurationMin(Number(e.target.value))}
                  placeholder="Durasi (menit)"
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
              </div>

              <div>
                <p className="text-xs text-sky-200 mb-2">
                  Salin Soal ke Paket Try Out Terisolasi ({selectedQIds.length} dipilih):
                </p>
                <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-lg bg-black/25">
                  {questions.map((q) => {
                    const checked = selectedQIds.includes(q.id);
                    return (
                      <label key={q.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedQIds((prev) =>
                              checked ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                            )
                          }
                        />
                        <span className="truncate">
                          [{q.external_code}] {q.subtest} — {q.topic}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button type="submit" className="px-5 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-1.5 cursor-pointer">
                <Plus className="w-4 h-4" /> Simpan Paket Try Out
              </button>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {packages.map((pkg) => (
                <div key={pkg.id} className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-xl p-4 border border-white/15 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-xl font-bold truncate">{pkg.title}</h4>
                    <button
                      type="button"
                      onClick={() => handleTogglePublish(pkg)}
                      className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer shrink-0 ${
                        pkg.is_published ? 'bg-emerald-500 text-slate-950' : 'bg-slate-500 text-white'
                      }`}
                    >
                      {pkg.is_published ? 'Published' : 'Draft'}
                    </button>
                  </div>
                  <p className="text-xs text-sky-100/80">
                    {pkg.provider} · {pkg.subtests.length} subtest ·{' '}
                    {pkg.subtests.reduce((s, st) => s + st.question_ids.length, 0)} soal terisolasi
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => handleInspectTryoutPackage(pkg)}
                      className="text-xs font-bold text-[#D5BF50] hover:underline cursor-pointer"
                    >
                      Kelola Soal Try Out →
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/tryout-packages/${pkg.id}`, { method: 'DELETE' });
                        setMsg(`Paket "${pkg.title}" dihapus.`);
                        await onRefreshPackages();
                      }}
                      className="text-xs text-red-300 hover:underline cursor-pointer"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: DASHBOARD TRYOUT CAROUSEL CRUD */}
        {tab === 'carousel' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveCarouselCard} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                  {editingCardId ? `Edit Kartu Carousel #${editingCardId}` : 'Tambah Kartu Carousel Try Out (Dashboard User)'}
                </h3>
                {editingCardId && (
                  <button
                    type="button"
                    onClick={() => setEditingCardId(null)}
                    className="text-xs text-sky-200 underline cursor-pointer"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <input
                  type="text"
                  required
                  placeholder="Judul Kartu (mis: TO Sainsin #1 2027)"
                  value={cardForm.title}
                  onChange={(e) => setCardForm({ ...cardForm, title: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  placeholder="Badge Status (mis: Terbaru / Dibuka)"
                  value={cardForm.status_label}
                  onChange={(e) => setCardForm({ ...cardForm, status_label: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <input
                  type="text"
                  placeholder="Label Paket (mis: 7 Subtest SNBT)"
                  value={cardForm.package_label}
                  onChange={(e) => setCardForm({ ...cardForm, package_label: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
              </div>

              <textarea
                rows={2}
                placeholder="Deskripsi singkat kartu tryout..."
                value={cardForm.description}
                onChange={(e) => setCardForm({ ...cardForm, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
              />

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs items-center">
                <select
                  value={cardForm.package_id}
                  onChange={(e) => setCardForm({ ...cardForm, package_id: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20"
                >
                  <option value="">-- Hubungkan Paket (Opsional) --</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Teks Tombol CTA"
                  value={cardForm.cta_label}
                  onChange={(e) => setCardForm({ ...cardForm, cta_label: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20"
                />
                <select
                  value={cardForm.cta_target}
                  onChange={(e) => setCardForm({ ...cardForm, cta_target: e.target.value })}
                  aria-label="Tujuan tombol kartu carousel"
                  className="px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20"
                >
                  <option value="tryout">Tujuan: Halaman Try Out</option>
                  <option value="leaderboard">Tujuan: Leaderboard</option>
                  <option value="latsol">Tujuan: Latsol Drilling</option>
                  <option value="library">Tujuan: Library</option>
                </select>
                <input
                  type="number"
                  min={1}
                  value={cardForm.sort_order}
                  onChange={(e) => setCardForm({ ...cardForm, sort_order: Number(e.target.value) })}
                  placeholder="Urutan"
                  className="px-3 py-2 rounded-lg bg-white/10 border border-white/20"
                />
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cardForm.is_active}
                    onChange={(e) => setCardForm({ ...cardForm, is_active: e.target.checked })}
                  />
                  <span>Tampilkan di Dashboard User</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={cardForm.image_url}
                  alt="Preview kartu carousel"
                  className="w-16 h-16 aspect-square object-cover rounded-lg border border-white/20 bg-black/30"
                />
                <label className="px-3.5 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] text-xs font-bold cursor-pointer">
                  Unggah Gambar Kartu
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => handleUploadCarouselImage(e.target.files?.[0])}
                  />
                </label>
                <button type="submit" className="px-5 py-2.5 rounded-xl bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
                  {editingCardId ? 'Simpan Perubahan Kartu' : 'Tambah Kartu Carousel'}
                </button>
              </div>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {carouselList.map((card) => (
                <div key={card.id} className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-xl overflow-hidden border border-white/15 flex flex-col justify-between">
                  <div>
                    <img src={card.image_url} alt={card.title} className="w-full h-32 object-cover bg-black/30" />
                    <div className="p-4 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-[#D5BF50] font-bold">
                        <span>{card.status_label}</span>
                        <span>Urutan #{card.sort_order} · {card.is_active ? 'Aktif' : 'Nonaktif'}</span>
                      </div>
                      <h4 className="font-display text-xl font-bold">{card.title}</h4>
                      <p className="text-xs text-sky-100/80 line-clamp-2">{card.description}</p>
                    </div>
                  </div>
                  <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCardId(card.id);
                        setCardForm({
                          package_id: card.package_id ? String(card.package_id) : '',
                          title: card.title,
                          description: card.description,
                          image_url: card.image_url,
                          status_label: card.status_label,
                          package_label: card.package_label,
                          cta_label: card.cta_label,
                          cta_target: card.cta_target,
                          sort_order: card.sort_order,
                          is_active: card.is_active,
                        });
                      }}
                      className="font-bold text-[#D5BF50] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCarouselCard(card.id)}
                      className="text-red-300 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: COUNTDOWN & DWU SCHEDULE */}
        {tab === 'countdown' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Kelola Countdown Acara</h3>
              <form onSubmit={handleCreateCountdown} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Nama acara (mis: SNBT UTBK 2027)"
                  value={cdTitle}
                  onChange={(e) => setCdTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="datetime-local"
                    required
                    value={cdDate}
                    onChange={(e) => setCdDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                  <input
                    type="text"
                    value={cdTz}
                    onChange={(e) => setCdTz(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                </div>
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
                  Simpan & Aktifkan Countdown
                </button>
              </form>

              <ul className="divide-y divide-white/10 text-sm">
                {countdowns.map((cd) => (
                  <li key={cd.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">{cd.title}</p>
                      <p className="text-xs text-sky-200">{new Date(cd.target_iso).toLocaleString('id-ID')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!cd.is_active ? (
                        <button
                          type="button"
                          onClick={() => handleActivateCountdown(cd.id)}
                          className="px-2.5 py-1 rounded bg-white/15 text-xs font-semibold cursor-pointer"
                        >
                          Aktifkan
                        </button>
                      ) : (
                        <span className="text-xs font-bold text-emerald-300">Aktif</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCountdown(cd.id)}
                        aria-label={`Hapus countdown ${cd.title}`}
                        className="p-1 text-white/60 hover:text-red-300 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Kelola Jadwal DWU</h3>
              <form onSubmit={handleAddDwuSchedule} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    placeholder="Subtest (mis: LBE, PK)"
                    value={dwuLabel}
                    onChange={(e) => setDwuLabel(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                  <input
                    type="date"
                    required
                    value={dwuDate}
                    onChange={(e) => setDwuDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Topik pembahasan"
                  value={dwuTopic}
                  onChange={(e) => setDwuTopic(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
                  Tambah Jadwal DWU
                </button>
              </form>

              <ul className="divide-y divide-white/10 text-sm">
                {schedules.map((s) => (
                  <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                    <span>
                      <strong>{s.subtest_label}</strong> {s.topic ? `· ${s.topic}` : ''}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono-num text-xs text-sky-200">{s.scheduled_date}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/dwu-schedules/${s.id}`, { method: 'DELETE' });
                          await loadAll();
                        }}
                        aria-label={`Hapus jadwal ${s.subtest_label}`}
                        className="text-white/50 hover:text-red-300 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* TAB 7: THEME & SCORING */}
        {tab === 'theme' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form onSubmit={handleSaveTheme} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
              <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Kustomisasi Warna & Kutipan</h3>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-xs">
                  <span className="block mb-1">Primary</span>
                  <input
                    type="color"
                    value={themeForm.primaryColor}
                    onChange={(e) => setThemeForm({ ...themeForm, primaryColor: e.target.value })}
                    className="w-full h-10 rounded cursor-pointer"
                  />
                </label>
                <label className="text-xs">
                  <span className="block mb-1">Secondary</span>
                  <input
                    type="color"
                    value={themeForm.secondaryColor}
                    onChange={(e) => setThemeForm({ ...themeForm, secondaryColor: e.target.value })}
                    className="w-full h-10 rounded cursor-pointer"
                  />
                </label>
                <label className="text-xs">
                  <span className="block mb-1">Accent</span>
                  <input
                    type="color"
                    value={themeForm.accentColor}
                    onChange={(e) => setThemeForm({ ...themeForm, accentColor: e.target.value })}
                    className="w-full h-10 rounded cursor-pointer"
                  />
                </label>
              </div>
              <input
                type="text"
                value={themeForm.quoteText}
                onChange={(e) => setThemeForm({ ...themeForm, quoteText: e.target.value })}
                placeholder="Kutipan penyemangat dashboard"
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
              />
              <input
                type="text"
                value={themeForm.quoteAuthor}
                onChange={(e) => setThemeForm({ ...themeForm, quoteAuthor: e.target.value })}
                placeholder="Penulis kutipan"
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm flex items-center gap-1 cursor-pointer">
                <Check className="w-4 h-4" /> Simpan Tema
              </button>
            </form>

            {isSuperAdmin && (
              <form onSubmit={handleSaveScoring} className="bg-[#101B45]/90 rounded-2xl p-6 border border-white/15 space-y-4">
                <h3 className="font-display text-2xl font-bold text-[#D5BF50]">Konfigurasi Penilaian Try Out (Super Admin)</h3>
                <p className="text-xs text-sky-200">
                  Data jawaban mentah disimpan terpisah sehingga skala konversi dapat diperbarui kapan saja.
                </p>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <label>
                    <span className="block mb-1">Skor Dasar</span>
                    <input
                      type="number"
                      value={scoringForm.baseScore}
                      onChange={(e) => setScoringForm({ ...scoringForm, baseScore: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded bg-white/10 border border-white/20"
                    />
                  </label>
                  <label>
                    <span className="block mb-1">Skor Maks</span>
                    <input
                      type="number"
                      value={scoringForm.maxScore}
                      onChange={(e) => setScoringForm({ ...scoringForm, maxScore: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded bg-white/10 border border-white/20"
                    />
                  </label>
                  <label>
                    <span className="block mb-1">Penalti Salah</span>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      value={scoringForm.wrongPenalty}
                      onChange={(e) => setScoringForm({ ...scoringForm, wrongPenalty: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded bg-white/10 border border-white/20"
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={scoringForm.label}
                  onChange={(e) => setScoringForm({ ...scoringForm, label: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm"
                />
                <button type="submit" className="px-4 py-2 rounded-lg bg-[#D5BF50] text-[#101B45] font-bold text-sm cursor-pointer">
                  Simpan Konfigurasi Skor
                </button>
              </form>
            )}
          </div>
        )}

        {/* TAB 8: GLOBAL SITE ASSETS (STRICTLY SUPER ADMIN ONLY!) */}
        {tab === 'site_assets' && isSuperAdmin && (
          <div data-testid="super-admin-global-assets" className="space-y-6">
            <div className="bg-[#101B45]/90 rounded-2xl p-6 border border-[#D5BF50]/50 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-2xl font-bold text-[#D5BF50] flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" /> Manajemen Gambar Global Terpusat (Super Admin Only)
                  </h3>
                  <p className="text-xs text-sky-200 mt-0.5">
                    Kelola setiap slot gambar global secara individual (desktop & mobile, ukuran/rasio, object-fit, posisi fokus, alt text, rollback versi sebelumnya, dan reset default).
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'branding', 'landing', 'banner', 'cards', 'background', 'library'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setAssetCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                        assetCategoryFilter === cat ? 'bg-[#D5BF50] text-[#101B45]' : 'bg-white/10 text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredSiteAssets.map((asset) => {
                  const draft = assetDrafts[asset.slot_key] || asset;
                  return (
                    <div
                      key={asset.slot_key}
                      data-testid={`site-asset-card-${asset.slot_key}`}
                      className="p-4 rounded-xl bg-white/5 border border-white/15 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-display text-xl font-bold text-white">{asset.label}</h4>
                            <span className="px-2 py-0.5 rounded bg-[#0757B8] text-[10px] font-bold uppercase">
                              {asset.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-sky-200">
                            Slot: <code className="font-mono">{asset.slot_key}</code> · Lokasi: {asset.page_location}
                          </p>
                        </div>
                      </div>

                      {/* Live Desktop & Mobile Preview */}
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <div className="col-span-2 h-28 rounded-lg border border-white/15 bg-black/30 overflow-hidden">
                          {asset.desktop_url ? (
                            <img
                              src={asset.desktop_url}
                              alt={draft.alt_text || asset.label}
                              className="w-full h-full"
                              style={{ objectFit: draft.object_fit, objectPosition: draft.object_position }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-white/50">
                              Belum ada gambar desktop
                            </div>
                          )}
                        </div>
                        <div className="col-span-1 h-28 rounded-lg border border-white/15 bg-black/30 overflow-hidden">
                          {asset.mobile_url ? (
                            <img
                              src={asset.mobile_url}
                              alt={`${asset.label} Mobile`}
                              className="w-full h-full"
                              style={{ objectFit: draft.object_fit, objectPosition: draft.object_position }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[11px] text-center px-2 text-white/50">
                              Mobile memakai desktop
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Upload Desktop / Mobile + Rollback + Reset */}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="px-3 py-1.5 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] font-bold cursor-pointer flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5" /> Ganti Desktop
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={(e) => handleUploadSiteAsset(asset.slot_key, 'desktop', e.target.files?.[0])}
                          />
                        </label>
                        <label className="px-3 py-1.5 rounded-lg bg-[#14244F] hover:bg-[#1E336E] border border-white/20 font-bold cursor-pointer flex items-center gap-1">
                          <Upload className="w-3.5 h-3.5" /> Upload Mobile
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={(e) => handleUploadSiteAsset(asset.slot_key, 'mobile', e.target.files?.[0])}
                          />
                        </label>
                        {asset.previous_url && (
                          <button
                            type="button"
                            onClick={() => handleRollbackSiteAsset(asset.slot_key)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Undo2 className="w-3.5 h-3.5" /> Rollback
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleResetSiteAsset(asset.slot_key)}
                          className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reset
                        </button>
                      </div>

                      {/* Individual Composition Controls */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-2 border-t border-white/10">
                        <input
                          type="text"
                          value={draft.alt_text}
                          onChange={(e) =>
                            setAssetDrafts({
                              ...assetDrafts,
                              [asset.slot_key]: { ...draft, alt_text: e.target.value },
                            })
                          }
                          placeholder="Alt text"
                          className="col-span-2 px-2 py-1 rounded bg-slate-900 border border-white/20"
                        />
                        <select
                          value={draft.object_fit}
                          onChange={(e) =>
                            setAssetDrafts({
                              ...assetDrafts,
                              [asset.slot_key]: {
                                ...draft,
                                object_fit: e.target.value as SiteAssetConfig['object_fit'],
                              },
                            })
                          }
                          className="px-2 py-1 rounded bg-slate-900 border border-white/20"
                        >
                          <option value="cover">cover</option>
                          <option value="contain">contain</option>
                          <option value="fill">fill</option>
                          <option value="scale-down">scale-down</option>
                        </select>
                        <select
                          value={draft.object_position}
                          onChange={(e) =>
                            setAssetDrafts({
                              ...assetDrafts,
                              [asset.slot_key]: { ...draft, object_position: e.target.value },
                            })
                          }
                          className="px-2 py-1 rounded bg-slate-900 border border-white/20"
                        >
                          <option value="center">center</option>
                          <option value="top">top</option>
                          <option value="bottom">bottom</option>
                          <option value="left">left</option>
                          <option value="right">right</option>
                        </select>
                        <input
                          type="text"
                          value={draft.aspect_ratio}
                          onChange={(e) =>
                            setAssetDrafts({
                              ...assetDrafts,
                              [asset.slot_key]: { ...draft, aspect_ratio: e.target.value },
                            })
                          }
                          placeholder="Rasio (16/9, auto)"
                          className="col-span-2 px-2 py-1 rounded bg-slate-900 border border-white/20"
                        />
                        <select
                          value={draft.alignment}
                          onChange={(e) =>
                            setAssetDrafts({
                              ...assetDrafts,
                              [asset.slot_key]: {
                                ...draft,
                                alignment: e.target.value as SiteAssetConfig['alignment'],
                              },
                            })
                          }
                          className="px-2 py-1 rounded bg-slate-900 border border-white/20"
                        >
                          <option value="left">align-left</option>
                          <option value="center">align-center</option>
                          <option value="right">align-right</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleSaveSiteAssetConfig(asset.slot_key)}
                          className="px-2.5 py-1 rounded bg-[#D5BF50] text-[#101B45] font-bold cursor-pointer"
                        >
                          Simpan Layout
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB: MULTI-AI PROVIDERS & LOGS (STRICTLY SUPER ADMIN) */}
        {tab === 'ai_providers' && isSuperAdmin && (
          <div data-testid="super-admin-ai-providers" className="space-y-6">
            <div className="bg-[#101B45]/90 rounded-2xl p-6 border border-[#D5BF50]/50 space-y-5">
              <div>
                <h3 className="font-display text-2xl font-bold text-[#D5BF50] flex items-center gap-2">
                  <Sparkles className="w-5 h-5" /> Multi-AI Provider & Routing Fallback (Super Admin Only)
                </h3>
                <p className="text-xs text-sky-200 mt-0.5">
                  API key disimpan terenkripsi AES-256-GCM di server dan tidak pernah dikirim dalam bentuk plaintext ke browser. Fallback otomatis hanya aktif jika provider utama timeout/rate-limit/down.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {aiProviders.map((prov) => {
                  const draft = aiDrafts[prov.provider_key] || {
                    is_enabled: prov.is_enabled,
                    is_primary: prov.is_primary,
                    is_fallback: prov.is_fallback,
                    model_name: prov.model_name,
                    api_key: '',
                  };
                  return (
                    <div
                      key={prov.provider_key}
                      data-testid={`ai-provider-card-${prov.provider_key}`}
                      className="p-5 rounded-xl bg-white/5 border border-white/15 space-y-4 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-display text-2xl font-bold text-white">{prov.display_name}</h4>
                          <p className="text-sky-200">
                            Sumber Key: <strong className="uppercase">{prov.key_source}</strong> ·{' '}
                            <code className="font-mono">{prov.masked_key || 'Belum diatur'}</code>
                          </p>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded font-bold uppercase text-[11px] ${
                            prov.last_status === 'ok'
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                              : prov.last_status === 'error'
                              ? 'bg-red-500/20 text-red-200 border border-red-400/40'
                              : 'bg-white/10 text-sky-200'
                          }`}
                        >
                          {prov.last_status === 'ok' ? 'Sehat' : prov.last_status === 'error' ? 'Error' : 'Belum Diuji'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <label className="flex items-center gap-2 p-2 rounded-lg bg-black/25 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.is_enabled}
                            onChange={(e) =>
                              setAiDrafts({
                                ...aiDrafts,
                                [prov.provider_key]: { ...draft, is_enabled: e.target.checked },
                              })
                            }
                          />
                          <span>Aktif</span>
                        </label>
                        <label className="flex items-center gap-2 p-2 rounded-lg bg-black/25 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.is_primary}
                            onChange={(e) =>
                              setAiDrafts({
                                ...aiDrafts,
                                [prov.provider_key]: {
                                  ...draft,
                                  is_primary: e.target.checked,
                                  is_fallback: e.target.checked ? false : draft.is_fallback,
                                },
                              })
                            }
                          />
                          <span>Primary</span>
                        </label>
                        <label className="flex items-center gap-2 p-2 rounded-lg bg-black/25 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.is_fallback}
                            onChange={(e) =>
                              setAiDrafts({
                                ...aiDrafts,
                                [prov.provider_key]: {
                                  ...draft,
                                  is_fallback: e.target.checked,
                                  is_primary: e.target.checked ? false : draft.is_primary,
                                },
                              })
                            }
                          />
                          <span>Fallback</span>
                        </label>
                      </div>

                      <label className="space-y-1 block">
                        <span className="text-sky-200 font-semibold block">Model Aktif</span>
                        <select
                          value={draft.model_name}
                          onChange={(e) =>
                            setAiDrafts({
                              ...aiDrafts,
                              [prov.provider_key]: { ...draft, model_name: e.target.value },
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg bg-[#0757B8] border border-white/20 font-mono"
                        >
                          {prov.available_models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 block">
                        <span className="text-sky-200 font-semibold block">
                          API Key Baru (kosongkan jika tidak mengubah)
                        </span>
                        <input
                          type="password"
                          value={draft.api_key}
                          onChange={(e) =>
                            setAiDrafts({
                              ...aiDrafts,
                              [prov.provider_key]: { ...draft, api_key: e.target.value },
                            })
                          }
                          placeholder={prov.has_key ? `Tersimpan (${prov.masked_key})` : 'Masukkan API key...'}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-white/20 font-mono"
                        />
                      </label>

                      {prov.last_error && (
                        <p className="p-2 rounded bg-red-500/15 border border-red-400/40 text-red-200">
                          Error terakhir: {prov.last_error}
                        </p>
                      )}

                      <div className="grid grid-cols-3 gap-2 text-center bg-black/25 p-2.5 rounded-lg">
                        <div>
                          <span className="block text-[10px] text-sky-200">Total Request</span>
                          <strong className="font-mono-num">{prov.total_requests}</strong>
                        </div>
                        <div>
                          <span className="block text-[10px] text-sky-200">Total Token</span>
                          <strong className="font-mono-num">{prov.total_tokens.toLocaleString()}</strong>
                        </div>
                        <div>
                          <span className="block text-[10px] text-sky-200">Est. Biaya</span>
                          <strong className="font-mono-num">${prov.estimated_cost_usd.toFixed(4)}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={savingProvider === prov.provider_key}
                          onClick={() => handleSaveAiProvider(prov.provider_key, false)}
                          className="px-4 py-2 rounded-lg bg-[#D5BF50] hover:bg-amber-300 text-[#101B45] font-bold cursor-pointer disabled:opacity-50"
                        >
                          {savingProvider === prov.provider_key ? 'Menyimpan...' : 'Simpan'}
                        </button>
                        <button
                          type="button"
                          disabled={testingProvider === prov.provider_key}
                          onClick={() => handleTestAiProvider(prov.provider_key)}
                          className="px-3.5 py-2 rounded-lg bg-[#0757B8] hover:bg-[#0D4FA8] font-bold cursor-pointer disabled:opacity-50"
                        >
                          {testingProvider === prov.provider_key ? 'Menguji...' : 'Test Koneksi'}
                        </button>
                        {prov.key_source === 'database' && (
                          <button
                            type="button"
                            onClick={() => handleSaveAiProvider(prov.provider_key, true)}
                            className="px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/35 text-red-200 font-semibold cursor-pointer"
                          >
                            Hapus Key DB
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Request Logs */}
            <div className="bg-[#0D4FA8]/65 dark:bg-[#111B3A] rounded-2xl p-5 border border-white/15 space-y-3">
              <h4 className="font-display text-xl font-bold uppercase text-[#D5BF50]">
                Log Penggunaan AI Terbaru ({aiLogs.length})
              </h4>
              {aiLogs.length === 0 ? (
                <p className="text-xs text-sky-200">Belum ada aktivitas request AI tercatat.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left uppercase text-sky-200 border-b border-white/15">
                        <th className="py-2 pr-3">Waktu</th>
                        <th className="py-2 pr-3">Provider & Model</th>
                        <th className="py-2 pr-3">Operasi</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Token</th>
                        <th className="py-2 pr-3">Biaya</th>
                        <th className="py-2 text-right">Latensi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {aiLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2 pr-3 font-mono-num text-sky-200">
                            {new Date(log.created_at).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 pr-3 font-mono">
                            {log.provider_key} · {log.model_name}
                            {log.used_fallback && (
                              <span className="ml-1.5 text-[10px] text-amber-300 font-bold">(Fallback)</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">{log.operation}</td>
                          <td className="py-2 pr-3 font-bold">
                            <span
                              className={
                                log.status === 'success'
                                  ? 'text-emerald-300'
                                  : log.status === 'repaired'
                                  ? 'text-amber-300'
                                  : 'text-red-300'
                              }
                            >
                              {log.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-mono-num">{log.total_tokens}</td>
                          <td className="py-2 pr-3 font-mono-num">${log.estimated_cost_usd.toFixed(5)}</td>
                          <td className="py-2 text-right font-mono-num">{log.duration_ms}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Isolated Tryout Package Questions Inspector */}
        {inspectPkg && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="bg-[#101B45] text-white rounded-2xl max-w-4xl w-full p-6 border border-[#D5BF50] space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-2xl font-bold text-[#D5BF50]">
                    Soal Terisolasi: {inspectPkg.title} ({inspectQuestions.length} soal)
                  </h3>
                  <p className="text-xs text-sky-200">
                    Perubahan di sini hanya memengaruhi paket Try Out ini dan tidak mengubah Bank Soal Drilling.
                  </p>
                </div>
                <button type="button" onClick={() => setInspectPkg(null)} className="p-1.5 hover:bg-white/10 rounded cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2.5">
                {inspectQuestions.map((q) => (
                  <div key={q.id} className="p-3.5 rounded-xl bg-white/5 border border-white/15 flex items-start justify-between gap-4 text-xs">
                    <div className="space-y-1 flex-1">
                      <span className="font-mono-num font-bold text-[#D5BF50]">
                        No. {q.question_number} · {q.external_code} · {q.subtest}
                      </span>
                      <p className="text-sm text-white">{q.question_text}</p>
                      <p className="text-emerald-300">Kunci: {q.correct_answer.join(', ') || 'Belum ada'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingToQ(q)}
                      className="px-3 py-1.5 rounded bg-[#0757B8] font-bold cursor-pointer shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Edit single isolated Tryout Question */}
        {editingToQ && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
            <form
              onSubmit={handleSaveIsolatedTryoutQ}
              className="bg-[#0B122B] text-white rounded-2xl max-w-xl w-full p-6 border border-[#D5BF50] space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-display text-xl font-bold text-[#D5BF50]">Edit Soal Try Out #{editingToQ.question_number}</h4>
                <button type="button" onClick={() => setEditingToQ(null)} className="p-1 hover:bg-white/10 rounded cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                rows={4}
                value={editingToQ.question_text}
                onChange={(e) => setEditingToQ({ ...editingToQ, question_text: e.target.value })}
                className="w-full p-2.5 rounded bg-slate-950 border border-white/20 text-xs"
              />
              <input
                type="text"
                value={editingToQ.correct_answer.join(',')}
                onChange={(e) =>
                  setEditingToQ({
                    ...editingToQ,
                    correct_answer: e.target.value
                      .split(',')
                      .map((s) => s.trim().toUpperCase())
                      .filter(Boolean),
                  })
                }
                placeholder="Kunci jawaban (mis: A)"
                className="w-full px-3 py-2 rounded bg-slate-900 border border-white/20 text-xs font-mono"
              />
              <textarea
                rows={3}
                value={editingToQ.explanation_text}
                onChange={(e) => setEditingToQ({ ...editingToQ, explanation_text: e.target.value })}
                placeholder="Pembahasan"
                className="w-full p-2.5 rounded bg-slate-950 border border-white/20 text-xs"
              />

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-sky-200 font-semibold">Lampiran Gambar Soal</span>
                  <label className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 cursor-pointer inline-flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5" /> + Tambah Gambar
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const res = await apiFetch<{ url: string }>('/api/admin/questions/upload-image', {
                              method: 'POST',
                              body: JSON.stringify({ data_url: String(reader.result) }),
                            });
                            const cur =
                              editingToQ.assets && editingToQ.assets.length > 0
                                ? editingToQ.assets
                                : editingToQ.image_url
                                ? [{ asset_url: editingToQ.image_url, asset_type: 'manual' as const, display_order: 0 }]
                                : [];
                            const next = deduplicateAndOrderDraftAssets([
                              ...cur,
                              { asset_url: res.url, asset_type: 'manual', display_order: cur.length },
                            ]);
                            setEditingToQ({ ...editingToQ, assets: next, image_url: next[0]?.asset_url || null });
                          } catch (err) {
                            setMsg(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
                {(() => {
                  const list =
                    editingToQ.assets && editingToQ.assets.length > 0
                      ? editingToQ.assets
                      : editingToQ.image_url
                      ? [{ asset_url: editingToQ.image_url, asset_type: 'manual' as const, display_order: 0 }]
                      : [];
                  if (list.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {list.map((a, i) => (
                        <div key={`${a.asset_url}-${i}`} className="bg-white rounded p-1 border border-white/20">
                          <img src={a.asset_url} alt={`TO asset ${i + 1}`} className="h-16 w-auto object-contain" />
                          <button
                            type="button"
                            onClick={() => {
                              const next = list
                                .filter((_, idx) => idx !== i)
                                .map((x, idx) => ({ ...x, display_order: idx }));
                              setEditingToQ({
                                ...editingToQ,
                                assets: next,
                                image_url: next[0]?.asset_url || null,
                              });
                            }}
                            className="mt-1 w-full text-[10px] py-0.5 rounded bg-red-600 text-white font-bold cursor-pointer"
                          >
                            Hapus
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingToQ(null)} className="px-3 py-1.5 rounded bg-white/10 text-xs cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-1.5 rounded bg-[#D5BF50] text-[#101B45] text-xs font-bold cursor-pointer">
                  Simpan
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Modal: Super Admin Kick User Confirmation */}
        {kickTarget && isSuperAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Konfirmasi Kick User ${kickTarget.username}`}
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4"
          >
            <div className="bg-[#101B45] text-white rounded-2xl max-w-md w-full p-6 border border-red-400/70 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 text-red-300">
                  <UserX className="w-6 h-6 shrink-0" />
                  <h3 className="font-display text-2xl font-bold uppercase">Keluarkan Pengguna?</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setKickTarget(null)}
                  aria-label="Tutup konfirmasi kick"
                  className="p-1 hover:bg-white/10 rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-xs text-sky-100 leading-relaxed">
                <p>
                  Anda akan mengeluarkan akun <strong className="text-[#D5BF50]">{kickTarget.username}</strong> (ID:{' '}
                  <code className="font-mono">{kickTarget.discord_id}</code>).
                </p>
                <div className="p-3 rounded-xl bg-red-500/15 border border-red-400/40 text-red-100 space-y-1">
                  <p className="font-bold">Dampak Tindakan:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Seluruh sesi login aktif pengguna segera diputus paksa (logout otomatis).</li>
                    <li>Riwayat Try Out, skor leaderboard, sesi drilling, status ragu-ragu, target belajar, ulasan DWU, dan log aktivitasnya dihapus.</li>
                  </ul>
                </div>
                <p className="text-emerald-300 font-semibold">
                  Aman: Soal drilling, paket Try Out, materi Library, dan file PDF yang pernah dibuat pengguna tetap tersimpan.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={kickingUser}
                  onClick={() => setKickTarget(null)}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  data-testid="confirm-kick-user-btn"
                  disabled={kickingUser}
                  onClick={handleConfirmKickUser}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {kickingUser ? 'Mengeluarkan...' : 'Ya, Kick User Sekarang'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toCropTarget && activeToJob && (
          <VisualCropModal
            job={activeToJob}
            draftItem={toCropTarget.item}
            assetIndex={toCropTarget.assetIndex}
            initialAsset={toCropTarget.initialAsset}
            onClose={() => setToCropTarget(null)}
            onCropped={(updatedJob) => {
              setActiveToJob(updatedJob);
              setMsg('Potongan gambar Try Out berhasil diperbarui.');
            }}
          />
        )}
      </div>
    </div>
  );
}
