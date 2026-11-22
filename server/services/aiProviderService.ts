import crypto from 'crypto';
import { GoogleGenAI, Schema } from '@google/genai';
import { db } from '../db';
import { isRetryableProviderError, parseAndRepairAiJson } from '../../src/lib/utbkLogic';
import type { AiProviderConfig, AiRequestLog } from '../../src/types';

export type ProviderKey = 'gemini' | 'openai';

export const PROVIDER_MODELS: Record<ProviderKey, string[]> = {
  gemini: ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-3.1-flash-lite'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
};

const MODEL_COST_PER_1M_USD: Record<string, { input: number; output: number }> = {
  'gemini-4-hydrogen': { input: 0.15, output: 0.6 },
  'gemini-4-neon': { input: 0.1, output: 0.4 },
  'gemini-4-carbon': { input: 1.25, output: 5.0 },
  'gemini-3.1-flash-lite': { input: 0.075, output: 0.3 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

function getEncryptionKey(): Buffer {
  const secret =
    process.env.AI_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    'ganesha-circle-dev-session-secret-key';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plainKey: string): string {
  const trimmed = plainKey.trim();
  if (!trimmed) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(payload: string): string {
  if (!payload || !payload.includes(':')) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) return '';
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const data = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function maskApiKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••' + trimmed.slice(-2);
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function getEnvApiKey(providerKey: ProviderKey): string {
  if (providerKey === 'gemini') {
    const k = (process.env.GEMINI_API_KEY || '').trim();
    return k && k !== 'MY_GEMINI_API_KEY' ? k : '';
  }
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return k && k !== 'MY_OPENAI_API_KEY' ? k : '';
}

function resolveEffectiveKey(row: Record<string, unknown>): {
  apiKey: string;
  keySource: 'database' | 'env' | 'none';
  maskedKey: string;
} {
  const providerKey = String(row.provider_key) as ProviderKey;
  const enc = String(row.encrypted_api_key || '');
  if (enc) {
    const dec = decryptApiKey(enc);
    if (dec) {
      return {
        apiKey: dec,
        keySource: 'database',
        maskedKey: String(row.key_hint || maskApiKey(dec)),
      };
    }
  }
  const envKey = getEnvApiKey(providerKey);
  if (envKey) {
    return {
      apiKey: envKey,
      keySource: 'env',
      maskedKey: maskApiKey(envKey),
    };
  }
  return { apiKey: '', keySource: 'none', maskedKey: '' };
}

export function estimateCostUsd(modelName: string, promptTokens: number, completionTokens: number): number {
  const rate = MODEL_COST_PER_1M_USD[modelName] || { input: 0.2, output: 0.8 };
  const cost = (promptTokens / 1_000_000) * rate.input + (completionTokens / 1_000_000) * rate.output;
  return Number(cost.toFixed(6));
}

export function listAiProviders(): AiProviderConfig[] {
  const rows = db
    .prepare('SELECT * FROM ai_providers ORDER BY is_primary DESC, provider_key ASC')
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const providerKey = String(r.provider_key) as ProviderKey;
    const keyInfo = resolveEffectiveKey(r);
    return {
      provider_key: providerKey,
      display_name: String(r.display_name || providerKey),
      is_enabled: Boolean(r.is_enabled),
      is_primary: Boolean(r.is_primary),
      is_fallback: Boolean(r.is_fallback),
      model_name: String(r.model_name || PROVIDER_MODELS[providerKey][0]),
      available_models: PROVIDER_MODELS[providerKey] || [],
      has_key: Boolean(keyInfo.apiKey),
      masked_key: keyInfo.maskedKey,
      key_source: keyInfo.keySource,
      last_status: (String(r.last_status || 'untested') as AiProviderConfig['last_status']),
      last_tested_at: r.last_tested_at ? String(r.last_tested_at) : null,
      last_error: String(r.last_error || ''),
      total_requests: Number(r.total_requests || 0),
      total_tokens: Number(r.total_tokens || 0),
      estimated_cost_usd: Number(r.estimated_cost_usd || 0),
      updated_at: String(r.updated_at || ''),
    };
  });
}

export function listRecentAiRequestLogs(limit: number = 30): AiRequestLog[] {
  const rows = db
    .prepare('SELECT * FROM ai_request_logs ORDER BY id DESC LIMIT ?')
    .all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    provider_key: String(r.provider_key),
    model_name: String(r.model_name),
    operation: String(r.operation),
    status: String(r.status) as AiRequestLog['status'],
    used_fallback: Boolean(r.used_fallback),
    duration_ms: Number(r.duration_ms || 0),
    prompt_tokens: Number(r.prompt_tokens || 0),
    completion_tokens: Number(r.completion_tokens || 0),
    total_tokens: Number(r.total_tokens || 0),
    estimated_cost_usd: Number(r.estimated_cost_usd || 0),
    error_message: String(r.error_message || ''),
    created_at: String(r.created_at),
  }));
}

function recordAiUsageLog(entry: {
  providerKey: ProviderKey;
  modelName: string;
  operation: string;
  status: 'success' | 'error' | 'repaired';
  usedFallback: boolean;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  errorMessage?: string;
}): void {
  const totalTokens = Math.max(0, entry.promptTokens + entry.completionTokens);
  const cost = estimateCostUsd(entry.modelName, entry.promptTokens, entry.completionTokens);
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO ai_request_logs
     (provider_key, model_name, operation, status, used_fallback, duration_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.providerKey,
    entry.modelName,
    entry.operation,
    entry.status,
    entry.usedFallback ? 1 : 0,
    Math.round(entry.durationMs),
    entry.promptTokens,
    entry.completionTokens,
    totalTokens,
    cost,
    (entry.errorMessage || '').slice(0, 500),
    nowIso
  );

  db.prepare(
    `UPDATE ai_providers
     SET total_requests = total_requests + 1,
         total_tokens = total_tokens + ?,
         estimated_cost_usd = ROUND(estimated_cost_usd + ?, 6),
         updated_at = ?
     WHERE provider_key = ?`
  ).run(totalTokens, cost, nowIso, entry.providerKey);
}

class ProviderInvokeError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function invokeGeminiRaw(params: {
  apiKey: string;
  model: string;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  responseSchema?: Schema;
  timeoutMs?: number;
}): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const ai = new GoogleGenAI({
    apiKey: params.apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: params.timeoutMs || 120_000,
    },
  });

  try {
    const response = await ai.models.generateContent({
      model: params.model,
      contents: [{ role: 'user', parts: params.parts }],
      config: {
        responseMimeType: 'application/json',
        ...(params.responseSchema ? { responseSchema: params.responseSchema } : {}),
      },
    });

    const usage = (response as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
      .usageMetadata;
    return {
      text: (response.text ?? '').trim(),
      promptTokens: Number(usage?.promptTokenCount || 0),
      completionTokens: Number(usage?.candidatesTokenCount || 0),
    };
  } catch (err) {
    const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    const msg = err instanceof Error ? err.message : 'Gemini request failed';
    throw new ProviderInvokeError(msg, status);
  }
}

async function invokeOpenAiRaw(params: {
  apiKey: string;
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'high' | 'low' | 'auto' } }>;
  }>;
  timeoutMs?: number;
}): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs || 120_000);

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        response_format: { type: 'json_object' },
        messages: params.messages,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    const bodyText = await resp.text();
    if (!resp.ok) {
      let errMsg = `OpenAI HTTP ${resp.status}`;
      try {
        const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
        if (parsed.error?.message) errMsg = parsed.error.message;
      } catch {
        // ignore
      }
      throw new ProviderInvokeError(errMsg, resp.status);
    }

    const json = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: String(json.choices?.[0]?.message?.content || '').trim(),
      promptTokens: Number(json.usage?.prompt_tokens || 0),
      completionTokens: Number(json.usage?.completion_tokens || 0),
    };
  } catch (err) {
    if (err instanceof ProviderInvokeError) throw err;
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'OpenAI request timeout'
        : err instanceof Error
        ? err.message
        : 'OpenAI network error';
    throw new ProviderInvokeError(msg, 504);
  } finally {
    clearTimeout(timer);
  }
}

export interface StructuredAiRequest {
  operation: string;
  geminiParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  openAiMessages: Array<{
    role: 'system' | 'user';
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'high' | 'low' | 'auto' } }>;
  }>;
  responseSchema?: Schema;
}

/**
 * Executes a structured JSON extraction call across configured AI providers:
 * 1. Tries enabled primary provider.
 * 2. Falls back to enabled secondary provider ONLY on retryable provider errors (timeout, 429, 5xx, network).
 * 3. Parses JSON cleanly with fence-stripping & repair, running up to 2 bounded repair attempts if output is malformed.
 */
export async function runStructuredAiExtraction<T>(
  req: StructuredAiRequest
): Promise<{
  data: T;
  providerKey: ProviderKey;
  modelName: string;
  usedFallback: boolean;
  repaired: boolean;
}> {
  const rows = db.prepare('SELECT * FROM ai_providers').all() as Array<Record<string, unknown>>;
  const providers = rows.map((r) => {
    const key = String(r.provider_key) as ProviderKey;
    const keyInfo = resolveEffectiveKey(r);
    return {
      key,
      isEnabled: Boolean(r.is_enabled),
      isPrimary: Boolean(r.is_primary),
      isFallback: Boolean(r.is_fallback),
      modelName: String(r.model_name || PROVIDER_MODELS[key][0]),
      apiKey: keyInfo.apiKey,
    };
  });

  const enabled = providers.filter((p) => p.isEnabled && p.apiKey);
  if (enabled.length === 0) {
    throw new Error(
      'Tidak ada AI Provider aktif dengan API key valid. Atur di Admin → AI Providers atau environment server.'
    );
  }

  const primary = enabled.find((p) => p.isPrimary) || enabled[0];
  const fallback =
    enabled.find((p) => p.key !== primary.key && p.isFallback) ||
    enabled.find((p) => p.key !== primary.key) ||
    null;

  const invokeOnce = async (
    prov: typeof primary,
    overrideRepairPrompt?: string
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> => {
    if (prov.key === 'gemini') {
      const parts = overrideRepairPrompt
        ? [{ text: overrideRepairPrompt }]
        : req.geminiParts;
      return invokeGeminiRaw({
        apiKey: prov.apiKey,
        model: prov.modelName,
        parts,
        responseSchema: req.responseSchema,
      });
    }
    const messages = overrideRepairPrompt
      ? [
          { role: 'system' as const, content: 'You fix malformed JSON into strict valid RFC 8259 JSON only.' },
          { role: 'user' as const, content: overrideRepairPrompt },
        ]
      : req.openAiMessages;
    return invokeOpenAiRaw({
      apiKey: prov.apiKey,
      model: prov.modelName,
      messages,
    });
  };

  let activeProvider = primary;
  let usedFallback = false;
  let rawResp: { text: string; promptTokens: number; completionTokens: number };
  const startedAt = Date.now();

  try {
    rawResp = await invokeOnce(primary);
  } catch (err) {
    const status = err instanceof ProviderInvokeError ? err.statusCode : undefined;
    const msg = err instanceof Error ? err.message : 'Provider gagal';
    recordAiUsageLog({
      providerKey: primary.key,
      modelName: primary.modelName,
      operation: req.operation,
      status: 'error',
      usedFallback: false,
      durationMs: Date.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      errorMessage: msg,
    });

    if (fallback && isRetryableProviderError(status, msg)) {
      activeProvider = fallback;
      usedFallback = true;
      const fbStart = Date.now();
      try {
        rawResp = await invokeOnce(fallback);
      } catch (fbErr) {
        const fbMsg = fbErr instanceof Error ? fbErr.message : 'Fallback provider gagal';
        recordAiUsageLog({
          providerKey: fallback.key,
          modelName: fallback.modelName,
          operation: req.operation,
          status: 'error',
          usedFallback: true,
          durationMs: Date.now() - fbStart,
          promptTokens: 0,
          completionTokens: 0,
          errorMessage: fbMsg,
        });
        throw new Error(`Primary (${primary.key}) dan Fallback (${fallback.key}) gagal: ${fbMsg}`);
      }
    } else {
      throw err;
    }
  }

  let parsed = parseAndRepairAiJson<T>(rawResp.text);
  let totalPrompt = rawResp.promptTokens;
  let totalCompletion = rawResp.completionTokens;
  let wasRepaired = parsed.ok ? parsed.repaired : false;

  // Bounded retry/repair loop (max 2 repair attempts) if JSON remained unparseable
  let lastRawText = rawResp.text;
  for (let attempt = 1; !parsed.ok && attempt <= 2; attempt++) {
    const repairPrompt = `Perbaiki JSON tidak valid di bawah ini agar menjadi SATU objek JSON RFC 8259 yang valid, lengkap, dan tanpa teks penjelasan atau markdown fence.

Kesalahan parser: ${parsed.ok ? '' : parsed.error}

Data mentah:
${lastRawText.slice(0, 28000)}`;
    const repairResp = await invokeOnce(activeProvider, repairPrompt);
    totalPrompt += repairResp.promptTokens;
    totalCompletion += repairResp.completionTokens;
    lastRawText = repairResp.text;
    parsed = parseAndRepairAiJson<T>(lastRawText);
    wasRepaired = true;
  }

  if (!parsed.ok) {
    recordAiUsageLog({
      providerKey: activeProvider.key,
      modelName: activeProvider.modelName,
      operation: req.operation,
      status: 'error',
      usedFallback,
      durationMs: Date.now() - startedAt,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      errorMessage: parsed.error,
    });
    throw new Error(parsed.error);
  }

  recordAiUsageLog({
    providerKey: activeProvider.key,
    modelName: activeProvider.modelName,
    operation: req.operation,
    status: wasRepaired ? 'repaired' : 'success',
    usedFallback,
    durationMs: Date.now() - startedAt,
    promptTokens: totalPrompt,
    completionTokens: totalCompletion,
  });

  return {
    data: parsed.data,
    providerKey: activeProvider.key,
    modelName: activeProvider.modelName,
    usedFallback,
    repaired: wasRepaired,
  };
}

export async function testAiProviderConnection(providerKey: ProviderKey): Promise<{
  ok: boolean;
  provider_key: ProviderKey;
  model_name: string;
  latency_ms: number;
  message: string;
}> {
  const row = db.prepare('SELECT * FROM ai_providers WHERE provider_key = ?').get(providerKey) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error('Provider tidak ditemukan.');
  }
  const keyInfo = resolveEffectiveKey(row);
  if (!keyInfo.apiKey) {
    const nowIso = new Date().toISOString();
    const errMsg = 'API key belum diatur untuk provider ini.';
    db.prepare('UPDATE ai_providers SET last_status = ?, last_tested_at = ?, last_error = ?, updated_at = ? WHERE provider_key = ?').run(
      'error',
      nowIso,
      errMsg,
      nowIso,
      providerKey
    );
    return {
      ok: false,
      provider_key: providerKey,
      model_name: String(row.model_name),
      latency_ms: 0,
      message: errMsg,
    };
  }

  const modelName = String(row.model_name || PROVIDER_MODELS[providerKey][0]);
  const startedAt = Date.now();
  try {
    if (providerKey === 'gemini') {
      const resp = await invokeGeminiRaw({
        apiKey: keyInfo.apiKey,
        model: modelName,
        parts: [{ text: 'Return exact JSON {"status":"ok"}' }],
        timeoutMs: 25_000,
      });
      const parsed = parseAndRepairAiJson<{ status?: string }>(resp.text);
      if (!parsed.ok) throw new Error(parsed.error);
    } else {
      const resp = await invokeOpenAiRaw({
        apiKey: keyInfo.apiKey,
        model: modelName,
        messages: [
          { role: 'system', content: 'Return JSON only.' },
          { role: 'user', content: 'Return exact JSON {"status":"ok"}' },
        ],
        timeoutMs: 25_000,
      });
      const parsed = parseAndRepairAiJson<{ status?: string }>(resp.text);
      if (!parsed.ok) throw new Error(parsed.error);
    }

    const latencyMs = Date.now() - startedAt;
    const nowIso = new Date().toISOString();
    db.prepare('UPDATE ai_providers SET last_status = ?, last_tested_at = ?, last_error = ?, updated_at = ? WHERE provider_key = ?').run(
      'ok',
      nowIso,
      '',
      nowIso,
      providerKey
    );
    return {
      ok: true,
      provider_key: providerKey,
      model_name: modelName,
      latency_ms: latencyMs,
      message: `Koneksi ${providerKey} (${modelName}) berhasil dalam ${latencyMs} ms.`,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const nowIso = new Date().toISOString();
    const msg = err instanceof Error ? err.message : 'Koneksi gagal';
    db.prepare('UPDATE ai_providers SET last_status = ?, last_tested_at = ?, last_error = ?, updated_at = ? WHERE provider_key = ?').run(
      'error',
      nowIso,
      msg.slice(0, 300),
      nowIso,
      providerKey
    );
    return {
      ok: false,
      provider_key: providerKey,
      model_name: modelName,
      latency_ms: latencyMs,
      message: msg,
    };
  }
}
