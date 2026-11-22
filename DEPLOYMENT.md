# Deployment & Production Operations Guide — Ganesha Circle

Panduan konfigurasi environment, Discord OAuth2, enkripsi AI Provider, migrasi SQLite, serta checklist verifikasi pasca-deploy untuk lingkungan development maupun production.

---

## 1. Environment Variables

Salin `.env.example` ke environment secret manager atau `.env` di server (jangan pernah commit `.env` berisi credential ke repository).

### Wajib untuk Production
| Variable | Keterangan | Contoh / Catatan |
|---|---|---|
| `APP_URL` | Origin publik aplikasi tanpa trailing slash | `https://ais-pre-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app` |
| `SESSION_SECRET` | Secret HMAC-SHA256 min. 32 karakter acak untuk cookie sesi & OAuth `state` | Wajib diisi di `NODE_ENV=production` |
| `AI_ENCRYPTION_KEY` | Kunci 32+ karakter untuk enkripsi AES-256-GCM key AI Provider di SQLite | Fallback ke `SESSION_SECRET` bila kosong; disarankan kunci terpisah |
| `DISCORD_CLIENT_ID` | Client ID aplikasi dari Discord Developer Portal | Jika terisi bersama `DISCORD_CLIENT_SECRET`, **Preview Quick Login dinonaktifkan otomatis** |
| `DISCORD_CLIENT_SECRET` | Client Secret aplikasi dari Discord Developer Portal | Simpan hanya di server secrets |

### Opsional & Konfigurasi Tambahan
| Variable | Keterangan | Default / Catatan |
|---|---|---|
| `DISCORD_REDIRECT_URI` | Override eksplisit callback URL Discord OAuth2 | Jika kosong, server otomatis memilih `<origin_tervalidasi>/auth/callback` (mendukung localhost, `ais-dev-*`, & `ais-pre-*`) |
| `DISCORD_BOT_TOKEN` | Token bot Discord (opsional, untuk cek keanggotaan server & auto-sync role) | Jika kosong, login Discord tetap berjalan tanpa filter guild |
| `DISCORD_GUILD_ID` | ID server Discord (wajib jika `DISCORD_BOT_TOKEN` dipakai untuk whitelist/role sync) | — |
| `DISCORD_ADMIN_ROLE_IDS` | Daftar Role ID Discord dipisah koma untuk mapping `admin` | — |
| `DISCORD_SUPER_ADMIN_ROLE_IDS` | Daftar Role ID Discord dipisah koma untuk mapping `super_admin` | — |
| `DISCORD_USER_ROLE_IDS` | Daftar Role ID Discord dipisah koma untuk member biasa | — |
| `SUPER_ADMIN_USER_IDS` | Daftar Discord User ID dipisah koma untuk promosi otomatis ke `super_admin` | — |
| `GEMINI_API_KEY` | API key default Gemini dari environment (bila belum diisi di UI Super Admin) | Bisa dikelola dinamis dari panel **Super Admin → AI Providers** |
| `OPENAI_API_KEY` | API key default OpenAI dari environment (opsional) | Bisa dikelola dinamis dari panel **Super Admin → AI Providers** |
| `PORT` | Port HTTP server | `3000` |
| `NODE_ENV` | Mode runtime (`development` / `production`) | `production` saat deploy |

---

## 2. Konfigurasi Discord Developer Portal (OAuth2)

Buka **Discord Developer Portal → Application → OAuth2 → General → Redirects** dan daftarkan URL callback berikut **persis karakter-demi-karakter**:

1. **Production Custom Domain (AI Studio)**:
   ```text
   https://ganesha-circle-komunitas-belajar-utbk.ai.studio/auth/callback
   ```
2. **Production / Shared Preview (Cloud Run)**:
   ```text
   https://ais-pre-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app/auth/callback
   ```
3. **Development / AI Studio Dev**:
   ```text
   https://ais-dev-34eczcaffwpwppjfkcdx4a-1007267258248.asia-east1.run.app/auth/callback
   ```
4. **Localhost Development (opsional)**:
   ```text
   http://localhost:3000/auth/callback
   ```

### Mekanisme Keamanan OAuth2 & Cookie Iframe
- Endpoint `GET /api/auth/discord/url` hanya menerima origin yang lolos `resolveAllowedOAuthOrigin` (domain tepercaya `APP_URL`, sibling `ais-dev-*`/`ais-pre-*`, atau `localhost` ketika diakses lokal) untuk mencegah open redirect & mismatch `redirect_uri`.
- `state` ditandatangani HMAC-SHA256 (`statePayload.signature`) dengan TTL 10 menit dan diverifikasi di `/auth/callback`.
- Cookie `utbk_session` disetel dengan `HttpOnly; Secure; SameSite=None; Partitioned` agar login tetap berfungsi di dalam iframe maupun tab browser langsung.
- Halaman callback HTML mengirim hasil autentikasi melalui `postMessage` hanya ke origin tervalidasi (`isTrustedPostMessageOrigin`), lalu melakukan fallback redirect otomatis bila dibuka di luar popup.

---

## 3. Database & Migrasi SQLite

- Database utama berada di `data/utbk.db` dan file upload/crop gambar berada di `uploads/`. Pastikan kedua direktori berada pada persistent volume saat deploy container.
- Inisialisasi & migrasi skema dijalankan secara **idempoten** setiap startup server (`initDatabase()` di `server/db.ts`) menggunakan `CREATE TABLE IF NOT EXISTS` dan helper `addColumnIfMissing`.
- Data lama tidak terhapus: seluruh soal eksisting mendapat default `review_status = 'approved'` & `is_published = 1`, sedangkan seluruh soal baru (Manual / PDF Import) masuk dengan `review_status = 'pending_review'` & `is_published = 0` hingga disetujui Admin melalui **Review & Audit Soal**.

---

## 4. Build & Start Production

```bash
# 1. Install dependencies
npm install

# 2. Verifikasi tipe & build bundle frontend (dist/)
npm run build

# 3. Jalankan server Express + static build
NODE_ENV=production npm start
```

Script `package.json`:
- `"build"`: `vite build`
- `"start"`: `node server.ts` (atau via `tsx server.ts` sesuai runtime Node 22+; pastikan `NODE_ENV=production` aktif agar server menyajikan `dist/`).

---

## 5. Post-Deploy Smoke Checklist

Setelah aplikasi live di production:
1. **Health & Auth**:
   - Buka URL production -> pastikan tombol **Preview Quick Login** tidak muncul jika `DISCORD_CLIENT_ID` & `DISCORD_CLIENT_SECRET` sudah terpasang.
   - Uji login **Masuk dengan Discord** -> popup terbuka, selesai callback tanpa `invalid oauth2 redirect_uri`, dan cookie `utbk_session` tersimpan.
2. **Tryout Carousel & Core Learning**:
   - Pastikan login page bersih tanpa carousel tryout, dan carousel muncul di Dashboard setelah login.
   - Uji Latsol (hanya soal `approved` & `is_published = 1` yang muncul) dan Try Out (`question_snapshots_json` tetap utuh meski soal diedit setelah sesi selesai).
3. **Profile, Study Time & Public Privacy**:
   - Buka Profil -> tambah/edit/hapus log waktu belajar pada section **Progress Waktu Belajar**, pastikan grafik Harian/Mingguan/Bulanan dan **Indikator Pemahaman Subtest** tetap terpisah.
   - Buka Leaderboard -> klik salah satu nama/avatar -> pastikan modal Profil Publik menampilkan/menyembunyikan metrik sesuai 5 switch privasi user tersebut.
4. **Admin & Super Admin Console**:
   - Uji **Input Soal Manual** -> pastikan masuk antrean `pending_review` dan baru muncul di Latsol setelah disetujui via checklist QC di **Review & Audit Soal**.
   - Uji **Crop Gambar** (zoom + preview canvas) dan **Riwayat Versi** (diff Before/After + restore).
   - Login sebagai Super Admin -> buka **AI Providers** -> cek mask key (`••••`), uji **Test Koneksi**, dan pastikan fallback provider berfungsi jika primary gagal sementara.

---

## 6. Panduan Rollback

1. Hentikan instance baru dan kembalikan traffic ke revisi container/tag sebelumnya.
2. Karena seluruh migrasi skema bersifat additive (`ALTER TABLE ... ADD COLUMN` & tabel baru seperti `study_time_logs`, `question_versions`, `ai_provider_configs`, `ai_request_logs`), database SQLite yang sudah bermigrasi tetap kompatibel bila perlu downgrade sementara, namun **selalu cadangkan `data/utbk.db`** sebelum melakukan deployment besar:
   ```bash
   cp data/utbk.db data/utbk.db.bak-$(date +%Y%m%d-%H%M%S)
   ```
