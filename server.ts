import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { db, initSchema, UPLOADS_DIR } from './server/db';
import { seedInitialData } from './server/seed';
import {
  attachUser,
  AuthenticatedRequest,
  buildOAuthHandoffToken,
  buildOAuthState,
  clearSessionCookie,
  createSessionToken,
  getTrimmedDiscordCredentials,
  isDiscordOAuthConfigured,
  rateLimit,
  setSessionCookie,
  verifyOAuthHandoffToken,
  verifyOAuthState,
} from './server/auth';
import { learningRouter } from './server/routes/learning';
import { adminRouter } from './server/routes/admin';
import {
  getTrustedOAuthOrigins,
  normalizeOriginUrl,
  rankLeaderboardEntries,
  resolveAllowedOAuthOrigin,
  resolveDiscordRedirectUri,
} from './src/lib/utbkLogic';

initSchema();
seedInitialData();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', true);
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  const reqOrigin = typeof req.headers.origin === 'string' ? normalizeOriginUrl(req.headers.origin) : null;
  if (reqOrigin) {
    const trustedOrigins = new Set(getTrustedOAuthOrigins(process.env.APP_URL, process.env.ALLOWED_OAUTH_ORIGINS));
    const parsed = new URL(reqOrigin);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (trustedOrigins.has(reqOrigin) || isLocal) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ganesha-Session, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(['/api/auth', '/auth'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(attachUser);

function getRequestOrigin(req: express.Request): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const rawProto = (Array.isArray(protoHeader) ? protoHeader[0] : String(protoHeader || req.protocol || 'http'))
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';

  const fwdHostHeader = req.headers['x-forwarded-host'];
  const rawHostHeader = fwdHostHeader || req.headers.host || `localhost:${PORT}`;
  const candidateHost = (Array.isArray(rawHostHeader) ? rawHostHeader[0] : String(rawHostHeader))
    .split(',')[0]
    .trim()
    .toLowerCase();

  // Strictly validate RFC host[:port] format to prevent Host header injection
  const safeHost = /^[a-z0-9.-]+(:\d{1,5})?$/.test(candidateHost) ? candidateHost : `localhost:${PORT}`;
  const isHttpsHost =
    safeHost.endsWith('.run.app') ||
    safeHost.includes('.run.app:') ||
    safeHost.endsWith('.ai.studio') ||
    safeHost.includes('.ai.studio:');
  const effectiveProto = isHttpsHost ? 'https' : proto;
  return normalizeOriginUrl(`${effectiveProto}://${safeHost}`) || `http://localhost:${PORT}`;
}

function getBaseAppUrl(req: express.Request): string {
  const reqOrigin = getRequestOrigin(req);
  return resolveAllowedOAuthOrigin(reqOrigin, reqOrigin, process.env.APP_URL, process.env.ALLOWED_OAUTH_ORIGINS);
}

// ==========================================
// PUBLIC BOOTSTRAP (Landing page, Carousel & Site Assets)
// ==========================================
app.get('/api/bootstrap', (_req, res) => {
  const settingsRows = db.prepare('SELECT key, value_json FROM system_settings').all() as Array<{
    key: string;
    value_json: string;
  }>;
  const settingsMap: Record<string, unknown> = {};
  for (const row of settingsRows) {
    try {
      settingsMap[row.key] = JSON.parse(row.value_json);
    } catch {
      settingsMap[row.key] = {};
    }
  }

  const siteAssetsRows = db.prepare('SELECT * FROM site_assets ORDER BY category ASC, slot_key ASC').all() as Array<
    Record<string, unknown>
  >;
  const visualAssetsFromTable: Record<string, string> = {};
  for (const row of siteAssetsRows) {
    visualAssetsFromTable[String(row.slot_key)] = String(row.desktop_url || '');
  }

  const carouselCards = (
    db
      .prepare('SELECT * FROM tryout_carousel_cards WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
      .all() as Array<Record<string, unknown>>
  ).map((c) => ({
    ...c,
    is_active: Boolean(c.is_active),
  }));

  const activeCountdown = db
    .prepare('SELECT id, title, target_iso, timezone, is_active FROM countdown_events WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    .get() as { id: number; title: string; target_iso: string; timezone: string; is_active: number } | undefined;

  const firstPkg = db.prepare('SELECT id, title FROM tryout_packages WHERE is_published = 1 ORDER BY id ASC LIMIT 1').get() as
    | { id: number; title: string }
    | undefined;

  let topRanks: Array<{ rank: number; username: string; utbkScore: number }> = [];
  if (firstPkg) {
    const rows = db
      .prepare(
        `SELECT ts.user_id, u.username, u.avatar_url, ts.utbk_score, ts.active_duration_seconds, ts.completed_at
         FROM tryout_sessions ts
         JOIN users u ON u.id = ts.user_id
         WHERE ts.package_id = ? AND ts.status = 'completed' AND ts.utbk_score IS NOT NULL`
      )
      .all(firstPkg.id) as Array<{
      user_id: number;
      username: string;
      avatar_url: string;
      utbk_score: number;
      active_duration_seconds: number;
      completed_at: string;
    }>;
    topRanks = rankLeaderboardEntries(
      rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        avatarUrl: r.avatar_url,
        utbkScore: r.utbk_score,
        activeDurationSeconds: r.active_duration_seconds,
        completedAt: r.completed_at,
      }))
    )
      .slice(0, 3)
      .map((r) => ({ rank: r.rank, username: r.username, utbkScore: r.utbkScore }));
  }

  res.json({
    serverNow: new Date().toISOString(),
    theme: settingsMap.theme || {
      primaryColor: '#0757B8',
      secondaryColor: '#0D4FA8',
      accentColor: '#D5BF50',
      quoteText: 'They got a head start. You’re getting a stronger finish',
      quoteAuthor: 'S',
    },
    visualAssets: {
      logo: '/src/assets/images/community_logo_1795075274111.jpg',
      landingBanner: '/src/assets/images/community_banner_1795075273360.jpg',
      catMascot: '/src/assets/images/landing_cat_mascot_1795075274052.jpg',
      countdownBanner: '/src/assets/images/community_banner_1795075273360.jpg',
      defaultPackageCover: '/src/assets/images/community_banner_1795075273360.jpg',
      libraryThumbnail: '/src/assets/images/community_logo_1795075274111.jpg',
      ...(typeof settingsMap.visual_assets === 'object' && settingsMap.visual_assets ? settingsMap.visual_assets : {}),
      ...visualAssetsFromTable,
    },
    siteAssets: siteAssetsRows,
    carouselCards,
    scoringConfig: settingsMap.scoring_config || {
      baseScore: 300,
      maxScore: 1000,
      wrongPenalty: 0,
      label: 'Skala Komunitas (300–1000)',
    },
    activeCountdown: activeCountdown ? { ...activeCountdown, is_active: Boolean(activeCountdown.is_active) } : null,
    topRanks,
    topRanksPackageTitle: firstPkg?.title || 'TO Sainsin #1 2027',
  });
});

// ==========================================
// DISCORD OAUTH2 & SESSION ENDPOINTS
// ==========================================
app.get('/api/auth/status', (req: AuthenticatedRequest, res) => {
  const discordConfigured = isDiscordOAuthConfigured();
  const { guildId } = getTrimmedDiscordCredentials();
  const previewAccounts = !discordConfigured
    ? db.prepare('SELECT id, discord_id, username, role, target_score FROM users ORDER BY id ASC').all()
    : [];

  const reqOrigin = getRequestOrigin(req);
  const primaryRedirectUri = resolveDiscordRedirectUri({
    requestedOrigin: reqOrigin,
    fallbackOrigin: reqOrigin,
    envAppUrl: process.env.APP_URL,
    extraOriginsRaw: process.env.ALLOWED_OAUTH_ORIGINS,
    explicitRedirectUri: process.env.DISCORD_REDIRECT_URI,
  });

  const derivedOrigins = getTrustedOAuthOrigins(process.env.APP_URL, process.env.ALLOWED_OAUTH_ORIGINS);
  const callbackUrls = Array.from(
    new Set([primaryRedirectUri, `${getBaseAppUrl(req)}/auth/callback`, ...derivedOrigins.map((o) => `${o}/auth/callback`)])
  );

  res.json({
    user: req.user || null,
    discordConfigured,
    guildCheckEnabled: Boolean(guildId),
    previewAccounts,
    callbackUrl: primaryRedirectUri,
    allCallbackUrls: callbackUrls,
  });
});

app.get('/api/auth/discord/url', rateLimit(30, 60_000), (req, res) => {
  if (!isDiscordOAuthConfigured()) {
    res.status(503).json({
      error: 'DISCORD_CLIENT_ID dan DISCORD_CLIENT_SECRET belum dikonfigurasi.',
    });
    return;
  }

  const { clientId } = getTrimmedDiscordCredentials();
  const reqOrigin = getRequestOrigin(req);
  const fallbackOrigin = getBaseAppUrl(req);
  const requestedOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
  const redirectUri = resolveDiscordRedirectUri({
    requestedOrigin: requestedOrigin || reqOrigin,
    fallbackOrigin,
    envAppUrl: process.env.APP_URL,
    extraOriginsRaw: process.env.ALLOWED_OAUTH_ORIGINS,
    explicitRedirectUri: process.env.DISCORD_REDIRECT_URI,
  });
  const state = buildOAuthState(redirectUri);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  res.json({
    url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    redirectUri,
    clientId,
  });
});

async function handleDiscordCallback(req: express.Request, res: express.Response): Promise<void> {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const oauthErr = String(req.query.error || '');
  const oauthErrDesc = String(req.query.error_description || '');
  const stateCheck = verifyOAuthState(state);

  const sendPopupError = (message: string) => {
    const safeMsg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const targetOrigin = stateCheck.valid && stateCheck.redirectUri ? new URL(stateCheck.redirectUri).origin : '*';
    res.status(403).send(`
      <!doctype html>
      <html>
        <body style="font-family:sans-serif;background:#101B45;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;text-align:center;">
          <div style="max-width:520px;">
            <h2>Otorisasi Discord Gagal</h2>
            <p style="line-height:1.5;">${safeMsg}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', message: ${JSON.stringify(message)} }, ${JSON.stringify(targetOrigin)});
              }
            </script>
          </div>
        </body>
      </html>
    `);
  };

  if (oauthErr) {
    sendPopupError(`Discord mengembalikan error "${oauthErr}": ${oauthErrDesc || 'Dibatalkan atau redirect_uri tidak terdaftar.'}`);
    return;
  }

  if (!code || !stateCheck.valid || !stateCheck.redirectUri) {
    sendPopupError('Parameter otorisasi Discord tidak valid atau kedaluwarsa. Silakan ulangi login.');
    return;
  }

  const { clientId, clientSecret, guildId } = getTrimmedDiscordCredentials();
  const redirectUri = stateCheck.redirectUri;
  const targetOrigin = new URL(redirectUri).origin;
  const allowedOrigin = resolveAllowedOAuthOrigin(
    targetOrigin,
    getRequestOrigin(req),
    process.env.APP_URL,
    process.env.ALLOWED_OAUTH_ORIGINS
  );
  if (!redirectUri.endsWith('/auth/callback') || targetOrigin !== allowedOrigin) {
    sendPopupError('Redirect URI OAuth2 tidak termasuk dalam daftar origin yang diizinkan.');
    return;
  }

  try {
    const tokenResp = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text().catch(() => '');
      const safeErrSummary = errBody.replace(/(access_token|refresh_token|client_secret)"?\s*:\s*"[^"]*"/gi, '$1":"[REDACTED]"').slice(0, 300);
      sendPopupError(
        `Gagal menukar kode otorisasi dengan Discord (redirect_uri: ${redirectUri}). Pastikan URL tersebut terdaftar persis pada Discord Developer Portal → OAuth2 → Redirects. Detail: ${safeErrSummary}`
      );
      return;
    }

    const tokenJson = (await tokenResp.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      sendPopupError('Access token Discord tidak ditemukan.');
      return;
    }

    const userResp = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResp.ok) {
      sendPopupError('Gagal mengambil profil pengguna Discord.');
      return;
    }
    const discordUser = (await userResp.json()) as {
      id: string;
      username: string;
      global_name?: string;
      avatar?: string;
    };

    if (guildId) {
      const guildsResp = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!guildsResp.ok) {
        sendPopupError('Gagal memverifikasi keanggotaan server Discord komunitas.');
        return;
      }
      const guilds = (await guildsResp.json()) as Array<{ id: string }>;
      const isMember = guilds.some((g) => g.id === guildId);
      if (!isMember) {
        sendPopupError('Akun Discord Anda belum terdaftar sebagai anggota server komunitas.');
        return;
      }
    }

    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : '';
    const displayName = discordUser.global_name || discordUser.username;
    const superAdminIds = (process.env.DISCORD_SUPER_ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const nowIso = new Date().toISOString();

    const existing = db.prepare('SELECT id, role, token_version FROM users WHERE discord_id = ?').get(discordUser.id) as
      | { id: number; role: string; token_version?: number }
      | undefined;

    let userId: number;
    let tokenVersion = 0;
    if (existing) {
      userId = existing.id;
      tokenVersion = Number(existing.token_version ?? 0);
      const roleToSet = superAdminIds.includes(discordUser.id) ? 'super_admin' : existing.role;
      db.prepare('UPDATE users SET username = ?, avatar_url = ?, role = ?, last_active_at = ? WHERE id = ?').run(
        displayName,
        avatarUrl,
        roleToSet,
        nowIso,
        userId
      );
    } else {
      const role = superAdminIds.includes(discordUser.id) ? 'super_admin' : 'user';
      userId = db
        .prepare(
          'INSERT INTO users (discord_id, username, avatar_url, role, target_score, joined_at, last_active_at) VALUES (?, ?, ?, ?, 760, ?, ?)'
        )
        .run(discordUser.id, displayName, avatarUrl, role, nowIso, nowIso).lastInsertRowid as number;
    }

    setSessionCookie(res, userId, tokenVersion, req);
    const handoffToken = buildOAuthHandoffToken(userId, tokenVersion);

    res.send(`
      <!doctype html>
      <html>
        <body style="font-family:sans-serif;background:#101B45;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <p>Login Discord berhasil. Menutup jendela...</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', handoffToken: ${JSON.stringify(handoffToken)} }, ${JSON.stringify(targetOrigin)});
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    sendPopupError(err instanceof Error ? err.message : 'Terjadi kesalahan saat verifikasi Discord.');
  }
}

app.get(['/auth/callback', '/auth/callback/'], handleDiscordCallback);

app.post('/api/auth/handoff', rateLimit(30, 60_000), (req, res) => {
  const handoffToken = typeof req.body?.handoffToken === 'string' ? req.body.handoffToken.trim() : '';
  const parsed = verifyOAuthHandoffToken(handoffToken);
  if (!parsed) {
    res.status(401).json({ error: 'Token sesi OAuth tidak valid atau kedaluwarsa. Silakan login ulang.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT id, discord_id, username, avatar_url, role, target_score, token_version,
              profile_visible, show_tryout_stats, show_study_time, show_subtest_mastery, show_target_score,
              joined_at, last_active_at
       FROM users WHERE id = ?`
    )
    .get(parsed.uid) as Record<string, unknown> | undefined;

  if (!row || Number(row.token_version ?? 0) !== parsed.tv) {
    res.status(401).json({ error: 'Sesi pengguna tidak lagi valid. Silakan login ulang.' });
    return;
  }

  setSessionCookie(res, Number(row.id), parsed.tv, req);
  const sessionToken = createSessionToken(Number(row.id), parsed.tv);
  const { token_version: _tv, ...safeRow } = row;
  res.json({
    user: {
      ...safeRow,
      profile_visible: row.profile_visible !== 0,
      show_tryout_stats: row.show_tryout_stats !== 0,
      show_study_time: Boolean(row.show_study_time),
      show_subtest_mastery: Boolean(row.show_subtest_mastery),
      show_target_score: Boolean(row.show_target_score),
    },
    sessionToken,
  });
});

app.post('/api/auth/preview-login', rateLimit(30, 60_000), (req, res) => {
  if (isDiscordOAuthConfigured()) {
    res.status(403).json({ error: 'Preview login dinonaktifkan karena Discord OAuth2 sudah aktif.' });
    return;
  }
  const discordId = String(req.body?.discord_id || '').trim();
  const user = db
    .prepare(
      `SELECT id, discord_id, username, avatar_url, role, target_score,
              profile_visible, show_tryout_stats, show_study_time, show_subtest_mastery, show_target_score,
              joined_at, last_active_at
       FROM users WHERE discord_id = ?`
    )
    .get(discordId) as Record<string, unknown> | undefined;
  if (!user) {
    res.status(404).json({ error: 'Akun komunitas tidak ditemukan.' });
    return;
  }
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(new Date().toISOString(), Number(user.id));
  setSessionCookie(res, Number(user.id), undefined, req);
  res.json({
    user: {
      ...user,
      profile_visible: user.profile_visible !== 0,
      show_tryout_stats: user.show_tryout_stats !== 0,
      show_study_time: Boolean(user.show_study_time),
      show_subtest_mastery: Boolean(user.show_subtest_mastery),
      show_target_score: Boolean(user.show_target_score),
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res, req);
  res.json({ loggedOut: true });
});

app.use('/api', learningRouter);
app.use('/api/admin', adminRouter);

// Never let /api/* fall through to HTML Vite/SPA catch-all or Express HTML error pages
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
});

app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file PDF terlalu besar (maksimal 32 MB per file).'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Jumlah file PDF melebihi batas maksimal upload (maks. 10 file).'
        : `Gagal mengunggah file: ${err.message}`;
    res.status(status).json({ error: msg });
    return;
  }
  const status =
    typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : err instanceof Error && /PDF/i.test(err.message)
      ? 400
      : 500;
  res.status(status).json({
    error: err instanceof Error ? err.message : 'Terjadi kesalahan internal pada server API.',
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
