import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import type { User, UserRole } from '../src/types';

const SESSION_COOKIE = 'utbk_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'ganesha-circle-dev-session-secret-key';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

function signPayload(payloadB64: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
}

export function createSessionToken(userId: number, tokenVersion: number = 0): string {
  const payload = JSON.stringify({ uid: userId, tv: tokenVersion, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined): { uid: number; tv: number } | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      uid?: number;
      tv?: number;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) return null;
    return { uid: parsed.uid, tv: Number(parsed.tv ?? 0) };
  } catch {
    return null;
  }
}

export function isSecureCookieContext(req?: Request): boolean {
  if (!req) return true;
  if (req.secure) return true;
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : String(protoHeader || ''))
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto === 'https') return true;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host.includes('.run.app') || host.includes('.ai.studio')) return true;
  return false;
}

function getSessionCookieOptions(req?: Request) {
  const secure = isSecureCookieContext(req);
  if (secure) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as const,
      partitioned: true,
      path: '/',
    };
  }
  return {
    httpOnly: true,
    secure: false,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookie(res: Response, userId: number, tokenVersion?: number, req?: Request): void {
  let tv = tokenVersion;
  if (tv == null) {
    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as
      | { token_version: number }
      | undefined;
    tv = Number(row?.token_version ?? 0);
  }
  const token = createSessionToken(userId, tv);
  res.cookie(SESSION_COOKIE, token, {
    ...getSessionCookieOptions(req || res.req),
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  res.clearCookie(SESSION_COOKIE, getSessionCookieOptions(req || res.req));
}

export function bumpUserTokenVersion(userId: number): void {
  db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(userId);
}

export function attachUser(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  const customHeader = typeof req.headers['x-ganesha-session'] === 'string' ? req.headers['x-ganesha-session'].trim() : '';
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const token = cookieToken || customHeader || bearerToken;
  const parsed = verifySessionToken(token);
  if (parsed) {
    const row = db
      .prepare(
        `SELECT id, discord_id, username, avatar_url, role, target_score, token_version,
                profile_visible, show_tryout_stats, show_study_time, show_subtest_mastery, show_target_score,
                joined_at, last_active_at
         FROM users WHERE id = ?`
      )
      .get(parsed.uid) as
      | (Omit<
          User,
          'profile_visible' | 'show_tryout_stats' | 'show_study_time' | 'show_subtest_mastery' | 'show_target_score'
        > & {
          token_version?: number;
          profile_visible?: number;
          show_tryout_stats?: number;
          show_study_time?: number;
          show_subtest_mastery?: number;
          show_target_score?: number;
        })
      | undefined;
    if (row && Number(row.token_version ?? 0) === parsed.tv) {
      const { token_version: _tv, ...rest } = row;
      req.user = {
        ...rest,
        profile_visible: row.profile_visible !== 0,
        show_tryout_stats: row.show_tryout_stats !== 0,
        show_study_time: Boolean(row.show_study_time),
        show_subtest_mastery: Boolean(row.show_subtest_mastery),
        show_target_score: Boolean(row.show_target_score),
      };
    } else if (cookieToken) {
      clearSessionCookie(res, req);
    }
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Silakan login dengan Discord terlebih dahulu.' });
    return;
  }
  next();
}

export function requireRole(allowed: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'Akses ditolak: peran Anda tidak memiliki kewenangan untuk aksi ini.' });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole(['super_admin', 'admin']);
export const requireSuperAdmin = requireRole(['super_admin']);

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip || 'local'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxRequests) {
      res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan tunggu sebentar.' });
      return;
    }
    bucket.count += 1;
    next();
  };
}

export function getTrimmedDiscordCredentials(): {
  clientId: string;
  clientSecret: string;
  guildId: string;
} {
  return {
    clientId: (process.env.DISCORD_CLIENT_ID || '').trim(),
    clientSecret: (process.env.DISCORD_CLIENT_SECRET || '').trim(),
    guildId: (process.env.DISCORD_GUILD_ID || '').trim(),
  };
}

export function isDiscordOAuthConfigured(): boolean {
  const { clientId, clientSecret } = getTrimmedDiscordCredentials();
  return Boolean(clientId && clientSecret);
}

/**
 * Embeds the exact redirectUri and expiration into HMAC-signed OAuth state
 * so `/auth/callback` always sends the exact matching redirect_uri to Discord /oauth2/token.
 */
export function buildOAuthState(redirectUri: string): string {
  const payload = JSON.stringify({
    nonce: crypto.randomBytes(12).toString('hex'),
    redirectUri,
    exp: Date.now() + 15 * 60 * 1000,
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyOAuthState(state: string | undefined): { valid: boolean; redirectUri?: string } {
  if (!state || !state.includes('.')) return { valid: false };
  const [payloadB64, sig] = state.split('.');
  if (!payloadB64 || !sig) return { valid: false };
  const expected = signPayload(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      redirectUri?: string;
      exp?: number;
    };
    if (!parsed.redirectUri || !parsed.exp || parsed.exp < Date.now()) {
      return { valid: false };
    }
    return { valid: true, redirectUri: parsed.redirectUri };
  } catch {
    return { valid: false };
  }
}

/**
 * Generates a short-lived (2-minute) HMAC-signed token so the OAuth popup
 * can hand off the session to the opener iframe, allowing the iframe to set its own
 * partitioned HttpOnly cookie via POST /api/auth/handoff.
 */
export function buildOAuthHandoffToken(userId: number, tokenVersion: number = 0): string {
  const payload = JSON.stringify({
    typ: 'oauth_handoff',
    uid: userId,
    tv: tokenVersion,
    exp: Date.now() + 2 * 60 * 1000,
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyOAuthHandoffToken(token: string | undefined): { uid: number; tv: number } | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = signPayload(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      typ?: string;
      uid?: number;
      tv?: number;
      exp?: number;
    };
    if (parsed.typ !== 'oauth_handoff' || !parsed.uid || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return { uid: parsed.uid, tv: Number(parsed.tv ?? 0) };
  } catch {
    return null;
  }
}
