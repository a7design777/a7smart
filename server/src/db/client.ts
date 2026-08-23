import { config } from '../config.js';

/**
 * Клієнт Cloudflare D1 через REST API.
 *
 * Застосунок — звичайний Node-процес на VPS, не Cloudflare Worker, тому
 * прямого біндингу env.DB немає. D1 доступний ззовні через
 *   POST https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query
 * з тілом {sql, params}. Офіційно задокументована атомарність
 * багатостейтментних операцій є лише для Workers Binding API
 * (env.DB.batch()); REST-виклик ззовні цього не гарантує — див.
 * sql.begin нижче.
 */

const BASE_URL = 'https://api.cloudflare.com/client/v4';

interface D1QueryResult {
  results: unknown[];
  success: boolean;
  meta?: unknown;
}

interface D1Response {
  success: boolean;
  result: D1QueryResult[];
  errors: Array<{ code: number; message: string }>;
}

async function d1Query(sqlText: string, params: unknown[] = []): Promise<unknown[]> {
  const url = `${BASE_URL}/accounts/${config.CF_ACCOUNT_ID}/d1/database/${config.CF_D1_DATABASE_ID}/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.CF_D1_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: sqlText, params }),
  });

  const body = (await res.json()) as D1Response;

  if (!res.ok || !body.success) {
    const messages = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
    throw new Error(`D1 запит не вдався: ${messages}\n  sql: ${sqlText}`);
  }

  // Один виклик /query може повертати кілька результатів, якщо sqlText
  // містив кілька `;`-розділених стейтментів (напр. міграція) — нас
  // цікавить лише останній.
  return body.result[body.result.length - 1]?.results ?? [];
}

/** Розкладає тегований шаблон на SQL-текст із `?`-плейсхолдерами та параметри. */
function template(strings: TemplateStringsArray, values: unknown[]): { text: string; params: unknown[] } {
  let text = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    text += `?${strings[i + 1] ?? ''}`;
  }
  return { text, params: values };
}

export interface Sql {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  /** Сирий SQL-текст із власним масивом `?`-параметрів (без тегованого шаблону). */
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<T>;
  unsafe: (text: string) => Promise<void>;
  begin: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
}

function makeSql(): Sql {
  const tag = (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> => {
    const { text, params } = template(strings, values);
    return (await d1Query(text, params)) as T;
  }) as Sql;

  tag.query = async <T>(text: string, params: unknown[] = []): Promise<T> =>
    (await d1Query(text, params)) as T;

  tag.unsafe = async (text: string) => {
    await d1Query(text);
  };

  /**
   * D1 REST API не дає справжніх транзакцій ззовні Workers. Тут `tx` —
   * той самий тег, що просто виконує кожен запит одразу, послідовно,
   * без відкату при помилці. Прийнятний компроміс для персонального
   * дашборда на 2-3 користувачів: усі місця виклику — 2-3 пов'язані
   * записи (головна квартира, порядок пристроїв, дії сценарію), а не
   * критичні для цілісності транзакції.
   */
  tag.begin = async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> => fn(tag);

  tag.end = async () => {};

  return tag;
}

export const sql = makeSql();

/**
 * Пакетний INSERT кількох рядків одним запитом — заміна хелпера
 * `postgres.js` `sql(rows, 'col1', 'col2', ...)`. Будує `(?,?,?),(?,?,?)`
 * і пласкі параметри; викликач підставляє `placeholders` у текст SQL і
 * виконує через `sql.query(text, params)` — не через тегований шаблон,
 * бо кількість `?` тут динамічна, а не одна на інтерпольоване значення.
 */
export function insertValues(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): { placeholders: string; params: unknown[] } {
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  const placeholders = rows.map(() => rowPlaceholder).join(', ');
  const params = rows.flatMap((row) => columns.map((col) => row[col]));
  return { placeholders, params };
}
