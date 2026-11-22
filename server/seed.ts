import { db } from './db';
import { normalizeQuestionHash } from '../src/lib/utbkLogic';

export const DEFAULT_SITE_ASSETS = [
  {
    slot_key: 'logo',
    label: 'Logo Komunitas (Header & Brand)',
    category: 'branding',
    page_location: 'TopNav Header (Semua Halaman)',
    desktop_url: '/src/assets/images/community_logo_1795075274111.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/community_logo_1795075274111.jpg',
    alt_text: 'Logo Komunitas Ganesha Circle',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '1/1',
  },
  {
    slot_key: 'landingBanner',
    label: 'Banner Utama Landing Page',
    category: 'landing',
    page_location: 'Landing Page (Kanan Atas)',
    desktop_url: '/src/assets/images/community_banner_1795075273360.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/community_banner_1795075273360.jpg',
    alt_text: 'Banner Komunitas Belajar UTBK Ganesha Circle',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '16/9',
  },
  {
    slot_key: 'catMascot',
    label: 'Maskot Kucing Landing Page',
    category: 'landing',
    page_location: 'Landing Page (Kiri Bawah)',
    desktop_url: '/src/assets/images/landing_cat_mascot_1795075274052.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/landing_cat_mascot_1795075274052.jpg',
    alt_text: 'Maskot Kucing Komunitas',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'left',
    aspect_ratio: '1/1',
  },
  {
    slot_key: 'landingBackground',
    label: 'Background Hero Landing Page',
    category: 'background',
    page_location: 'Landing Page (Latar Belakang Hero)',
    desktop_url: '',
    mobile_url: '',
    default_url: '',
    alt_text: 'Latar Belakang Hero Ganesha Circle',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '16/9',
  },
  {
    slot_key: 'dashboardHeroBanner',
    label: 'Background Banner Dashboard',
    category: 'banner',
    page_location: 'Dashboard (Section Hero Utama)',
    desktop_url: '',
    mobile_url: '',
    default_url: '',
    alt_text: 'Latar Hero Dashboard Ganesha Circle',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '21/9',
  },
  {
    slot_key: 'countdownBanner',
    label: 'Banner Countdown Event',
    category: 'banner',
    page_location: 'Dashboard & Countdown Modal',
    desktop_url: '/src/assets/images/community_banner_1795075273360.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/community_banner_1795075273360.jpg',
    alt_text: 'Banner Countdown UTBK',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '16/9',
  },
  {
    slot_key: 'defaultPackageCover',
    label: 'Cover Default Kartu Try Out',
    category: 'cards',
    page_location: 'Try Out List & Carousel Fallback',
    desktop_url: '/src/assets/images/community_banner_1795075273360.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/community_banner_1795075273360.jpg',
    alt_text: 'Cover Default Paket Try Out',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '16/9',
  },
  {
    slot_key: 'libraryThumbnail',
    label: 'Thumbnail Default Library Materi',
    category: 'library',
    page_location: 'Library Materi (Google Drive)',
    desktop_url: '/src/assets/images/community_logo_1795075274111.jpg',
    mobile_url: '',
    default_url: '/src/assets/images/community_logo_1795075274111.jpg',
    alt_text: 'Thumbnail Materi Komunitas',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '1/1',
  },
  {
    slot_key: 'profileBanner',
    label: 'Banner Header Halaman Profil',
    category: 'banner',
    page_location: 'Profile Page (Header Identitas)',
    desktop_url: '',
    mobile_url: '',
    default_url: '',
    alt_text: 'Banner Profil Ganesha Circle',
    object_fit: 'cover',
    object_position: 'center',
    alignment: 'center',
    aspect_ratio: '21/9',
  },
] as const;

export function syncSiteAssetsToLegacySettings(): void {
  const rows = db.prepare('SELECT slot_key, desktop_url FROM site_assets').all() as Array<{
    slot_key: string;
    desktop_url: string;
  }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.slot_key] = r.desktop_url;
  }
  db.prepare(
    'INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('visual_assets', JSON.stringify(map), new Date().toISOString());
}

export function ensureDefaultAssetsAndCarousel(): void {
  const nowIso = new Date().toISOString();

  // Seed site_assets defaults idempotently (preserve user-customized values)
  const existingSettingRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'visual_assets'").get() as
    | { value_json: string }
    | undefined;
  let existingLegacyMap: Record<string, string> = {};
  if (existingSettingRow) {
    try {
      existingLegacyMap = JSON.parse(existingSettingRow.value_json);
    } catch {
      existingLegacyMap = {};
    }
  }

  const insertSiteAsset = db.prepare(
    `INSERT OR IGNORE INTO site_assets
     (slot_key, label, category, page_location, desktop_url, mobile_url, previous_url, default_url, alt_text, object_fit, object_position, alignment, aspect_ratio, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const asset of DEFAULT_SITE_ASSETS) {
    const legacyUrl = existingLegacyMap[asset.slot_key];
    insertSiteAsset.run(
      asset.slot_key,
      asset.label,
      asset.category,
      asset.page_location,
      legacyUrl ?? asset.desktop_url,
      asset.mobile_url,
      asset.default_url,
      asset.alt_text,
      asset.object_fit,
      asset.object_position,
      asset.alignment,
      asset.aspect_ratio,
      nowIso
    );
  }
  syncSiteAssetsToLegacySettings();

  // Seed default Tryout Carousel Cards if empty
  const carouselCount = (db.prepare('SELECT COUNT(*) as c FROM tryout_carousel_cards').get() as { c: number }).c;
  if (carouselCount === 0) {
    const pkgs = db.prepare('SELECT id, title, provider, description FROM tryout_packages ORDER BY id ASC').all() as Array<{
      id: number;
      title: string;
      provider: string;
      description: string;
    }>;
    const insCard = db.prepare(
      `INSERT INTO tryout_carousel_cards
       (package_id, title, description, image_url, status_label, package_label, cta_label, cta_target, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'tryout', ?, 1, ?, ?)`
    );

    if (pkgs.length > 0) {
      pkgs.forEach((p, idx) => {
        insCard.run(
          p.id,
          p.title,
          p.description || 'Simulasi SNBT terstandarisasi dengan pembahasan lengkap dan leaderboard paket.',
          '/src/assets/images/community_banner_1795075273360.jpg',
          idx === 0 ? 'Terbuka Sekarang' : 'Paket Unggulan',
          p.provider,
          'Ikuti Try Out',
          idx + 1,
          nowIso,
          nowIso
        );
      });
    } else {
      insCard.run(
        null,
        'TO Sainsin #1 2027',
        'Simulasi komprehensif Penalaran Umum, Kuantitatif, PBM, dan Penalaran Matematika.',
        '/src/assets/images/community_banner_1795075273360.jpg',
        'Terbuka Sekarang',
        'Sainsin',
        'Mulai Simulasi',
        1,
        nowIso,
        nowIso
      );
    }
  }
}

export function seedInitialData(): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) {
    ensureDefaultAssetsAndCarousel();
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Default system settings (Theme & Scoring Formula)
  const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
  insertSetting.run(
    'theme',
    JSON.stringify({
      primaryColor: '#0757B8',
      secondaryColor: '#0D4FA8',
      accentColor: '#D5BF50',
      quoteText: 'They got a head start. You’re getting a stronger finish',
      quoteAuthor: 'S',
    }),
    nowIso
  );
  insertSetting.run(
    'scoring_config',
    JSON.stringify({
      baseScore: 300,
      maxScore: 1000,
      wrongPenalty: 0,
      label: 'Skala Komunitas (300–1000)',
    }),
    nowIso
  );

  // Seed initial community members (1 Super Admin, 1 Admin, 3 Members)
  const insertUser = db.prepare(
    'INSERT INTO users (discord_id, username, avatar_url, role, target_score, joined_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const u1 = insertUser.run('100000000000000001', 'RakaPratama', '', 'super_admin', 780, nowIso, nowIso).lastInsertRowid as number;
  const u2 = insertUser.run('100000000000000002', 'NadiraTutor', '', 'admin', 770, nowIso, nowIso).lastInsertRowid as number;
  const u3 = insertUser.run('100000000000000003', 'BintangSNBT', '', 'user', 760, nowIso, nowIso).lastInsertRowid as number;
  const u4 = insertUser.run('100000000000000004', 'KaylaAulia', '', 'user', 750, nowIso, nowIso).lastInsertRowid as number;
  const u5 = insertUser.run('100000000000000005', 'DimasFajar', '', 'user', 740, nowIso, nowIso).lastInsertRowid as number;

  // Countdown Event
  const utbkTarget = new Date(now.getTime() + 150 * 86400 * 1000 + 18 * 3600 * 1000);
  db.prepare(
    'INSERT INTO countdown_events (title, target_iso, timezone, is_active, created_at) VALUES (?, ?, ?, 1, ?)'
  ).run('SNBT UTBK 2027', utbkTarget.toISOString(), 'Asia/Jakarta', nowIso);

  // Seed Question Bank (Drilling) across subtests, topics & subtopics
  const sampleQuestions = [
    {
      code: 'PU001',
      subtest: 'Penalaran Umum',
      topic: 'Deduktif',
      subtopic: 'Kecepatan & Waktu',
      difficulty: 'medium',
      question:
        'Perjalanan dari Kota A ke Kota B memakan waktu $6\\text{ jam}$ dengan kecepatan rata-rata $60\\text{ km/jam}$. Jika ingin sampai $2\\text{ jam}$ lebih cepat, berapa kecepatan rata-rata kendaraan yang diperlukan?',
      options: [
        { key: 'A', content: '$90\\text{ km/jam}$' },
        { key: 'B', content: '$80\\text{ km/jam}$' },
        { key: 'C', content: '$75\\text{ km/jam}$' },
        { key: 'D', content: '$100\\text{ km/jam}$' },
        { key: 'E', content: '$120\\text{ km/jam}$' },
      ],
      correct: ['A'],
      explanation: 'Jarak $s = v \\times t = 60 \\times 6 = 360\\text{ km}$. Waktu baru $t_2 = 6 - 2 = 4\\text{ jam}$, sehingga $v_2 = \\frac{360}{4} = 90\\text{ km/jam}$.',
      solution: '1. Hitung total jarak: $60 \\times 6 = 360\\text{ km}$.\n2. Kurangi waktu tempuh: $6 - 2 = 4\\text{ jam}$.\n3. Bagi jarak dengan waktu baru: $360 / 4 = 90\\text{ km/jam}$.',
    },
    {
      code: 'PU002',
      subtest: 'Penalaran Umum',
      topic: 'Deduktif',
      subtopic: 'Silogisme',
      difficulty: 'easy',
      question: 'Semua peserta kelas intensif wajib mengikuti try out mingguan. Sebagian anggota Discord belajar bersama setiap Jumat malam. Jika Raka adalah peserta kelas intensif, simpulan yang paling tepat adalah...',
      options: [
        { key: 'A', content: 'Raka wajib mengikuti try out mingguan.' },
        { key: 'B', content: 'Raka pasti belajar setiap Jumat malam.' },
        { key: 'C', content: 'Sebagian peserta kelas intensif tidak ikut try out.' },
        { key: 'D', content: 'Raka bukan anggota Discord.' },
        { key: 'E', content: 'Tidak dapat ditarik kesimpulan.' },
      ],
      correct: ['A'],
      explanation: 'Berdasarkan silogisme kategoris, karena semua peserta kelas intensif wajib mengikuti try out mingguan dan Raka termasuk di dalamnya, maka Raka wajib mengikuti try out mingguan.',
      solution: 'Premis 1: $\\forall x (P(x) \\rightarrow Q(x))$. Premis 2: $P(\\text{Raka})$. Maka $Q(\\text{Raka})$.',
    },
    {
      code: 'PU003',
      subtest: 'Penalaran Umum',
      topic: 'Induktif',
      subtopic: 'Barisan Bilangan',
      difficulty: 'medium',
      question: 'Perhatikan barisan bilangan berikut: $3, 7, 15, 31, 63, \\dots$. Nilai suku berikutnya adalah...',
      options: [
        { key: 'A', content: '$125$' },
        { key: 'B', content: '$126$' },
        { key: 'C', content: '$127$' },
        { key: 'D', content: '$128$' },
        { key: 'E', content: '$131$' },
      ],
      correct: ['C'],
      explanation: 'Pola suku ke-$n$ memenuhi $U_{n} = 2U_{n-1} + 1$. Jadi $63 \\times 2 + 1 = 127$.',
      solution: 'Selisih antar suku adalah $4, 8, 16, 32$, maka selisih berikutnya $64$: $63 + 64 = 127$.',
    },
    {
      code: 'PU004',
      subtest: 'Penalaran Umum',
      topic: 'Induktif',
      subtopic: 'Evaluasi Argumen',
      difficulty: 'hard',
      question: 'Sebuah survei menunjukkan tingkat kelulusan siswa yang rutin mengerjakan drilling soal meningkat $25\\%$ dibandingkan kelompok yang hanya membaca rangkuman. Pernyataan yang **paling memperlemah** klaim tersebut adalah...',
      options: [
        { key: 'A', content: 'Siswa yang ikut drilling umumnya memang sudah memiliki jam belajar harian dua kali lipat lebih tinggi.' },
        { key: 'B', content: 'Soal drilling disusun oleh alumni PTN.' },
        { key: 'C', content: 'Kelompok pembaca rangkuman belajar pada malam hari.' },
        { key: 'D', content: 'Jumlah responden pada kedua kelompok sama besar.' },
        { key: 'E', content: 'Materi ujian tahun ini tidak berubah.' },
      ],
      correct: ['A'],
      explanation: 'Adanya variabel perancu (*confounding variable*) berupa total jam belajar menunjukkan peningkatan tidak semata-mata disebabkan oleh metode drilling.',
      solution: 'Cari opsi yang memperkenalkan faktor alternatif penyebab peningkatan skor.',
    },
    {
      code: 'PK001',
      subtest: 'Penalaran Kuantitatif',
      topic: 'Bilangan',
      subtopic: 'Persamaan Diophantine',
      difficulty: 'medium',
      question: 'Jika $a$ dan $b$ adalah bilangan bulat positif yang memenuhi $\\frac{1}{a} + \\frac{1}{b} = \\frac{1}{6}$, berapakah nilai maksimum dari $a + b$?',
      options: [
        { key: 'A', content: '$24$' },
        { key: 'B', content: '$25$' },
        { key: 'C', content: '$36$' },
        { key: 'D', content: '$49$' },
        { key: 'E', content: '$48$' },
      ],
      correct: ['D'],
      explanation: 'Persamaan setara dengan $(a-6)(b-6) = 36$. Untuk memaksimalkan $a+b$, pilih faktor terkecil dan terbesar: $a-6 = 1 \\Rightarrow a=7$ dan $b-6 = 36 \\Rightarrow b=42$. Jadi $a+b = 49$.',
      solution: '$\\frac{a+b}{ab} = \\frac{1}{6} \\Rightarrow ab - 6a - 6b = 0 \\Rightarrow (a-6)(b-6) = 36$. Pasangan positif $(1, 36)$ menghasilkan $a+b = 7+42 = 49$.',
    },
    {
      code: 'PK002',
      subtest: 'Penalaran Kuantitatif',
      topic: 'Perbandingan',
      subtopic: 'Rasio Senilai',
      difficulty: 'easy',
      question: 'Perbandingan uang Bintang dan Kayla adalah $3 : 5$. Jika selisih uang mereka Rp$120.000$, berapakah jumlah uang mereka berdua?',
      options: [
        { key: 'A', content: 'Rp$360.000$' },
        { key: 'B', content: 'Rp$420.000$' },
        { key: 'C', content: 'Rp$480.000$' },
        { key: 'D', content: 'Rp$540.000$' },
        { key: 'E', content: 'Rp$600.000$' },
      ],
      correct: ['C'],
      explanation: 'Selisih rasio $= 5 - 3 = 2$ bagian $= 120.000 \\Rightarrow 1$ bagian $= 60.000$. Jumlah $= (3+5) \\times 60.000 = 480.000$.',
      solution: '$\\frac{3+5}{5-3} \\times 120.000 = 4 \\times 120.000 = 480.000$.',
    },
    {
      code: 'PK003',
      subtest: 'Penalaran Kuantitatif',
      topic: 'Fungsi & Aljabar',
      subtopic: 'Komposisi Fungsi',
      difficulty: 'medium',
      question: 'Diketahui fungsi $f(x) = 2x - 3$ dan $(g \\circ f)(x) = 4x^2 - 12x + 11$. Nilai dari $g(3)$ adalah...',
      options: [
        { key: 'A', content: '$9$' },
        { key: 'B', content: '$11$' },
        { key: 'C', content: '$13$' },
        { key: 'D', content: '$15$' },
        { key: 'E', content: '$17$' },
      ],
      correct: ['B'],
      explanation: 'Perhatikan bahwa $(2x-3)^2 = 4x^2 - 12x + 9$, sehingga $g(f(x)) = (f(x))^2 + 2$. Maka $g(3) = 3^2 + 2 = 11$.',
      solution: 'Substitusi $2x - 3 = 3 \\Rightarrow x = 3$ ke $4(3)^2 - 12(3) + 11 = 36 - 36 + 11 = 11$.',
    },
    {
      code: 'PBM001',
      subtest: 'PBM',
      topic: 'Ejaan & Kalimat Efektif',
      subtopic: 'EYD V & Pleonasme',
      difficulty: 'easy',
      question: 'Manakah penulisan kalimat berikut yang paling sesuai dengan EYD V?',
      options: [
        { key: 'A', content: 'Para mahasiswa-mahasiswa berkumpul di aula timur sejak pagi.' },
        { key: 'B', content: 'Meskipun hujan deras, namun diskusi tetap berlangsung.' },
        { key: 'C', content: 'Rapat evaluasi pekanan dilaksanakan di Gedung Serbaguna pada pukul 19.30 WIB.' },
        { key: 'D', content: 'Mereka saling bantu-membantu dalam menyusun modul belajar.' },
        { key: 'E', content: 'Di era digital ini menuntut kesiapan literasi data yang kuat.' },
      ],
      correct: ['C'],
      explanation: 'Pilihan A dan D pleonasme (*para mahasiswa-mahasiswa*, *saling bantu-membantu*), B menggabungkan dua konjungsi (*meskipun... namun*), E tidak memiliki subjek karena diawali preposisi *Di*.',
      solution: 'Kalimat C memiliki struktur S-P-K yang jelas serta penulisan waktu yang baku (tanda titik pemisah jam dan menit).',
    },
    {
      code: 'PPU001',
      subtest: 'PPU',
      topic: 'Makna & Imbuhan',
      subtopic: 'Makna Asosiatif',
      difficulty: 'medium',
      question: 'Kata *menggeliat* dalam kalimat "Industri kreatif mulai menggeliat setelah pandemi mereda" memiliki makna asosiatif yang paling dekat dengan...',
      options: [
        { key: 'A', content: 'Bergerak bangkit kembali' },
        { key: 'B', content: 'Mengalami kemunduran tajam' },
        { key: 'C', content: 'Berhenti beroperasi sementara' },
        { key: 'D', content: 'Menolak perubahan regulasi' },
        { key: 'E', content: 'Berpindah lokasi usaha' },
      ],
      correct: ['A'],
      explanation: 'Dalam konteks ekonomi/industri, *menggeliat* bermakna kiasan mulai bergerak aktif atau bangkit kembali.',
      solution: 'Identifikasi konteks kalimat ("setelah pandemi mereda") yang menandakan pemulihan aktivitas.',
    },
    {
      code: 'LBE001',
      subtest: 'LBE',
      topic: 'Reading Comprehension',
      subtopic: 'Main Idea & Cause',
      difficulty: 'medium',
      question: 'In academic discourse, spaced repetition strengthens long-term retention primarily because...',
      options: [
        { key: 'A', content: 'it forces active retrieval just before forgetting occurs' },
        { key: 'B', content: 'it eliminates the need to take notes during lectures' },
        { key: 'C', content: 'it relies exclusively on passive re-reading of summaries' },
        { key: 'D', content: 'it reduces total study duration to five minutes per month' },
        { key: 'E', content: 'it replaces conceptual understanding with rote memorization' },
      ],
      correct: ['A'],
      explanation: 'Spaced repetition leverages the spacing effect and active recall right as memory trace begins to decay.',
      solution: 'Active retrieval at increasing intervals reinforces neural consolidation.',
    },
    {
      code: 'PM001',
      subtest: 'PM',
      topic: 'Limit & Trigonometri',
      subtopic: 'Identitas Sudut Rangkap',
      difficulty: 'hard',
      question: 'Nilai dari $\\lim_{x \\to 0} \\frac{1 - \\cos 2x}{x \\sin x}$ adalah...',
      options: [
        { key: 'A', content: '$0$' },
        { key: 'B', content: '$1$' },
        { key: 'C', content: '$2$' },
        { key: 'D', content: '$4$' },
        { key: 'E', content: '$\\frac{1}{2}$' },
      ],
      correct: ['C'],
      explanation: 'Gunakan identitas $1 - \\cos 2x = 2\\sin^2 x$, sehingga $\\lim_{x \\to 0} \\frac{2\\sin^2 x}{x \\sin x} = \\lim_{x \\to 0} 2 \\cdot \\frac{\\sin x}{x} = 2$.',
      solution: '$1 - \\cos 2x = 2\\sin^2 x \\Rightarrow \\frac{2\\sin x}{x} \\to 2$.',
    },
    {
      code: 'LBI001',
      subtest: 'Literasi Bahasa Inggris',
      topic: 'Inference',
      subtopic: 'Implicit Conclusion',
      difficulty: 'medium',
      question: 'Which statement best captures the main benefit of peer-led study communities?',
      options: [
        { key: 'A', content: 'Members identify blind spots faster through collaborative discussion' },
        { key: 'B', content: 'Individual effort becomes unnecessary when working in groups' },
        { key: 'C', content: 'Peer groups always guarantee higher scores without practice' },
        { key: 'D', content: 'Studying alone is strictly ineffective for quantitative tests' },
        { key: 'E', content: 'Tutors complete all practice problems on behalf of members' },
      ],
      correct: ['A'],
      explanation: 'Collaborative discussion exposes misconceptions and blind spots more quickly than isolated study.',
      solution: 'Eliminate extreme options (*always*, *unnecessary*, *strictly ineffective*).',
    },
  ];

  const insertQ = db.prepare(
    `INSERT INTO questions (external_code, subtest, topic, subtopic, upload_mode, difficulty, question_type, question_text, image_url, options_json, correct_answer_json, explanation_text, solution_text, content_hash, is_published, created_by, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?, 'single_choice', ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const drillQIds: Record<string, number> = {};
  const sampleByCode: Record<string, (typeof sampleQuestions)[number]> = {};
  for (const q of sampleQuestions) {
    sampleByCode[q.code] = q;
    const id = insertQ.run(
      q.code,
      q.subtest,
      q.topic,
      q.subtopic,
      q.difficulty,
      q.question,
      JSON.stringify(q.options),
      JSON.stringify(q.correct),
      q.explanation,
      q.solution,
      normalizeQuestionHash(q.question),
      u1,
      nowIso
    ).lastInsertRowid as number;
    drillQIds[q.code] = id;
  }

  // Seed 3 Try Out packages with completely isolated tryout_questions rows!
  const insertPkg = db.prepare(
    'INSERT INTO tryout_packages (title, provider, description, cover_url, is_published, starts_at, ends_at, created_at) VALUES (?, ?, ?, NULL, 1, NULL, NULL, ?)'
  );
  const pkg1 = insertPkg.run('TO Sainsin #1 2027', 'Sainsin', 'Simulasi komprehensif Penalaran Umum, Kuantitatif, PBM, dan Penalaran Matematika.', nowIso).lastInsertRowid as number;
  const pkg2 = insertPkg.run('TO Pahamify #1 2027', 'Pahamify', 'Paket evaluasi literasi dan penalaran tingkat lanjut.', nowIso).lastInsertRowid as number;
  const pkg3 = insertPkg.run('TO Inten #1 2027', 'Inten', 'Paket pemantapan konsep dasar hingga soal HOTS UTBK.', nowIso).lastInsertRowid as number;

  const insertSubtest = db.prepare(
    'INSERT INTO tryout_subtests (package_id, subtest_code, subtest_name, duration_seconds, sort_order, question_ids_json) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertToQuestion = db.prepare(
    `INSERT INTO tryout_questions (package_id, subtest_id, question_number, external_code, subtest, topic, difficulty, question_type, question_text, image_url, has_visual, visual_description, options_json, correct_answer_json, explanation_text, solution_text, needs_review, review_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'single_choice', ?, NULL, 0, '', ?, ?, ?, ?, 0, '', ?)`
  );
  const updateSubtestQIds = db.prepare('UPDATE tryout_subtests SET question_ids_json = ? WHERE id = ?');

  const addSubtestWithClonedQuestions = (
    packageId: number,
    code: string,
    name: string,
    durationSec: number,
    sortOrder: number,
    qCodes: string[]
  ) => {
    const subId = Number(insertSubtest.run(packageId, code, name, durationSec, sortOrder, '[]').lastInsertRowid);
    const createdIds: number[] = [];
    qCodes.forEach((qc, idx) => {
      const q = sampleByCode[qc];
      if (!q) return;
      const qid = Number(
        insertToQuestion.run(
          packageId,
          subId,
          idx + 1,
          `TO${packageId}-${q.code}`,
          name,
          q.topic,
          q.difficulty,
          q.question,
          JSON.stringify(q.options),
          JSON.stringify(q.correct),
          q.explanation,
          q.solution,
          nowIso
        ).lastInsertRowid
      );
      createdIds.push(qid);
    });
    updateSubtestQIds.run(JSON.stringify(createdIds), subId);
  };

  addSubtestWithClonedQuestions(pkg1, 'PU', 'Penalaran Umum', 900, 1, ['PU001', 'PU002', 'PU003', 'PU004']);
  addSubtestWithClonedQuestions(pkg1, 'PK', 'Penalaran Kuantitatif', 900, 2, ['PK001', 'PK002', 'PK003']);
  addSubtestWithClonedQuestions(pkg1, 'PM', 'PM', 600, 3, ['PM001', 'PBM001']);

  addSubtestWithClonedQuestions(pkg2, 'LBE', 'LBE', 600, 1, ['LBE001', 'LBI001']);
  addSubtestWithClonedQuestions(pkg2, 'PPU', 'PPU', 600, 2, ['PPU001', 'PBM001']);

  addSubtestWithClonedQuestions(pkg3, 'PU', 'Penalaran Umum', 900, 1, ['PU001', 'PU003', 'PK001', 'PM001']);

  // Seed completed Try Out sessions
  const insertSession = db.prepare(
    `INSERT INTO tryout_sessions (user_id, package_id, mode, status, current_subtest_index, subtest_started_at, subtest_states_json, active_duration_seconds, raw_correct, raw_wrong, raw_blank, utbk_score, subtest_scores_json, started_at, completed_at)
     VALUES (?, ?, ?, 'completed', 2, ?, '{}', ?, ?, ?, 0, ?, ?, ?, ?)`
  );
  const d1 = new Date(now.getTime() - 14 * 86400 * 1000).toISOString();
  const d2 = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
  const d3 = new Date(now.getTime() - 2 * 86400 * 1000).toISOString();

  insertSession.run(u1, pkg1, 'simulation', d1, 1420, 7, 2, 780, JSON.stringify({ 'Penalaran Umum': { correct: 3, wrong: 1, blank: 0, total: 4, score: 825 }, 'Penalaran Kuantitatif': { correct: 3, wrong: 0, blank: 0, total: 3, score: 1000 } }), d1, d1);
  insertSession.run(u2, pkg1, 'staged', d2, 1580, 6, 3, 750, JSON.stringify({ 'Penalaran Umum': { correct: 3, wrong: 1, blank: 0, total: 4, score: 825 } }), d2, d2);
  insertSession.run(u3, pkg1, 'simulation', d2, 1650, 6, 3, 740, JSON.stringify({ 'Penalaran Umum': { correct: 3, wrong: 1, blank: 0, total: 4, score: 825 } }), d2, d2);
  insertSession.run(u4, pkg1, 'staged', d3, 1710, 5, 4, 700, JSON.stringify({ 'Penalaran Umum': { correct: 2, wrong: 2, blank: 0, total: 4, score: 650 } }), d3, d3);
  insertSession.run(u5, pkg1, 'simulation', d3, 1890, 4, 5, 640, JSON.stringify({ 'Penalaran Umum': { correct: 2, wrong: 2, blank: 0, total: 4, score: 650 } }), d3, d3);
  insertSession.run(u1, pkg2, 'staged', d2, 920, 3, 1, 740, JSON.stringify({ LBE: { correct: 2, wrong: 0, blank: 0, total: 2, score: 1000 } }), d2, d2);
  insertSession.run(u1, pkg3, 'simulation', d3, 810, 4, 0, 810, JSON.stringify({ 'Penalaran Umum': { correct: 4, wrong: 0, blank: 0, total: 4, score: 1000 } }), d3, d3);

  // Seed Study Targets (PR Materi)
  const insertTarget = db.prepare('INSERT INTO study_targets (user_id, topic, subtest, status, updated_at) VALUES (?, ?, ?, ?, ?)');
  for (const uid of [u1, u2, u3, u4, u5]) {
    insertTarget.run(uid, 'Fungsi', 'Penalaran Kuantitatif', 'done', nowIso);
    insertTarget.run(uid, 'Trigonometri', 'PM', 'ongoing', nowIso);
    insertTarget.run(uid, 'Limit', 'PM', 'done', nowIso);
    insertTarget.run(uid, 'Aljabar', 'Penalaran Kuantitatif', 'ongoing', nowIso);
  }

  // Seed Mastery
  db.prepare(
    `INSERT INTO user_question_mastery (user_id, source_type, question_id, is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, last_studied_at)
     VALUES (?, 'drill', ?, 1, 1, 1, 1, 0, 'ragu', ?)`
  ).run(u1, drillQIds.PM001, nowIso);
  db.prepare(
    `INSERT INTO user_question_mastery (user_id, source_type, question_id, is_ragu_active, was_ever_ragu, ragu_count, correct_count, wrong_count, status, last_studied_at, understood_at)
     VALUES (?, 'drill', ?, 0, 1, 2, 3, 0, 'understood', ?, ?)`
  ).run(u1, drillQIds.PU001, nowIso, nowIso);

  // Seed Library Google Drive links
  const insertLib = db.prepare(
    'INSERT INTO library_links (title, description, category, subtest, drive_url, thumbnail_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
  );
  insertLib.run('Modul Logika Deduktif & Silogisme', 'Ringkasan aturan penarikan kesimpulan & contoh soal UTBK.', 'Modul PDF', 'Penalaran Umum', 'https://drive.google.com/drive/folders/example-pu', u2, nowIso);
  insertLib.run('Bank Rumus Cepat Kuantitatif & Aljabar', 'Kumpulan identitas aljabar, fungsi kuadrat, dan pertidaksamaan.', 'Catatan', 'Penalaran Kuantitatif', 'https://drive.google.com/drive/folders/example-pk', u2, nowIso);
  insertLib.run('Panduan EYD V & Kalimat Efektif', 'Checklist kesalahan PUEBI/EYD yang paling sering muncul di PBM.', 'Modul PDF', 'PBM', 'https://drive.google.com/drive/folders/example-pbm', u1, nowIso);
  insertLib.run('Academic Reading Strategies (LBE)', 'Teknik skimming, inference, dan tone analysis untuk teks panjang.', 'Slide Tutor', 'LBE', 'https://drive.google.com/drive/folders/example-lbe', u2, nowIso);

  // Seed Jadwal DWU
  const insertDwuSched = db.prepare('INSERT INTO dwu_schedules (subtest_label, scheduled_date, topic, notes, created_at) VALUES (?, ?, ?, ?, ?)');
  insertDwuSched.run('Lbe', '2026-11-24', 'Inference & Author Tone', 'Bahas paket TO Pahamify #1', nowIso);
  insertDwuSched.run('PK', '2026-11-28', 'Bilangan & Perbandingan', 'Review soal ragu terbanyak', nowIso);
  insertDwuSched.run('PM', '2026-12-03', 'Limit & Trigonometri', 'Pendalaman konsep grafik', nowIso);
  insertDwuSched.run('PPU', '2026-12-08', 'Makna Kontekstual', 'Latihan soal cepat 15 menit', nowIso);
  insertDwuSched.run('LBIND', '2026-12-12', 'Ide Pokok & Simpulan', 'Evaluasi akhir bulan', nowIso);

  // Seed two-way DWU Reviews
  const insertDwu = db.prepare(
    'INSERT INTO dwu_reviews (direction, author_id, target_user_id, subtest, topic, ratings_json, comment, weak_topics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insertDwu.run(
    'member_to_tutor',
    u3,
    u2,
    'Penalaran Kuantitatif',
    'Bilangan & Fungsi',
    JSON.stringify({ kejelasan: 5, penguasaan: 5, penjelasan_soal: 5, interaksi: 4, efektivitas: 5 }),
    'Penjelasan trik faktorisasi (a-6)(b-6)=36 sangat mudah dipahami.',
    JSON.stringify(['Aljabar']),
    nowIso
  );
  insertDwu.run(
    'tutor_to_member',
    u2,
    u1,
    'PM',
    'Limit Trigonometri',
    JSON.stringify({ pemahaman: 4, keaktifan: 5, konsistensi: 5, penyelesaian_soal: 4, perkembangan: 5 }),
    'Konsisten di drilling harian, tinggal pertegas identitas sudut rangkap cos 2x.',
    JSON.stringify(['Trigonometri']),
    nowIso
  );

  // Seed one pending Question Report
  db.prepare(
    "INSERT INTO question_reports (question_id, source_type, reporter_id, issue_type, description, status, created_at, updated_at) VALUES (?, 'drill', ?, ?, ?, 'pending', ?, ?)"
  ).run(
    drillQIds.PM001,
    u3,
    'Pembahasan kurang jelas',
    'Mohon tambahkan langkah penjabaran identitas 1 - cos 2x agar lebih mudah diikuti pemula.',
    nowIso,
    nowIso
  );

  db.prepare('INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, ?)').run(
    u1,
    'seed_initialized',
    'Inisialisasi awal basis data komunitas UTBK.',
    nowIso
  );

  ensureDefaultAssetsAndCarousel();
}
