// BigQuery client — replaces direct Salesforce & Pardot API calls.
// Set BQ_PROJECT_ID, BQ_DATASET_ID in env.
// Auth: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file path,
//       or set BQ_CREDENTIALS_JSON to the key file content as a JSON string.
//
// Email activity type_names from Pardot_userActivity:
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
// Pardot v4 visitor-activity type numbers (source: Pardot v4 API docs):
//   6=Sent, 11=Open, 12=Unsubscribe_Open, 13=Bounce, 14=Spam_Complaint,
//   17=Third_Party_Click, 35=Indirect_Unsubscribe_Open, 36=Indirect_Bounce
//   1=Click with type_name='Email Tracker' (email link clicks)

// Boolean condition strings — use inside COUNTIF() or IF()
export const IS_EMAIL_SENT   = `type = 6`
export const IS_EMAIL_OPEN   = `type = 11`
export const IS_EMAIL_CLICK  = `(type = 1 AND type_name = 'Email Tracker') OR type = 17`
export const IS_EMAIL_BOUNCE = `type IN (13, 36)`
export const IS_EMAIL_UNSUB  = `type IN (12, 35)`
export const IS_EMAIL_SPAM   = `type = 14`

export const EMAIL_SENT_EXPR = `COUNTIF(${IS_EMAIL_SENT})`.trim()

export const EMAIL_OPEN_EXPR = `COUNTIF(${IS_EMAIL_OPEN})`
export const EMAIL_CLICK_EXPR = `COUNTIF(${IS_EMAIL_CLICK})`
export const EMAIL_BOUNCE_EXPR = `COUNTIF(${IS_EMAIL_BOUNCE})`
export const EMAIL_UNSUB_EXPR = `COUNTIF(${IS_EMAIL_UNSUB})`
export const EMAIL_SPAM_EXPR = `COUNTIF(${IS_EMAIL_SPAM})`

// ─── Campaign filter helpers ───────────────────────────────────────────────────

function sqlList(values: string[]): string {
  return values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')
}

// AND/WHERE fragment to filter Pardot_userActivity rows by campaign_name
export function campaignSqlFilter(campaigns: string[], prefix = 'AND'): string {
  if (campaigns.length === 0) return ''
  if (campaigns.length === 1) return `${prefix} campaign_name = '${campaigns[0].replace(/'/g, "''")}'`
  return `${prefix} campaign_name IN (${sqlList(campaigns)})`
}

// Date interval filter.
// dateRange examples: '7d', '30d', '90d' — or a custom range 'YYYY-MM-DD_YYYY-MM-DD'
export function dateIntervalFilter(dateRange: string, column: string, prefix = 'AND'): string {
  if (dateRange.includes('_')) {
    const [from, to] = dateRange.split('_')
    if (!from || !to) return ''
    return `${prefix} ${column} >= TIMESTAMP('${from}') AND ${column} <= TIMESTAMP('${to} 23:59:59')`
  }
  const days = parseInt(dateRange, 10)
  if (!days || days <= 0) return ''
  return `${prefix} ${column} >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)`
}

// AND fragment to filter Pardot_Prospects by segment code stored in pardot_segments column.
// pardot_segments is comma-separated; matches if any element equals the given code.
export function pardotSegmentFilter(segment: string): string {
  if (!segment) return ''
  const safe = segment.replace(/'/g, "''")
  return `AND EXISTS (
    SELECT 1 FROM UNNEST(SPLIT(pardot_segments, ',')) AS _seg
    WHERE TRIM(_seg) = '${safe}'
  )`
}

// AND fragment applied to Leads_Opp_Joined: scopes to prospects who submitted a Pardot
// form in the given campaigns. Excludes internal/test emails.
// When campaigns is empty, no campaign_name filter is applied.
export function leadsCampaignFilter(campaigns: string[], segment = ''): string {
  const campaignClause = campaignSqlFilter(campaigns)
  const segmentClause = pardotSegmentFilter(segment)
  return `AND Email IN (
    SELECT DISTINCT email
    FROM ${t('Pardot_Prospects')}
    WHERE NOT REGEXP_CONTAINS(LOWER(email), r'test|tkxel|work|uzair|sami')
      ${segmentClause}
      AND id IN (
        SELECT DISTINCT prospect_id
        FROM ${t('Pardot_userActivity')}
        WHERE type = 4
          AND type_name IN ('Form', 'Form Handler')
          ${campaignClause}
      )
  )`
}

// Standalone COUNT DISTINCT query for MQL: distinct emails that submitted a Pardot form.
// dateRange: '7d', '30d', etc. — filters by form submission date (created_at).
export function mqlCountSql(campaigns: string[], dateRange = '', segment = ''): string {
  const campaignClause = campaignSqlFilter(campaigns)
  const dateClause = dateIntervalFilter(dateRange, 'TIMESTAMP(created_at)')
  const segmentClause = pardotSegmentFilter(segment)
  return `
    SELECT COUNT(DISTINCT email) AS n
    FROM ${t('Pardot_Prospects')}
    WHERE NOT REGEXP_CONTAINS(LOWER(email), r'test|tkxel|work|uzair|sami')
      ${segmentClause}
      AND id IN (
        SELECT DISTINCT prospect_id
        FROM ${t('Pardot_userActivity')}
        WHERE type = 4
          AND type_name IN ('Form', 'Form Handler')
          ${campaignClause}
          ${dateClause}
      )
  `
}
