import { NextResponse } from 'next/server'
import { getPardotCreds, pardotGet } from '@/lib/sf-api'
import { prisma } from '@/lib/prisma'

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
}

interface PardotProspectList {
  values?: Prospect[]
}

async function getDirectPardotCreds() {
  const [sfRec, pardotRec] = await Promise.all([
    prisma.integration.findUnique({ where: { platform: 'salesforce' } }),
    prisma.integration.findUnique({ where: { platform: 'pardot' } }),
  ])
  if (pardotRec?.status !== 'connected') return null
  const ps = pardotRec.settings as Record<string, string> | null
  const ss = sfRec?.settings as Record<string, string> | null
  const businessUnitId = ps?.businessUnitId
  const accessToken = ss?.accessToken
  if (!businessUnitId || !accessToken) return null
  return { accessToken, businessUnitId }
}

function bucket(p: Prospect): string {
  const score = p.score ?? 0
  if (score < 0) return 'suppression'

  const now = Date.now()
  const last = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : null
  const daysSince = last != null ? (now - last) / (1000 * 60 * 60 * 24) : Infinity

  if (score >= 100 || daysSince <= 7) return 'hot'
  if (score >= 50 || daysSince <= 30) return 'warm'
  if (score >= 10 || daysSince <= 90) return 'cold'
  return 'inactive'
}

function status(p: Prospect): string {
  const score = p.score ?? 0
  if (score >= 150) return 'Engaged'
  if (score >= 75) return 'Warm'
  if (score >= 25) return 'Low Click'
  return 'Dark'
}

export async function GET() {
  let pardotCreds = await getPardotCreds()
  if (!pardotCreds) pardotCreds = await getDirectPardotCreds()
  if (!pardotCreds) {
    return NextResponse.json({ buckets: null, prospects: [], connected: false })
  }

  const data = await pardotGet<PardotProspectList>(
    pardotCreds,
    'prospects?fields=id,email,firstName,lastName,jobTitle,score,grade,lastActivityAt&limit=500'
  )

  const prospects = data?.values ?? []

  const buckets = { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }
  for (const p of prospects) {
    const b = bucket(p)
    if (b in buckets) buckets[b as keyof typeof buckets]++
  }

  buckets.recycle = prospects.filter(p => {
    const score = p.score ?? 0
    return bucket(p) === 'inactive' && score >= 1 && score <= 9
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
