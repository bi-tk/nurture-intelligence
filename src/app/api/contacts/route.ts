import { NextResponse } from 'next/server'
import { bqQuery, t, isConfigured } from '@/lib/bigquery'

const TOTAL_NURTURE_AUDIENCE = 6421

interface ProspectRow {
  id: number
  email: string
  first_name: string
  last_name: string
  job_title: string
  score: number
  grade: string
  last_activity_at: string
  pardot_segments: string
  pardot_nurture_step: string
  normalized_title: string
}

function bucket(score: number, daysSince: number): string {
  if (score < 0) return 'suppression'
  if (score >= 100 || daysSince <= 7) return 'hot'
  if (score >= 50 || daysSince <= 30) return 'warm'
  if (score >= 10 || daysSince <= 90) return 'cold'
  if (score >= 1 && score < 10) return 'recycle'
  return 'inactive'
}

function status(score: number): string {
  if (score >= 150) return 'Engaged'
  if (score >= 75) return 'Warm'
  if (score >= 25) return 'Low Click'
  return 'Dark'
}

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ buckets: null, prospects: [], connected: false })
  }

  // Join pardot_prospects with Leads on email to get segment/nurture/title info
  const rows = await bqQuery<ProspectRow>(`
    SELECT
      p.id,
      p.email,
      p.first_name,
      p.last_name,
      p.job_title,
      COALESCE(p.score, 0)                  AS score,
      COALESCE(p.grade, '')                 AS grade,
      COALESCE(p.last_activity_at, '')      AS last_activity_at,
      COALESCE(p.pardot_segments, '')       AS pardot_segments,
      COALESCE(p.pardot_nurture_step, '')   AS pardot_nurture_step,
      COALESCE(l.Normalize_Title_del__c, '') AS normalized_title
    FROM ${t('pardot_prospects')} p
    LEFT JOIN ${t('Leads')} l
      ON LOWER(p.email) = LOWER(l.Email)
      AND (l.MQL_Response__c = TRUE OR l.SQL__c = TRUE)
    ORDER BY score DESC
    LIMIT 500
  `)

  const now = Date.now()
  const DAY = 86400000
  const buckets = { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }

  for (const p of rows) {
    const score = Number(p.score ?? 0)
    const lastMs = p.last_activity_at ? new Date(p.last_activity_at).getTime() : null
    const days = lastMs != null && !isNaN(lastMs) ? (now - lastMs) / DAY : 999
    const b = bucket(score, days)
    if (b in buckets) buckets[b as keyof typeof buckets]++
  }

  const prospects = rows.slice(0, 50).map((p, i) => {
    const score = Number(p.score ?? 0)
    const lastMs = p.last_activity_at ? new Date(p.last_activity_at).getTime() : null
    const days = lastMs != null && !isNaN(lastMs) ? (now - lastMs) / DAY : 999
    return {
      id: i + 1,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || `Prospect ${p.id}`,
      title: p.job_title || '—',
      score,
      grade: p.grade || '—',
      status: status(score),
      lastActivity: p.last_activity_at || null,
      segment: p.pardot_segments || '—',
      nurtureStep: p.pardot_nurture_step || '—',
      normalizedTitle: p.normalized_title || '—',
    }
  })

  return NextResponse.json({
    buckets, prospects, total: TOTAL_NURTURE_AUDIENCE, connected: true,
  })
}
