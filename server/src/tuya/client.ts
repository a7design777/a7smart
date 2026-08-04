import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * Мінімальний клієнт Tuya Cloud API без зовнішніх залежностей.
 *
 * Офіційний @tuya/tuya-connector-nodejs не оновлювався з квітня 2022
 * і тягне axios ^0.21 з відомими вразливостями. Уся його корисна робота —
 * підпис запитів і кешування токена — вміщується сюди, тому SDK не
 * використовується.
 *
 * Алгоритм підпису (Tuya v2.0):
 *   stringToSign = METHOD \n SHA256(body) \n <signature-headers> \n <path?sorted-query>
 *   str (токен)  = client_id + t + nonce + stringToSign
 *   str (решта)  = client_id + access_token + t + nonce + stringToSign
 *   sign         = HMAC-SHA256(str, secret) у ВЕРХНЬОМУ регістрі
 */

/** SHA256 порожнього тіла — константа з документації Tuya. */
const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface TuyaResponse<T> {
  success: boolean;
  result: T;
  code?: number;
  msg?: string;
  t?: number;
}

/**
 * Помилки авторизації/підписки. Їх треба відрізняти від решти: саме вони
 * означають, що скінчився термін дії IoT Core і система «померла» не через
 * баг, а через прострочену підписку на iot.tuya.com.
 */
const AUTH_ERROR_CODES = new Set([1004, 1010, 1011, 1013, 1106, 1114, 28841002]);

export class TuyaApiError extends Error {
  constructor(
    readonly code: number,
    readonly tuyaMessage: string,
    readonly path: string,
  ) {
    super(`Tuya ${path} → ${code}: ${tuyaMessage}`);
    this.name = 'TuyaApiError';
  }

  get isAuthProblem(): boolean {
    return AUTH_ERROR_CODES.has(this.code);
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmac(input: string): string {
  return createHmac('sha256', config.TUYA_SECRET_KEY).update(input, 'utf8').digest('hex').toUpperCase();
}

/** Path + відсортовані query-параметри, як вимагає алгоритм підпису. */
function buildUrl(path: string, query?: Record<string, string | number>): string {
  if (!query || Object.keys(query).length === 0) return path;
  const sorted = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return `${path}?${sorted}`;
}

function buildSign(opts: {
  method: string;
  url: string;
  bodyString: string;
  timestamp: string;
  accessToken?: string;
}): string {
  const contentSha = opts.bodyString ? sha256(opts.bodyString) : EMPTY_BODY_SHA256;
  // Signature-Headers не використовуємо, тому блок заголовків порожній,
  // але роздільник "\n" усе одно обов'язковий.
  const stringToSign = `${opts.method}\n${contentSha}\n\n${opts.url}`;
  const nonce = '';
  const str = `${config.TUYA_ACCESS_KEY}${opts.accessToken ?? ''}${opts.timestamp}${nonce}${stringToSign}`;
  return hmac(str);
}

interface TokenResult {
  access_token: string;
  refresh_token: string;
  expire_time: number; // секунди
  uid: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflightToken: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const path = '/v1.0/token';
  const url = buildUrl(path, { grant_type: 1 });
  const t = Date.now().toString();
  const sign = buildSign({ method: 'GET', url, bodyString: '', timestamp: t });

  const res = await fetch(`${config.TUYA_BASE_URL}${url}`, {
    method: 'GET',
    headers: {
      client_id: config.TUYA_ACCESS_KEY,
      sign,
      t,
      sign_method: 'HMAC-SHA256',
    },
  });

  const json = (await res.json()) as TuyaResponse<TokenResult>;
  if (!json.success) {
    throw new TuyaApiError(json.code ?? -1, json.msg ?? 'не вдалося отримати токен', path);
  }

  // Оновлюємо за 60 с до фактичного закінчення, щоб не ловити гонку.
  cachedToken = {
    value: json.result.access_token,
    expiresAt: Date.now() + (json.result.expire_time - 60) * 1000,
  };
  return cachedToken.value;
}

/** Токен із кешем. Паралельні виклики чекають на один запит, а не роблять N. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (inflightToken) return inflightToken;

  inflightToken = fetchToken().finally(() => {
    inflightToken = null;
  });
  return inflightToken;
}

export async function tuyaRequest<T>(opts: {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}): Promise<T> {
  const accessToken = await getAccessToken();
  const url = buildUrl(opts.path, opts.query);
  const bodyString = opts.body ? JSON.stringify(opts.body) : '';
  const t = Date.now().toString();

  const sign = buildSign({
    method: opts.method,
    url,
    bodyString,
    timestamp: t,
    accessToken,
  });

  const res = await fetch(`${config.TUYA_BASE_URL}${url}`, {
    method: opts.method,
    headers: {
      client_id: config.TUYA_ACCESS_KEY,
      access_token: accessToken,
      sign,
      t,
      sign_method: 'HMAC-SHA256',
      ...(bodyString ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(bodyString ? { body: bodyString } : {}),
  });

  const json = (await res.json()) as TuyaResponse<T>;

  if (!json.success) {
    const error = new TuyaApiError(json.code ?? -1, json.msg ?? 'невідома помилка', opts.path);
    // Протермінований токен скидаємо, щоб наступний виклик узяв свіжий.
    if (error.isAuthProblem) cachedToken = null;
    throw error;
  }

  return json.result;
}
