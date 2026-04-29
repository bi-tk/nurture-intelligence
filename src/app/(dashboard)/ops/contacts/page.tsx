import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { formatNumber } from '@/lib/utils'
import { bqQuery, t, isConfigured } from '@/lib/bigquery'
import ContactProspectTable from '@/components/tables/ContactProspectTable'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

async function getContactsData() {
  try {
    if (!isConfigured()) return null

    const rows = await bqQuery<ProspectRow>(`
      SELECT
        p.id,
        p.email,
        p.first_name,
        p.last_name,
        p.job_title,
        COALESCE(p.score, 0)                   AS score,
        COALESCE(p.grade, '')                  AS grade,
        COALESCE(p.last_activity_at, '')       AS last_activity_at,
        COALESCE(p.pardot_segments, '')        AS pardot_segments,
        COALESCE(p.pardot_nurture_step, '')    AS pardot_nurture_step,
        COALESCE(l.Normalize_Title_del__c, '') AS normalized_title
      FROM ${t('pardot_prospects')} p
      LEFT JOIN ${t('Leads')} l
        ON LOWER(p.email) = LOWER(l.Email)
        AND (l.OQL__c = TRUE)
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
      if (score < 0) { buckets.suppression++; continue }
      if (score >= 100 || days <= 7) { buckets.hot++; continue }
      if (score >= 50 || days <= 30) { buckets.warm++; continue }
      if (score >= 10 || days <= 90) { buckets.cold++; continue }
      if (score >= 1 && score < 10) { buckets.recycle++; continue }
      buckets.inactive++
    }

    const prospects = rows.slice(0, 50).map((p, i) => {
      const score = Number(p.score ?? 0)
      return {
        id: i + 1,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || `Prospect ${p.id}`,
        title: p.job_title || '—',
        score,
        grade: p.grade || '—',
        status: score >= 150 ? 'Engaged' : score >= 75 ? 'Warm' : score >= 25 ? 'Low Click' : 'Dark',
        lastActivity: p.last_activity_at || null,
        segment: p.pardot_segments || '—',
        nurtureStep: p.pardot_nurture_step || '—',
        normalizedTitle: p.normalized_title || '—',
      }
    })

    return { buckets, prospects, total: 6421, connected: true }
  } catch (e) {
    console.error('contacts error:', e)
    return null
  }
}

const bucketConfig = [
  {
    key: 'hot',
    label: 'Hot',
    description: 'Highly engaged, ready for sales action',
    color: 'text-accent-red',
    bg: 'bg-accent-red/10 border-accent-red/20',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z',
  },
  {
    key: 'warm',
    label: 'Warm',
    description: 'Moderate engagement, nurture active',
    color: 'text-accent-yellow',
    bg: 'bg-accent-yellow/10 border-accent-yellow/20',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  },
  {
    key: 'cold',
    label: 'Cold',
    description: 'Low recent engagement',
    color: 'text-pulse-300',
    bg: 'bg-pulse-blue/8 border-pulse-blue/15',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  },
  {
    key: 'inactive',
    label: 'Inactive',
    description: 'No activity in defined window',
    color: 'text-white/30',
    bg: 'bg-graphite-700 border-white/5',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2zm0 8h2v2h-2z',
  },
  {
    key: 'suppression',
    label: 'Suppression Candidates',
    description: 'Bounced, unsubbed, or chronic non-responders',
    color: 'text-accent-red',
    bg: 'bg-accent-red/5 border-accent-red/10',
    icon: 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z',
  },
  {
    key: 'recycle',
    label: 'Recycle Candidates',
    description: 'Aged contacts eligible for re-engagement',
    color: 'text-accent-green',
    bg: 'bg-accent-green/8 border-accent-green/15',
    icon: 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
  },
] as const

export default async function ContactsPage() {
  const session = await auth()
  const data = await getContactsData()
  const isLive = !!data?.connected
  const buckets: Record<string, number> = data?.buckets ?? { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }
  const prospectRows = data?.prospects ?? []

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Contact Intelligence"
        subtitle={isLive ? 'Live BigQuery Data' : 'Audience health, engagement buckets, suppression and recycle candidates'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — configure <code>BQ_PROJECT_ID</code> and <code>BQ_DATASET_ID</code> to see contact intelligence.</p>
          </div>
        )}

        {/* Bucket cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {bucketConfig.map((b) => (
            <div key={b.key} className={`rounded-xl border p-5 ${b.bg}`}>
              <div className="flex items-start justify-between mb-3">
                <p className={`text-xs font-mono uppercase tracking-widest ${b.color}`}>{b.label}</p>
                <svg className={`w-4 h-4 ${b.color} opacity-60`} viewBox="0 0 24 24" fill="currentColor">
                  <path d={b.icon} />
                </svg>
              </div>
              <p className="text-white font-bold text-3xl mb-1">{formatNumber(buckets[b.key] ?? 0)}</p>
              <p className="text-white/30 text-xs">{b.description}</p>
            </div>
          ))}
        </div>

        {/* Notice */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl p-5 flex gap-4 items-start">
          <svg className="w-5 h-5 text-pulse-blue shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <div>
            <p className="text-white text-sm font-medium mb-1">Phase 0 Required for Contact Scoring</p>
            <p className="text-white/40 text-sm leading-relaxed">
              Contact buckets are currently based on preliminary rules. Once Phase 0 discovery is complete and field definitions (engaged contact, inactivity window) are admin-approved, scoring will update automatically with confirmed logic.
            </p>
          </div>
        </div>

        {/* Prospect Activity */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Prospect Activity</p>
          <ContactProspectTable rows={prospectRows} />
        </div>
      </div>
    </div>
  )
}
