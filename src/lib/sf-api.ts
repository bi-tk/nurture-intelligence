// Shared Salesforce REST API + Pardot API helpers
// Auto-refreshes the SF access token when it expires using stored username/password

import { prisma } from '@/lib/prisma'

const SF_API_VERSION = 'v59.0'

export interface SfCreds {
  accessToken: string
  instanceUrl: string
}

export interface PardotCreds {
  accessToken: string
  businessUnitId: string
}

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshSfToken(s: Record<string, string>): Promise<SfCreds | null> {
  if (!s.username || !s.passwordWithToken) return null
  try {
    const jsforce = await import('jsforce')
    const conn = new jsforce.default.Connection({
      loginUrl: (s.instanceUrl ?? 'https://login.salesforce.com').replace(/\/$/, ''),
    })
    await conn.login(s.username, s.passwordWithToken)
    const newToken = conn.accessToken
    const newInstanceUrl = conn.instanceUrl
    if (!newToken || !newInstanceUrl) return null

    // Persist the fresh token so next call doesn't re-login
    await prisma.integration.update({
      where: { platform: 'salesforce' },
      data: { settings: { ...s, accessToken: newToken, instanceUrl: newInstanceUrl } },
    })
    return { accessToken: newToken, instanceUrl: newInstanceUrl }
  } catch {
    return null
  }
}

// ─── Load credentials from DB ─────────────────────────────────────────────────

export async function getSfCreds(): Promise<SfCreds | null> {
  const integration = await prisma.integration.findUnique({ where: { platform: 'salesforce' } })
  if (integration?.status !== 'connected') return null
  const s = integration.settings as Record<string, string> | null
  if (!s) return null
  if (!s.accessToken || !s.instanceUrl) return null

  // Quick token health check (5s timeout)
  try {
    const checkRes = await fetch(
      `${s.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/Lead/describe`,
      {
        headers: { Authorization: `Bearer ${s.accessToken}` },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (checkRes.ok) return { accessToken: s.accessToken, instanceUrl: s.instanceUrl }
  } catch {
    // network error — fall through to refresh
  }

  // Token expired or invalid — re-login with stored credentials
  return refreshSfToken(s)
}

export async function getPardotCreds(): Promise<PardotCreds | null> {
  const [sf, pardot] = await Promise.all([
    prisma.integration.findUnique({ where: { platform: 'salesforce' } }),
    prisma.integration.findUnique({ where: { platform: 'pardot' } }),
  ])
  if (pardot?.status !== 'connected') return null

  const pardotSettings = pardot.settings as Record<string, string> | null
  const businessUnitId = pardotSettings?.businessUnitId
  if (!businessUnitId) return null

  // Try a fresh SF token first; fall back to the stored token if health check/refresh fails
  try {
    const freshSf = await getSfCreds()
    if (freshSf) return { accessToken: freshSf.accessToken, businessUnitId }
  } catch { /* fall through */ }

  const sfSettings = sf?.settings as Record<string, string> | null
  const storedToken = sfSettings?.accessToken
  if (!storedToken) return null

  return { accessToken: storedToken, businessUnitId }
}

// ─── Salesforce SOQL ──────────────────────────────────────────────────────────

export async function sfQuery<T = unknown>(
  creds: SfCreds,
  soql: string
): Promise<{ records: T[]; totalSize: number } | null> {
  try {
    const url = `${creds.instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    return await res.json() as { records: T[]; totalSize: number }
  } catch {
    return null
  }
}

export async function sfCount(creds: SfCreds, soql: string): Promise<number> {
  const result = await sfQuery<{ expr0: number }>(creds, soql)
  return result?.records?.[0]?.expr0 ?? 0
}

// ─── Pardot API v5 ────────────────────────────────────────────────────────────

export async function pardotGet<T = unknown>(
  creds: PardotCreds,
  path: string
): Promise<T | null> {
  try {
    const res = await fetch(`https://pi.pardot.com/api/v5/objects/${path}`, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Pardot-Business-Unit-Id': creds.businessUnitId,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

// ─── Pardot list-email stats ──────────────────────────────────────────────────

export interface PardotEmailStats {
  sent?: number
  delivered?: number
  opens?: number
  uniqueOpens?: number
  totalClicks?: number
  uniqueClicks?: number
  optOuts?: number
  hardBounced?: number
  softBounced?: number
  spamComplaints?: number
  deliveryRate?: number
  opensRate?: number
  clickThroughRate?: number
  optOutRate?: number
  listEmailId?: number
}

export async function pardotStats(
  creds: PardotCreds,
  listEmailId: number
): Promise<PardotEmailStats | null> {
  try {
    const res = await fetch(
      'https://pi.pardot.com/api/v5/objects/list-emails/' + listEmailId + '/stats',
      {
        headers: {
          Authorization: 'Bearer ' + creds.accessToken,
          'Pardot-Business-Unit-Id': creds.businessUnitId,
        },
      }
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function pct(numerator: number, denominator: number, decimals = 1): number {
  if (!denominator) return 0
  return parseFloat(((numerator / denominator) * 100).toFixed(decimals))
}
