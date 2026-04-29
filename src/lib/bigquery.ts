// BigQuery client — replaces direct Salesforce & Pardot API calls.
// Set BQ_PROJECT_ID, BQ_DATASET_ID in env.
// Auth: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file path,
//       or set BQ_CREDENTIALS_JSON to the key file content as a JSON string.
//
// Email activity type_names from pardot_userActivities:
//   If your Pardot instance uses different type_name values, update EMAIL_TYPES below.

import { BigQuery } from '@google-cloud/bigquery'

const PROJECT_ID = process.env.BQ_PROJECT_ID ?? ''
const DATASET_ID = process.env.BQ_DATASET_ID ?? ''

let _client: BigQuery | null = null

function getClient(): BigQuery {
  if (!_client) {
    const opts: ConstructorParameters<typeof BigQuery>[0] = { projectId: PROJECT_ID }
    if (process.env.BQ_CREDENTIALS_JSON) {
      try { opts.credentials = JSON.parse(process.env.BQ_CREDENTIALS_JSON) } catch {}
    }
    _client = new BigQuery(opts)
  }
  return _client
}

// Fully-qualified table reference: `project.dataset.table`
export function t(table: string): string {
  return `\`${PROJECT_ID}.${DATASET_ID}.${table}\``
}

export function isConfigured(): boolean {
  return !!(PROJECT_ID && DATASET_ID)
}

export async function bqQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!isConfigured()) return []
  try {
    const [rows] = await getClient().query({ query: sql })
    return rows as T[]
  } catch (err) {
    console.error('[BigQuery]', err)
    return []
  }
}

export async function bqCount(sql: string): Promise<number> {
  const rows = await bqQuery<{ n: bigint | number }>(sql)
  return Number(rows[0]?.n ?? 0)
}

export async function bqSum(sql: string): Promise<number> {
  const rows = await bqQuery<{ n: number | null }>(sql)
  return Number(rows[0]?.n ?? 0)
}

export function pct(numerator: number, denominator: number, decimals = 1): number {
  if (!denominator) return 0
  return parseFloat(((numerator / denominator) * 100).toFixed(decimals))
}

// ─── Email activity type helpers ──────────────────────────────────────────────
// These COUNTIF expressions match common Pardot v4 type_name values.
// Adjust the IN-lists if your instance uses different names.

// Boolean condition strings — use inside COUNTIF() or IF()
export const IS_EMAIL_SENT = `LOWER(type_name) IN ('email','sent email','send email','email sent','list email sent','mass email sent','email send')`
export const IS_EMAIL_OPEN = `LOWER(type_name) IN ('email open','email opened','view email','viewed email','email view','open email')`
export const IS_EMAIL_CLICK = `LOWER(type_name) IN ('email click','email clicked','click email','clicked email','email link click')`
export const IS_EMAIL_BOUNCE = `LOWER(type_name) IN ('email bounce','bounced email','hard bounce','soft bounce','email hard bounce','email soft bounce','bounce email')`
export const IS_EMAIL_UNSUB = `LOWER(type_name) IN ('email unsubscribe','email unsubscribed','unsubscribe email','opt out','email opt out')`
export const IS_EMAIL_SPAM = `LOWER(type_name) LIKE '%spam%'`

export const EMAIL_SENT_EXPR = `COUNTIF(${IS_EMAIL_SENT})`.trim()

export const EMAIL_OPEN_EXPR = `COUNTIF(${IS_EMAIL_OPEN})`
export const EMAIL_CLICK_EXPR = `COUNTIF(${IS_EMAIL_CLICK})`
export const EMAIL_BOUNCE_EXPR = `COUNTIF(${IS_EMAIL_BOUNCE})`
export const EMAIL_UNSUB_EXPR = `COUNTIF(${IS_EMAIL_UNSUB})`
export const EMAIL_SPAM_EXPR = `COUNTIF(${IS_EMAIL_SPAM})`
