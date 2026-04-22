import { NextResponse } from 'next/server'
import { getPardotCreds, pardotGet } from '@/lib/sf-api'

const TOTAL_NURTURE_AUDIENCE = 6421

interface Prospect {
  id?: number
  email?: string
  firstName?: string
  lastName?: string
  jobTitle?: string
  score?: number
  grade?: string
  lastActivityAt?: string
  emailBounced?: boolean
  isDoNotEmail?: boolean
}

interface PardotProspectList {
  values?: Prospect[]
}

function bucket(p: Prospect): string {
  if (p.emailBounced === true || p.isDoNotEmail === true) return 'suppression'

  const now = Date.now()
  const last = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : null
  const daysSince = last != null ? (now - last) / (1000 * 60 * 60 * 24) : Infinity

  if (daysSince <= 7) return 'hot'
  if (daysSince <= 30) return 'warm'
  if (daysSince <= 90) return 'cold'
  return 'inactive'
}

function status(p: Prospect): string {
  if (p.emailBounced) return 'Bounced'
  if (p.isDoNotEmail) return 'Unsub'
  const score = p.score ?? 0
  if (score >= 150) return 'Engaged'
  if (score >= 75) return 'Warm'
  if (score >= 25) return 'Low Click'
  return 'Dark'
}

export async function GET() {
  const pardotCreds = await getPardotCreds()
  if (!pardotCreds) {
    return NextResponse.json({ buckets: null, prospects: [], connected: false })
  }

  const data = await pardotGet<PardotProspectList>(
    pardotCreds,
    'prospects?fields=id,email,firstName,lastName,jobTitle,score,grade,lastActivityAt,emailBounced,isDoNotEmail&limit=200'
  )

  const prospects = data?.values ?? []

  const buckets = { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }
  for (const p of prospects) {
    const b = bucket(p)
    if (b in buckets) buckets[b as keyof typeof buckets]++
  }

  buckets.recycle = prospects.filter(p => {
    const b = bucket(p)
    return (b === 'cold' || b === 'inactive') && (p.score ?? 0) > 0
  }).length

  const prospectDetail = [...prospects]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 50)
    .map((p, i) => ({
      id: i + 1,
      name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Prospect ${p.id}`,
      title: p.jobTitle ?? '—',
      score: p.score ?? 0,
      grade: p.grade ?? '—',
      status: status(p),
      lastActivity: p.lastActivityAt ?? null,
    }))

  return NextResponse.json({
    buckets,
    prospects: prospectDetail,
    total: TOTAL_NURTURE_AUDIENCE,
    connected: true,
  })
}
