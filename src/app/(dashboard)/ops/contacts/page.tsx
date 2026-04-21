import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { formatNumber } from '@/lib/utils'
import { getPardotCreds, pardotGet } from '@/lib/sf-api'

interface PardotProspect {
  id?: number
  firstName?: string
  lastName?: string
  email?: string
  jobTitle?: string
  score?: number
  grade?: string
  lastActivityAt?: string
  optedOut?: boolean
  isBounced?: boolean
  emailsSent?: number
  emailsOpened?: number
  emailsClicked?: number
  emailsBounced?: number
  emailsUnsubscribed?: number
}

async function fetchContacts() {
  try {
    const creds = await getPardotCreds()
    if (!creds) return null

    const data = await pardotGet<{ values?: PardotProspect[] }>(
      creds,
      'prospects?fields=id,firstName,lastName,email,jobTitle,score,grade,lastActivityAt,optedOut,isBounced&limit=500'
    )

    const prospects = data?.values ?? []
    if (!prospects.length) return null

    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const ninetyDays = 90 * 24 * 60 * 60 * 1000
    const sixMonths = 180 * 24 * 60 * 60 * 1000

    const buckets = { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }

    const prospectDetails = prospects.map(p => {
      const score = p.score ?? 0
      const lastActivity = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : 0
      const daysSinceActivity = lastActivity ? (now - lastActivity) / (1000 * 60 * 60 * 24) : 999
      const isBounced = p.isBounced ?? false
      const isOptedOut = p.optedOut ?? false

      let status = 'Cold'
      if (isBounced || isOptedOut) {
        buckets.suppression++
        status = isBounced ? 'Bounced' : 'Unsub'
      } else if (daysSinceActivity > 180) {
        buckets.recycle++
        status = 'Dark'
      } else if (daysSinceActivity > 90) {
        buckets.inactive++
        status = 'Dark'
      } else if (score >= 60 || daysSinceActivity < 7) {
        buckets.hot++
        status = 'Engaged'
      } else if (score >= 30 || daysSinceActivity < 30) {
        buckets.warm++
        status = 'Low Click'
      } else {
        buckets.cold++
        status = 'Low Open'
      }

      return {
        id: p.id ?? 0,
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Prospect ${p.id}`,
        title: p.jobTitle ?? '—',
        delivered: 0,
        opens: 0,
        clicks: 0,
        bounces: isBounced ? 1 : 0,
        unsubs: isOptedOut ? 1 : 0,
        status,
      }
    })

    // Recycle = prospects inactive 6+ months
    const recycleProspects = prospects.filter(p => {
      const lastActivity = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : 0
      return lastActivity && (now - lastActivity) > sixMonths
    }).length
    buckets.recycle = recycleProspects

    const topProspects = prospectDetails
      .filter(p => p.status !== 'Bounced' && p.status !== 'Unsub')
      .slice(0, 50)

    return { buckets, prospects: topProspects }
  } catch { return null }
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
  const live = await fetchContacts()
  const isLive = !!live

  const buckets = (live?.buckets ?? { hot: 0, warm: 0, cold: 0, inactive: 0, suppression: 0, recycle: 0 }) as Record<string, number>
  const prospectRows = live?.prospects ?? []

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Contact Intelligence"
        subtitle={isLive ? 'Live Pardot Data' : 'Audience health, engagement buckets, suppression and recycle candidates'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — <a href="/admin/integrations" className="underline">connect Salesforce to see contact intelligence</a>.</p>
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
          <div className="rounded-xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-graphite-800 border-b border-white/5">
                    {['#', 'Name', 'Title', 'Delivered', 'Opens', 'Clicks', 'Bounce', 'Unsubs', 'Status'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-white/40 text-xs font-mono uppercase tracking-widest whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prospectRows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-white/30 text-sm">No data — connect Salesforce to see prospect activity</td></tr>
                  )}
                  {prospectRows.map((p) => (
                    <tr key={p.id} className="bg-graphite-800 border-t border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-white/40 font-mono text-xs">{p.id}</td>
                      <td className="px-4 py-3 text-white/80 font-medium whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-3 text-white/50 whitespace-nowrap">{p.title}</td>
                      <td className="px-4 py-3 text-white/70 font-mono">{p.delivered}</td>
                      <td className="px-4 py-3 text-white/70 font-mono">{p.opens}</td>
                      <td className="px-4 py-3 text-white/70 font-mono">{p.clicks}</td>
                      <td className="px-4 py-3 text-white/70 font-mono">{p.bounces}</td>
                      <td className="px-4 py-3 text-white/70 font-mono">{p.unsubs}</td>
                      <td className="px-4 py-3">
                        <ProspectStatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProspectStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { background: string; color: string }> = {
    Engaged: { background: '#0f2a18', color: '#4ade80' },
    'Low Open': { background: '#0f1e38', color: '#38bdf8' },
    'Low Click': { background: '#0f1e38', color: '#38bdf8' },
    Dark: { background: '#2a1a0a', color: '#fb923c' },
    Bounced: { background: '#2a0f0f', color: '#f87171' },
    Unsub: { background: '#2a0f0f', color: '#f87171' },
  }
  const s = styles[status] ?? { background: '#1a1a2a', color: '#c084fc' }
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded-full whitespace-nowrap"
      style={s}
    >
      {status}
    </span>
  )
}
