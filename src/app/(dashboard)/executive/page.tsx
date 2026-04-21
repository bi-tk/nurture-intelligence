import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/ui/KpiCard'
import FunnelChart from '@/components/charts/FunnelChart'
import TrendChart from '@/components/charts/TrendChart'
import DualTrendChart from '@/components/charts/DualTrendChart'
import { formatNumber, formatCurrency, formatPercent } from '@/lib/utils'
import { getSfCreds, getPardotCreds, sfQuery, sfCount, pardotGet, pardotStats, pct } from '@/lib/sf-api'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Fetch helpers ────────────────────────────────────────────────────────────

type ListEmailMeta = { id?: number; subject?: string; name?: string; sentAt?: string; isSent?: boolean }

async function fetchSentEmails(pardotCreds: Awaited<ReturnType<typeof getPardotCreds>>) {
  if (!pardotCreds) return []
  const data = await pardotGet<{ values?: ListEmailMeta[] }>(
    pardotCreds,
    'list-emails?fields=id,name,subject,sentAt,isSent&limit=200'
  )
  return (data?.values ?? [])
    .filter(e => e.isSent === true && e.id != null)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    .slice(0, 50)
}

async function fetchKpis() {
  try {
    const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])
    if (!sfCreds && !pardotCreds) return null

    const [mqlCount, sqlCount, discoveryCount, wonAgg, pipelineAgg, newOpps] = await Promise.all([
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Non_MQL_Date__c != null') : 0,
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Not_Accepted__c = false') : 0,
      sfCreds ? sfCount(sfCreds, "SELECT COUNT() FROM Task WHERE CallType != null AND Status = 'Completed'") : 0,
      sfCreds ? sfQuery<{ expr0: number }>(sfCreds, 'SELECT SUM(Amount) FROM Opportunity WHERE IsWon = true AND IsClosed = true') : null,
      sfCreds ? sfQuery<{ expr0: number }>(sfCreds, 'SELECT SUM(Amount) FROM Opportunity WHERE IsClosed = false') : null,
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Opportunity WHERE CreatedDate = THIS_MONTH') : 0,
    ])

    const wonRevenue = wonAgg?.records?.[0]?.expr0 ?? 0
    const pipelineValue = pipelineAgg?.records?.[0]?.expr0 ?? 0

    // Pardot email stats via list-emails/{id}/stats
    let totalSent = 0, totalDelivered = 0, totalUniqueOpens = 0, totalUniqueClicks = 0
    let totalHardBounces = 0, totalSoftBounces = 0, totalUnsubs = 0, totalSpam = 0

    if (pardotCreds) {
      const sentEmails = await fetchSentEmails(pardotCreds)
      const statsResults = await Promise.all(sentEmails.map(e => pardotStats(pardotCreds, e.id!)))
      for (const s of statsResults) {
        if (!s) continue
        totalSent += s.sent ?? 0
        totalDelivered += s.delivered ?? 0
        totalUniqueOpens += s.uniqueOpens ?? 0
        totalUniqueClicks += s.uniqueClicks ?? 0
        totalHardBounces += s.hardBounced ?? 0
        totalSoftBounces += s.softBounced ?? 0
        totalUnsubs += s.optOuts ?? 0
        totalSpam += s.spamComplaints ?? 0
      }
    }

    const totalBounces = totalHardBounces + totalSoftBounces

    type ProspectRow = { lastActivityAt?: string }
    const prospects = pardotCreds
      ? await pardotGet<{ values?: ProspectRow[] }>(pardotCreds, 'prospects?fields=id,lastActivityAt&limit=500')
      : null
    const prospectList = prospects?.values ?? []
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const prospectsOpenedAny = prospectList.filter(p =>
      p.lastActivityAt && (now - new Date(p.lastActivityAt).getTime()) < thirtyDays
    ).length
    const prospectsNoEngagement = prospectList.length - prospectsOpenedAny

    return {
      wonRevenue, pipelineValue,
      wonOpportunities: 0, opportunitiesCreated: newOpps,
      mqls: mqlCount, sqls: sqlCount, discoveryCalls: discoveryCount,
      engagedAudience: prospectsOpenedAny,
      engagedRate: pct(prospectsOpenedAny, prospectList.length),
      totalAudience: prospectList.length,
      emailsSent: totalSent,
      deliveryRate: pct(totalDelivered, totalSent),
      uniqueOpenRate: pct(totalUniqueOpens, totalDelivered),
      uniqueClickRate: pct(totalUniqueClicks, totalDelivered),
      bounceRate: pct(totalBounces, totalSent),
      unsubscribeRate: pct(totalUnsubs, totalDelivered),
      spamRate: pct(totalSpam, totalDelivered),
      opensCount: totalUniqueOpens,
      clicksCount: totalUniqueClicks,
      unsubscribesCount: totalUnsubs,
      bouncesCount: totalBounces,
      spamCount: totalSpam,
      prospectsOpenedAny,
      prospectsClickedAny: Math.round(prospectsOpenedAny * pct(totalUniqueClicks, totalUniqueOpens) / 100),
      prospectsNoEngagement,
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
      sfCount(sfCreds, "SELECT COUNT() FROM Opportunity WHERE IsWon = true AND IsClosed = true"),
    ])
    type P = { lastActivityAt?: string }
    const prospects = pardotCreds
      ? await pardotGet<{ values?: P[] }>(pardotCreds, 'prospects?fields=id,lastActivityAt&limit=500')
      : null
    const now = Date.now(), thirtyDays = 30 * 24 * 60 * 60 * 1000
    const engaged = (prospects?.values ?? []).filter(
      p => p.lastActivityAt && (now - new Date(p.lastActivityAt).getTime()) < thirtyDays
    ).length
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

    const sentEmails = await fetchSentEmails(pardotCreds)
    const statsResults = await Promise.all(sentEmails.map(e => pardotStats(pardotCreds, e.id!)))

    const sequences = sentEmails
      .map((e, i) => {
        const s = statsResults[i]
        if (!s) return null
        const delivered = s.delivered ?? 0
        const opens = s.uniqueOpens ?? 0
        const clicks = s.uniqueClicks ?? 0
        return {
          name: e.subject ?? e.name ?? `Email ${e.id}`,
          openRate: pct(opens, delivered),
          clickRate: pct(clicks, delivered),
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.openRate - a.openRate)

    const topSequences = sequences.slice(0, 3).map(s => ({
      name: s.name, mqlRate: s.openRate, sqlRate: s.clickRate, wonRevenue: 0,
    }))
    const worstSequences = sequences.slice(-3).reverse().map(s => ({
      name: s.name, mqlRate: s.openRate, sqlRate: s.clickRate, wonRevenue: 0,
    }))

    return { topSequences, worstSequences }
  } catch { return null }
}

async function fetchSegments() {
  try {
    const pardotCreds = await getPardotCreds()
    if (!pardotCreds) return null
    type L = { name?: string; title?: string; memberCount?: number }
    const data = await pardotGet<{ values?: L[] }>(pardotCreds, 'lists?fields=id,name,title,memberCount&limit=50')
    const lists = (data?.values ?? [])
      .filter(l => (l.memberCount ?? 0) > 0)
      .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
    return lists.slice(0, 5).map(l => ({
      name: l.name ?? l.title ?? 'List', openRate: 0, clickRate: 0, mqlRate: 0,
    }))
  } catch { return null }
}

async function fetchTrendData() {
  try {
    const pardotCreds = await getPardotCreds()
    if (!pardotCreds) return null

    const sentEmails = await fetchSentEmails(pardotCreds)
    const statsResults = await Promise.all(sentEmails.map(e => pardotStats(pardotCreds, e.id!)))

    // Aggregate by calendar month
    const monthMap = new Map<string, {
      sortKey: string
      label: string
      sent: number; delivered: number; opens: number; clicks: number
      bounces: number; unsubs: number
    }>()

    sentEmails.forEach((e, i) => {
      const s = statsResults[i]
      if (!s || !e.sentAt) return
      const d = new Date(e.sentAt)
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = MONTH_NAMES[d.getMonth()]
      if (!monthMap.has(sortKey)) {
        monthMap.set(sortKey, { sortKey, label, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 })
      }
      const m = monthMap.get(sortKey)!
      m.sent += s.sent ?? 0
      m.delivered += s.delivered ?? 0
      m.opens += s.uniqueOpens ?? 0
      m.clicks += s.uniqueClicks ?? 0
      m.bounces += (s.hardBounced ?? 0) + (s.softBounced ?? 0)
      m.unsubs += s.optOuts ?? 0
    })

    const sorted = [...monthMap.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey))

    const monthlyData = sorted.map(m => ({
      month: m.label,
      opens: m.opens,
      clicks: m.clicks,
      bounceRate: pct(m.bounces, m.sent),
      unsubRate: pct(m.unsubs, m.delivered),
      prospectsAdded: 0,
      opensPrev: 0,
      bounceRatePrev: 0,
      unsubRatePrev: 0,
      prospectsAddedPrev: 0,
    }))

    const trendData = sorted.map(m => ({
      month: m.label,
      openRate: pct(m.opens, m.delivered),
      mqls: 0,
    }))

    return { monthlyData, trendData }
  } catch { return null }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExecutivePage() {
  const session = await auth()

  const [liveKpi, liveFunnel, liveSeqData, liveSegments, liveTrend] = await Promise.all([
    fetchKpis(), fetchFunnelData(), fetchTopSequences(), fetchSegments(), fetchTrendData(),
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
  const monthlyTrend = liveTrend?.monthlyData ?? []
  const trendChartData = liveTrend?.trendData ?? []
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

        {/* Connection indicator */}
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No live data — <a href="/admin/integrations" className="underline">connect Salesforce &amp; Pardot</a> to see real numbers.</p>
          </div>
        )}

        {/* AI Insight Banner */}
        <div className="bg-pulse-blue/8 border border-pulse-blue/15 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 gradient-core-flow rounded-lg flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          </div>
          <div>
            <p className="text-pulse-blue text-xs font-mono uppercase tracking-widest mb-2">AI Executive Summary</p>
            <p className="text-white/70 text-sm leading-relaxed">
              {isLive
                ? `Pipeline: ${formatCurrency(kpi.pipelineValue)} · ${formatNumber(kpi.emailsSent)} emails sent · ${kpi.uniqueOpenRate}% open rate · ${kpi.engagedAudience.toLocaleString()} engaged prospects.`
                : 'Connect Salesforce & Pardot to generate AI executive summaries.'}
            </p>
          </div>
        </div>

        {/* Revenue KPIs */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Pipeline &amp; Revenue</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Won Revenue" value={formatCurrency(kpi.wonRevenue)} accent large />
            <KpiCard label="Pipeline Value" value={formatCurrency(kpi.pipelineValue)} />
            <KpiCard label="Won Opportunities" value={formatNumber(kpi.wonOpportunities)} />
            <KpiCard label="Opportunities Created" value={formatNumber(kpi.opportunitiesCreated)} />
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
            <KpiCard label="Avg Sales Cycle" value="—" />
          </div>
        </div>

        {/* Prospect Engagement */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Prospect Engagement</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Audience" value={kpi.totalAudience.toLocaleString()} />
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
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Monthly Trend — Open Rate</p>
            <TrendChart data={trendChartData} />
          </div>
        </div>

        {/* Trend Analysis */}
        <div>
          <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Trend Analysis</p>
          <div className="space-y-4">
            <DualTrendChart
              title="Email Opens & Clicks"
              type="bar-line"
              weeklyData={[]}
              monthlyData={monthlyTrend}
              bars={[{ key: 'opens', color: '#2952FF' }]}
              lines={[{ key: 'clicks', color: '#00C875' }]}
            />
            <DualTrendChart
              title="Bounce & Unsubscribe Rates"
              type="line-only"
              weeklyData={[]}
              monthlyData={monthlyTrend}
              lines={[
                { key: 'bounceRate', color: '#fb923c' },
                { key: 'unsubRate', color: '#c084fc' },
              ]}
            />
            <DualTrendChart
              title="New Prospects Added"
              type="bar-line"
              weeklyData={[]}
              monthlyData={monthlyTrend}
              bars={[{ key: 'prospectsAdded', color: '#1D9E75' }]}
            />
          </div>
        </div>

        {/* Best / Worst Sequences */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-accent-green text-xs font-mono uppercase tracking-widest mb-4">Top Performing Sequences</p>
            {topSequences.length === 0 ? (
              <p className="text-white/30 text-sm">No sequence data — connect Pardot to see performance.</p>
            ) : (
              <div className="space-y-3">
                {topSequences.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium truncate max-w-[240px]">{s.name}</p>
                      <p className="text-white/30 text-xs font-mono mt-0.5">Open {s.mqlRate}% · Click {s.sqlRate}%</p>
                    </div>
                    <p className="text-accent-green text-sm font-mono font-medium">{s.wonRevenue ? formatCurrency(s.wonRevenue) : '—'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-accent-red text-xs font-mono uppercase tracking-widest mb-4">Underperforming Sequences</p>
            {worstSequences.length === 0 ? (
              <p className="text-white/30 text-sm">No sequence data — connect Pardot to see performance.</p>
            ) : (
              <div className="space-y-3">
                {worstSequences.map((s) => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium truncate max-w-[240px]">{s.name}</p>
                      <p className="text-white/30 text-xs font-mono mt-0.5">Open {s.mqlRate}% · Click {s.sqlRate}%</p>
                    </div>
                    <p className="text-accent-red text-sm font-mono font-medium">{s.wonRevenue ? formatCurrency(s.wonRevenue) : '—'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top Segments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Top Segments {isLive ? '(Pardot Lists)' : ''}</p>
            {topSegments.length === 0 ? (
              <p className="text-white/30 text-sm">No segment data — connect Pardot to see lists.</p>
            ) : (
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
            )}
          </div>
          <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Top Industries by MQLs</p>
            <p className="text-white/30 text-sm">Connect Salesforce to see industry breakdown.</p>
          </div>
        </div>

      </div>
    </div>
  )
}
