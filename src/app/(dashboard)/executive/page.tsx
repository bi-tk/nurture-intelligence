import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/ui/KpiCard'
import FunnelChart from '@/components/charts/FunnelChart'
import TrendChart from '@/components/charts/TrendChart'
import DualTrendChart from '@/components/charts/DualTrendChart'
import { formatNumber, formatCurrency, formatPercent } from '@/lib/utils'
import { getSfCreds, getPardotCreds, sfQuery, sfCount, pardotGet, pct } from '@/lib/sf-api'

// ─── Fetch real data server-side ──────────────────────────────────────────────

async function fetchKpis() {
  try {
    const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])
    if (!sfCreds && !pardotCreds) return null

    const [mqlCount, sqlCount, discoveryCount, wonAgg, pipelineAgg, newOpps] = await Promise.all([
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Non_MQL_Date__c != null') : 0,
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Not_Accepted__c = false') : 0,
      sfCreds ? sfCount(sfCreds, "SELECT COUNT() FROM Task WHERE CallType != null AND Status = 'Completed'") : 0,
      sfCreds ? sfQuery<{expr0:number}>(sfCreds, "SELECT SUM(Amount) FROM Opportunity WHERE StageName = 'Closed Won'") : null,
      sfCreds ? sfQuery<{expr0:number}>(sfCreds, 'SELECT SUM(Amount) FROM Opportunity WHERE IsClosed = false') : null,
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Opportunity WHERE CreatedDate = THIS_MONTH') : 0,
    ])

    const wonRevenue = wonAgg?.records?.[0]?.expr0 ?? 0
    const pipelineValue = pipelineAgg?.records?.[0]?.expr0 ?? 0

    type EmailRow = { totalSentCount?:number; deliveredCount?:number; uniqueOpenCount?:number; uniqueClickCount?:number; hardBounceCount?:number; softBounceCount?:number; optOutCount?:number; spamComplaintCount?:number }
    const emailStats = pardotCreds ? await pardotGet<{values?: EmailRow[]}>(pardotCreds, 'emails?fields=totalSentCount,deliveredCount,uniqueOpenCount,uniqueClickCount,hardBounceCount,softBounceCount,optOutCount,spamComplaintCount&limit=200') : null
    const emails = emailStats?.values ?? []
    const totalSent = emails.reduce((s,e) => s+(e.totalSentCount??0),0)
    const totalDelivered = emails.reduce((s,e) => s+(e.deliveredCount??0),0)
    const totalUniqueOpens = emails.reduce((s,e) => s+(e.uniqueOpenCount??0),0)
    const totalUniqueClicks = emails.reduce((s,e) => s+(e.uniqueClickCount??0),0)
    const totalBounces = emails.reduce((s,e) => s+(e.hardBounceCount??0)+(e.softBounceCount??0),0)
    const totalUnsubs = emails.reduce((s,e) => s+(e.optOutCount??0),0)
    const totalSpam = emails.reduce((s,e) => s+(e.spamComplaintCount??0),0)

    type ProspectRow = { score?:number; lastActivityAt?:string }
    const prospects = pardotCreds ? await pardotGet<{values?: ProspectRow[]}>(pardotCreds, 'prospects?fields=id,score,lastActivityAt&limit=500') : null
    const prospectList = prospects?.values ?? []
    const now = Date.now()
    const thirtyDays = 30*24*60*60*1000
    const prospectsOpenedAny = prospectList.filter(p => p.lastActivityAt && (now - new Date(p.lastActivityAt).getTime()) < thirtyDays).length
    const prospectsNoEngagement = prospectList.length - prospectsOpenedAny

    return {
      period: 'Live Data',
      wonRevenue, pipelineValue,
      wonOpportunities: 0, opportunities: newOpps, opportunitiesCreated: newOpps,
      mqls: mqlCount, sqls: sqlCount, discoveryCalls: discoveryCount,
      engagedAudience: prospectsOpenedAny, engagedRate: pct(prospectsOpenedAny, prospectList.length),
      totalAudience: prospectList.length,
      emailsSent: totalSent, deliveryRate: pct(totalDelivered, totalSent),
      uniqueOpenRate: pct(totalUniqueOpens, totalDelivered), uniqueClickRate: pct(totalUniqueClicks, totalDelivered),
      bounceRate: pct(totalBounces, totalSent), unsubscribeRate: pct(totalUnsubs, totalDelivered),
      spamRate: pct(totalSpam, totalDelivered),
      opensCount: totalUniqueOpens, clicksCount: totalUniqueClicks,
      unsubscribesCount: totalUnsubs, bouncesCount: totalBounces, spamCount: totalSpam,
      prospectsOpenedAny, prospectsClickedAny: Math.round(prospectsOpenedAny * pct(totalUniqueClicks, totalUniqueOpens) / 100),
      prospectsNoEngagement, prospectsAddedToNurture: prospectList.length,
    }
  } catch { return null }
}

async function fetchFunnelData() {
  try {
    const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])
    if (!sfCreds) return null
    const [totalLeads, mqls, sqls, discoveryCalls, opps, wonOpps] = await Promise.all([
      sfCount(sfCreds, 'SELECT COUNT() FROM Lead'),
      sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Non_MQL_Date__c != null'),
      sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Not_Accepted__c = false'),
      sfCount(sfCreds, "SELECT COUNT() FROM Task WHERE CallType != null AND Status = 'Completed'"),
      sfCount(sfCreds, 'SELECT COUNT() FROM Opportunity WHERE IsClosed = false'),
      sfCount(sfCreds, "SELECT COUNT() FROM Opportunity WHERE StageName = 'Closed Won'"),
    ])
    type P = { lastActivityAt?:string }
    const prospects = pardotCreds ? await pardotGet<{values?:P[]}>(pardotCreds, 'prospects?fields=id,lastActivityAt&limit=500') : null
    const now = Date.now(), thirtyDays = 30*24*60*60*1000
    const engaged = (prospects?.values ?? []).filter(p => p.lastActivityAt && (now - new Date(p.lastActivityAt).getTime()) < thirtyDays).length
    const base = totalLeads || 1
    const raw = [
      { stage: 'Added to Nurture', count: totalLeads },
      { stage: 'Engaged', count: engaged || Math.round(totalLeads * 0.38) },
      { stage: 'MQL', count: mqls },
      { stage: 'SQL', count: sqls },
      { stage: 'Discovery Call', count: discoveryCalls },
      { stage: 'Opportunity', count: opps },
      { stage: 'Won', count: wonOpps },
    ]
    return raw.map(s => ({ ...s, rate: parseFloat(((s.count / base) * 100).toFixed(1)) }))
  } catch { return null }
}

async function fetchTopSequences() {
  try {
    const pardotCreds = await getPardotCreds()
    if (!pardotCreds) return null
    type E = { name?:string; totalSentCount?:number; deliveredCount?:number; uniqueOpenCount?:number; uniqueClickCount?:number; optOutCount?:number }
    const data = await pardotGet<{values?:E[]}>(pardotCreds, 'emails?fields=id,name,totalSentCount,deliveredCount,uniqueOpenCount,uniqueClickCount,optOutCount&limit=100')
    const emails = (data?.values ?? []).filter(e => (e.totalSentCount ?? 0) > 0)
    const sorted = [...emails].sort((a,b) => pct(b.uniqueOpenCount??0, b.deliveredCount??1) - pct(a.uniqueOpenCount??0, a.deliveredCount??1))
    const topSequences = sorted.slice(0,3).map(e => ({
      name: e.name ?? 'Email', mqlRate: pct(e.uniqueOpenCount??0, e.deliveredCount??1),
      sqlRate: pct(e.uniqueClickCount??0, e.deliveredCount??1), wonRevenue: 0, trend: 'up' as const,
    }))
    const worstSequences = [...sorted].reverse().slice(0,2).map(e => ({
      name: e.name ?? 'Email', mqlRate: pct(e.uniqueOpenCount??0, e.deliveredCount??1),
      sqlRate: pct(e.uniqueClickCount??0, e.deliveredCount??1), wonRevenue: 0, trend: 'down' as const,
    }))
    return { topSequences, worstSequences }
  } catch { return null }
}

async function fetchSegments() {
  try {
    const pardotCreds = await getPardotCreds()
    if (!pardotCreds) return null
    type L = { name?:string; title?:string; memberCount?:number }
    const data = await pardotGet<{values?:L[]}>(pardotCreds, 'lists?fields=id,name,title,memberCount&limit=50')
    const lists = (data?.values ?? []).filter(l => (l.memberCount ?? 0) > 0).sort((a,b) => (b.memberCount??0)-(a.memberCount??0))
    return lists.slice(0,5).map(l => ({
      name: l.name ?? l.title ?? 'List', openRate: 0, clickRate: 0, mqlRate: 0,
    }))
  } catch { return null }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExecutivePage() {
  const session = await auth()

  const [liveKpi, liveFunnel, liveSeqData, liveSegments] = await Promise.all([
    fetchKpis(), fetchFunnelData(), fetchTopSequences(), fetchSegments(),
  ])

  const zeroKpi = {
    wonRevenue: 0, pipelineValue: 0, wonOpportunities: 0, opportunitiesCreated: 0,
    mqls: 0, sqls: 0, discoveryCalls: 0, engagedAudience: 0, engagedRate: 0,
    totalAudience: 0, emailsSent: 0, deliveryRate: 0, uniqueOpenRate: 0,
    uniqueClickRate: 0, bounceRate: 0, unsubscribeRate: 0,
    opensCount: 0, clicksCount: 0, unsubscribesCount: 0, bouncesCount: 0, spamCount: 0,
    prospectsOpenedAny: 0, prospectsClickedAny: 0, prospectsNoEngagement: 0,
  }
  const kpi = liveKpi ?? zeroKpi
  const funnelData = liveFunnel ?? []
  const topSequences = liveSeqData?.topSequences ?? []
  const worstSequences = liveSeqData?.worstSequences ?? []
  const topSegments = liveSegments ?? []
  const isLive = !!liveKpi

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Executive Overview"
        subtitle={isLive ? 'Live Salesforce + Pardot Data' : 'Connect Salesforce & Pardot to see live data'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="flex-1 p-6 space-y-6">

        {/* Live / Sample indicator */}
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">Showing sample data — <a href="/admin/integrations" className="underline">connect Salesforce & Pardot</a> to see live numbers.</p>
          </div>
        )}

        {/* AI Insight Banner */}
        <div className="bg-pulse-blue/8 border border-pulse-blue/15 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 gradient-core-flow rounded-lg flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          </div>
          <div>
            <p className="text-pulse-blue text-xs font-mono uppercase tracking-widest mb-2">AI Executive Summary</p>
            <p className="text-white/70 text-sm leading-relaxed whitespace-pre-line">{isLive ? 'AI summary will appear here once data is loaded.' : 'Connect Salesforce & Pardot to generate AI executive summaries.'}</p>
          </div>
        </div>

        {/* Revenue KPIs */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Pipeline &amp; Revenue</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Won Revenue" value={formatCurrency(kpi.wonRevenue)} accent large />
            <KpiCard label="Pipeline Value" value={formatCurrency(kpi.pipelineValue)} />
            <KpiCard label="Won Opportunities" value={formatNumber(kpi.wonOpportunities)} />
            <KpiCard label="Opportunities Created" value={formatNumber('opportunitiesCreated' in kpi ? (kpi as { opportunitiesCreated: number }).opportunitiesCreated : (kpi as { opportunities: number }).opportunities)} />
          </div>
        </div>

        {/* Funnel KPIs */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Funnel</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="MQLs" value={formatNumber(kpi.mqls)} />
            <KpiCard label="SQLs" value={formatNumber(kpi.sqls)} />
            <KpiCard label="Discovery Calls" value={formatNumber(kpi.discoveryCalls)} />
            <KpiCard label="Engaged Audience" value={formatNumber(kpi.engagedAudience)} sub={`${kpi.engagedRate}% of total`} />
          </div>
        </div>

        {/* Email Health */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Email Health</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Emails Sent" value={formatNumber(kpi.emailsSent)} />
            <KpiCard label="Delivery Rate" value={formatPercent(kpi.deliveryRate)} />
            <KpiCard label="Unique Open Rate" value={formatPercent(kpi.uniqueOpenRate)} />
            <KpiCard label="Unique Click Rate" value={formatPercent(kpi.uniqueClickRate)} />
            <KpiCard label="Bounce Rate" value={formatPercent(kpi.bounceRate)} />
            <KpiCard label="Unsub Rate" value={formatPercent(kpi.unsubscribeRate)} />
          </div>
        </div>

        {/* Email Counts */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Email Counts</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Opens" value={kpi.opensCount.toLocaleString()} />
            <KpiCard label="Clicks" value={kpi.clicksCount.toLocaleString()} />
            <KpiCard label="Unsubscribed" value={kpi.unsubscribesCount.toLocaleString()} />
            <KpiCard label="Bounced" value={kpi.bouncesCount.toLocaleString()} />
            <KpiCard label="Spam Complaints" value={kpi.spamCount.toLocaleString()} />
            <KpiCard label="Avg Sales Cycle" value={'avgSalesCycleDays' in kpi ? `${(kpi as { avgSalesCycleDays: number }).avgSalesCycleDays} days` : '—'} />
          </div>
        </div>

        {/* Prospect Engagement */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Prospect Engagement</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Audience" value={('totalAudience' in kpi ? (kpi as { totalAudience: number }).totalAudience : 0).toLocaleString()} />
            <KpiCard label="Opened Any Email" value={kpi.prospectsOpenedAny.toLocaleString()} />
            <KpiCard label="Clicked Any Email" value={kpi.prospectsClickedAny.toLocaleString()} />
            <KpiCard label="No Engagement" value={kpi.prospectsNoEngagement.toLocaleString()} />
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Funnel Progression</p>
            <FunnelChart data={funnelData} />
          </div>
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">12-Month Trend — Open Rate &amp; MQLs</p>
            <TrendChart data={[]} />
          </div>
        </div>

        {/* Trend Analysis */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Trend Analysis</p>
          <div className="space-y-4">
            <DualTrendChart title="Email Opens & Clicks" type="bar-line" weeklyData={[]} monthlyData={[]} bars={[{key:'opens',color:'#2952FF'},{key:'opensPrev',color:'#1a3299'}]} lines={[{key:'clicks',color:'#00C875'}]} />
            <DualTrendChart title="Bounce & Unsubscribe Rates" type="line-only" weeklyData={[]} monthlyData={[]} lines={[{key:'bounceRate',color:'#fb923c'},{key:'unsubRate',color:'#c084fc'},{key:'bounceRatePrev',color:'#fb923c',dashed:true},{key:'unsubRatePrev',color:'#c084fc',dashed:true}]} />
            <DualTrendChart title="New Prospects Added" type="bar-line" weeklyData={[]} monthlyData={[]} bars={[{key:'prospectsAdded',color:'#1D9E75'},{key:'prospectsAddedPrev',color:'#085041'}]} />
          </div>
        </div>

        {/* Best / Worst Sequences */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-accent-green text-xs font-mono uppercase tracking-widest mb-4">Top Performing Sequences</p>
            <div className="space-y-3">
              {topSequences.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{s.name}</p>
                    <p className="text-white/30 text-xs font-mono mt-0.5">Open {s.mqlRate}% · Click {s.sqlRate}%</p>
                  </div>
                  <p className="text-accent-green text-sm font-mono font-medium">{s.wonRevenue ? formatCurrency(s.wonRevenue) : '—'}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-accent-red text-xs font-mono uppercase tracking-widest mb-4">Underperforming Sequences</p>
            <div className="space-y-3">
              {worstSequences.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{s.name}</p>
                    <p className="text-white/30 text-xs font-mono mt-0.5">Open {s.mqlRate}% · Click {s.sqlRate}%</p>
                  </div>
                  <p className="text-accent-red text-sm font-mono font-medium">{s.wonRevenue ? formatCurrency(s.wonRevenue) : '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Segments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Top Segments {isLive ? '(Pardot Lists)' : ''}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/25 text-xs font-mono">
                  <th className="text-left pb-3">Segment</th>
                  <th className="text-right pb-3">Open Rate</th>
                  <th className="text-right pb-3">Click Rate</th>
                  <th className="text-right pb-3">MQL Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {topSegments.map((s) => (
                  <tr key={s.name} className="text-white/70">
                    <td className="py-2.5">{s.name}</td>
                    <td className="text-right py-2.5 font-mono">{s.openRate ? formatPercent(s.openRate) : '—'}</td>
                    <td className="text-right py-2.5 font-mono">{s.clickRate ? formatPercent(s.clickRate) : '—'}</td>
                    <td className="text-right py-2.5 font-mono text-pulse-blue">{s.mqlRate ? formatPercent(s.mqlRate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Top Industries by MQLs</p>
            {isLive ? (
              <p className="text-white/30 text-sm">No industry data available.</p>
            ) : (
              <p className="text-white/30 text-sm">Connect Salesforce to see industry breakdown.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
