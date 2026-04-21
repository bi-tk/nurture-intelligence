import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { formatPercent, formatCurrency, formatNumber } from '@/lib/utils'
import { getPardotCreds, getSfCreds, pardotGet, sfQuery, pct } from '@/lib/sf-api'

interface PardotList {
  id?: number
  name?: string
  title?: string
  memberCount?: number
}

interface CampaignRecord {
  Type?: string
  Name?: string
  NumberOfLeads?: number
  NumberOfOpportunities?: number
  AmountAllOpportunities?: number
}

async function fetchSegmentData() {
  try {
    const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])
    if (!pardotCreds && !sfCreds) return null

    // Pardot lists as segments
    const listData = pardotCreds
      ? await pardotGet<{ values?: PardotList[] }>(pardotCreds, 'lists?fields=id,name,title,memberCount&limit=200')
      : null

    const lists = (listData?.values ?? [])
      .filter(l => (l.memberCount ?? 0) > 0)
      .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
      .slice(0, 20)
      .map(l => ({
        name: l.name ?? l.title ?? `List ${l.id}`,
        memberCount: l.memberCount ?? 0,
        openRate: 0,
        clickRate: 0,
        mqlRate: 0,
      }))

    // SF Campaign type breakdown
    const campResult = sfCreds
      ? await sfQuery<CampaignRecord>(
          sfCreds,
          'SELECT Type, Name, NumberOfLeads, NumberOfOpportunities, AmountAllOpportunities FROM Campaign WHERE IsActive = true ORDER BY NumberOfLeads DESC LIMIT 50'
        )
      : null

    const campaigns = (campResult?.records ?? []).map(c => ({
      name: c.Name ?? 'Unnamed',
      type: c.Type ?? 'Other',
      leads: c.NumberOfLeads ?? 0,
      opportunities: c.NumberOfOpportunities ?? 0,
      revenue: c.AmountAllOpportunities ?? 0,
    }))

    // Aggregate by type for industry view
    const byType: Record<string, { leads: number; revenue: number; count: number }> = {}
    for (const c of campaigns) {
      if (!byType[c.type]) byType[c.type] = { leads: 0, revenue: 0, count: 0 }
      byType[c.type].leads += c.leads
      byType[c.type].revenue += c.revenue
      byType[c.type].count++
    }
    const industries = Object.entries(byType)
      .map(([name, v]) => ({ name, mqls: v.leads, revenue: v.revenue }))
      .sort((a, b) => b.mqls - a.mqls)
      .slice(0, 10)

    if (!lists.length && !industries.length) return null

    return { segments: lists, industries, sfConnected: !!sfCreds, pardotConnected: !!pardotCreds }
  } catch { return null }
}

export default async function SegmentsPage() {
  const session = await auth()
  const live = await fetchSegmentData()
  const isLive = !!live

  const segments = live?.segments ?? []
  const industries = live?.industries ?? []

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Segments & Industries"
        subtitle={isLive ? 'Live Pardot & Salesforce Data' : 'Performance breakdown by audience segment and account industry'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — <a href="/admin/integrations" className="underline">connect Salesforce &amp; Pardot to see live segment performance</a>.</p>
          </div>
        )}

        {/* Segment Performance */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <p className="text-white font-medium">
              {isLive && live?.pardotConnected ? 'Pardot Lists' : 'Segment Performance'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['List Name', 'Members', 'Open Rate', 'Click Rate', 'MQL Rate', 'Action'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-white/25 text-xs font-mono uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {segments.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-white/30 text-sm">No data — connect Salesforce &amp; Pardot to see segment performance</td></tr>
                )}
                {segments.map((s) => (
                  <tr key={s.name} className="hover:bg-white/2">
                    <td className="px-5 py-3 text-white whitespace-nowrap max-w-[240px]"><p className="truncate">{s.name}</p></td>
                    <td className="px-5 py-3 font-mono text-white/70">{'memberCount' in s ? formatNumber((s as { memberCount: number }).memberCount) : '—'}</td>
                    <td className="px-5 py-3 font-mono text-white/70">{formatPercent(s.openRate ?? 0)}</td>
                    <td className="px-5 py-3 font-mono text-white/70">{formatPercent(s.clickRate ?? 0)}</td>
                    <td className="px-5 py-3 font-mono text-pulse-blue font-medium">{formatPercent(s.mqlRate ?? 0)}</td>
                    <td className="px-5 py-3"><ActionBadge action="Optimize" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Industry / Campaign Performance */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <p className="text-white font-medium">
              {isLive && live?.sfConnected ? 'Campaign Performance by Type' : 'Industry Performance'}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {['Industry / Type', 'MQLs / Leads', 'Won Revenue'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-white/25 text-xs font-mono uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {industries.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-white/30 text-sm">No data — connect Salesforce to see industry performance</td></tr>
              )}
              {industries.map((ind) => (
                <tr key={ind.name} className="hover:bg-white/2">
                  <td className="px-5 py-3 text-white">{ind.name}</td>
                  <td className="px-5 py-3 font-mono text-white/70">{formatNumber(ind.mqls)}</td>
                  <td className="px-5 py-3 font-mono text-accent-green">{ind.revenue ? formatCurrency(ind.revenue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, { background: string; color: string }> = {
    'Scale Up': { background: '#0f2a18', color: '#4ade80' },
    Optimize: { background: '#2a1a0a', color: '#fb923c' },
    Review: { background: '#0f1e38', color: '#38bdf8' },
    Rewrite: { background: '#2a0f0f', color: '#f87171' },
  }
  const s = styles[action] ?? styles.Review
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded-full whitespace-nowrap"
      style={s}
    >
      {action}
    </span>
  )
}
