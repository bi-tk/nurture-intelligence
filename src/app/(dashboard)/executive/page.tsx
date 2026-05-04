import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import KpiCard from '@/components/ui/KpiCard'
import FunnelChart from '@/components/charts/FunnelChart'
import TrendChart from '@/components/charts/TrendChart'
import DualTrendChart from '@/components/charts/DualTrendChart'
import { formatNumber, formatCurrency, formatPercent } from '@/lib/utils'
import {
  bqQuery, bqCount, bqSum, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR, EMAIL_SPAM_EXPR,
  campaignSqlFilter, leadsCampaignFilter, mqlCountSql, dateIntervalFilter,
} from '@/lib/bigquery'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchKpis(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return null

    const sfFilter = leadsCampaignFilter(campaigns)
    const leadDate  = dateIntervalFilter(dateRange, 'CreatedDate')
    const wonDate   = dateIntervalFilter(dateRange, 'CloseDate')
    const pipeDate  = dateIntervalFilter(dateRange, 'CreatedDate_opp')

    const [mqlCount, sqlCount, discoveryCount, wonRevenue, pipelineValue, opportunitiesCreated, wonOpportunities] = await Promise.all([
      bqCount(mqlCountSql(campaigns, dateRange)),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE SQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Discovery_Call__c = TRUE ${sfFilter} ${leadDate}`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter} ${wonDate}`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsClosed = FALSE ${sfFilter} ${pipeDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter} ${wonDate}`),
    ])

    const activityCampaign = campaignSqlFilter(campaigns)
    const activityDate    = dateIntervalFilter(dateRange, 'TIMESTAMP(created_at)')
    const activityFilter  = (activityCampaign || activityDate)
      ? `WHERE 1=1 ${activityCampaign} ${activityDate}`
      : ''

    interface EmailRow {
      sent: bigint | number; unique_opens: bigint | number; unique_clicks: bigint | number
      bounces: bigint | number; unsubs: bigint | number; spam: bigint | number
    }
    const [emailRows, totalAudience, engagedCount] = await Promise.all([
      bqQuery<EmailRow>(`
        SELECT
          ${EMAIL_SENT_EXPR} AS sent,
          ${EMAIL_OPEN_EXPR}  AS unique_opens,
          ${EMAIL_CLICK_EXPR} AS unique_clicks,
          ${EMAIL_BOUNCE_EXPR} AS bounces,
          ${EMAIL_UNSUB_EXPR}  AS unsubs,
          ${EMAIL_SPAM_EXPR}   AS spam
        FROM ${t('Pardot_userActivity')}
        ${activityFilter}
      `),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}`),
      bqCount(`
        SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}
        ${dateIntervalFilter(dateRange, 'SAFE_CAST(last_activity_at AS TIMESTAMP)', 'WHERE')}
      `),
    ])

    const es = emailRows[0]
    const totalSent = Number(es?.sent ?? 0)
    const totalUniqueOpens = Number(es?.unique_opens ?? 0)
    const totalUniqueClicks = Number(es?.unique_clicks ?? 0)
    const totalBounces = Number(es?.bounces ?? 0)
    const totalUnsubs = Number(es?.unsubs ?? 0)
    const totalSpam = Number(es?.spam ?? 0)
    const totalDelivered = Math.max(0, totalSent - totalBounces)

    const prospectsOpenedAny = engagedCount
    const prospectsNoEngagement = Math.max(0, totalAudience - prospectsOpenedAny)

    return {
      wonRevenue, pipelineValue,
      wonOpportunities, opportunitiesCreated,
      mqls: mqlCount, sqls: sqlCount, discoveryCalls: discoveryCount,
      engagedAudience: prospectsOpenedAny,
      engagedRate: pct(prospectsOpenedAny, totalAudience),
      totalAudience,
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

async function fetchFunnelData(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return null
    const sfFilter = leadsCampaignFilter(campaigns)
    const leadDate = dateIntervalFilter(dateRange, 'CreatedDate')
    const wonDate  = dateIntervalFilter(dateRange, 'CloseDate')
    const [totalLeads, mqls, sqls, discoveryCalls, opps, wonOpps, engaged] = await Promise.all([
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Marketing_nurture__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(mqlCountSql(campaigns, dateRange)),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE SQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Discovery_Call__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter} ${wonDate}`),
      bqCount(`
        SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}
        ${dateIntervalFilter(dateRange, 'SAFE_CAST(last_activity_at AS TIMESTAMP)', 'WHERE')}
      `),
    ])
    const base = engaged || 1
    const raw = [
      { stage: 'Engaged', count: engaged },
      { stage: 'MQL', count: mqls },
      { stage: 'SQL', count: sqls },
      { stage: 'Discovery Call', count: discoveryCalls },
      { stage: 'Opportunity', count: opps },
      { stage: 'Won', count: wonOpps },
    ]
    return raw.map(s => ({ ...s, rate: parseFloat(((s.count / base) * 100).toFixed(1)) }))
  } catch { return null }
}

interface CampaignTrendRow {
  campaign_name: string
  period_month: string
  period_week: string
  sent: bigint | number; opens: bigint | number; clicks: bigint | number
  bounces: bigint | number; unsubs: bigint | number
  min_created_at: string
}

async function fetchTrendAndSequences(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return null

    const campaignFilter = campaigns.length > 0
      ? campaignSqlFilter(campaigns)
      : `AND NOT (LOWER(campaign_name) LIKE '%copy%' OR LOWER(campaign_name) LIKE '% test%')`
    const dateFilter = dateIntervalFilter(dateRange, 'TIMESTAMP(created_at)')

    const rows = await bqQuery<CampaignTrendRow>(`
      SELECT
        campaign_name,
        FORMAT_DATETIME('%Y-%m', created_at) AS period_month,
        FORMAT_DATETIME('%Y-%W', created_at) AS period_week,
        ${EMAIL_SENT_EXPR}   AS sent,
        ${EMAIL_OPEN_EXPR}   AS opens,
        ${EMAIL_CLICK_EXPR}  AS clicks,
        ${EMAIL_BOUNCE_EXPR} AS bounces,
        ${EMAIL_UNSUB_EXPR}  AS unsubs,
        MIN(CAST(created_at AS STRING)) AS min_created_at
      FROM ${t('Pardot_userActivity')}
      WHERE campaign_name IS NOT NULL AND campaign_name != ''
        ${campaignFilter}
        ${dateFilter}
      GROUP BY campaign_name, period_month, period_week
      HAVING ${EMAIL_SENT_EXPR} >= 5
    `)

    // Trend aggregation per month and week
    type PeriodBucket = { sortKey: string; label: string; sent: number; delivered: number; opens: number; clicks: number; bounces: number; unsubs: number }
    const monthMap = new Map<string, PeriodBucket>()
    const weekMap = new Map<string, PeriodBucket>()

    // Campaign-level stats for sequences
    const campaignMap = new Map<string, { name: string; sent: number; delivered: number; opens: number; clicks: number; sentAt: string }>()

    for (const r of rows) {
      const sent = Number(r.sent)
      const opens = Number(r.opens)
      const clicks = Number(r.clicks)
      const bounces = Number(r.bounces)
      const unsubs = Number(r.unsubs)
      const delivered = Math.max(0, sent - bounces)

      // Monthly
      const mKey = String(r.period_month)
      const mLabel = MONTH_NAMES[parseInt(mKey.split('-')[1] ?? '1') - 1] ?? mKey
      if (!monthMap.has(mKey)) monthMap.set(mKey, { sortKey: mKey, label: mLabel, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 })
      const m = monthMap.get(mKey)!
      m.sent += sent; m.delivered += delivered; m.opens += opens; m.clicks += clicks; m.bounces += bounces; m.unsubs += unsubs

      // Weekly
      const wKey = String(r.period_week)
      if (!weekMap.has(wKey)) weekMap.set(wKey, { sortKey: wKey, label: wKey, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 })
      const w = weekMap.get(wKey)!
      w.sent += sent; w.delivered += delivered; w.opens += opens; w.clicks += clicks; w.bounces += bounces; w.unsubs += unsubs

      // Campaign totals
      const cName = String(r.campaign_name)
      if (!campaignMap.has(cName)) campaignMap.set(cName, { name: cName, sent: 0, delivered: 0, opens: 0, clicks: 0, sentAt: String(r.min_created_at) })
      const c = campaignMap.get(cName)!
      c.sent += sent; c.delivered += delivered; c.opens += opens; c.clicks += clicks
    }

    const sortedMonths = [...monthMap.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    const sortedWeeks = [...weekMap.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(-12)

    const monthlyData = sortedMonths.map(m => ({
      month: m.label, opens: m.opens, clicks: m.clicks,
      bounceRate: pct(m.bounces, m.sent), unsubRate: pct(m.unsubs, m.delivered), prospectsAdded: 0,
    }))
    const weeklyData = sortedWeeks.map(w => ({
      week: w.label, opens: w.opens, clicks: w.clicks,
      bounceRate: pct(w.bounces, w.sent), unsubRate: pct(w.unsubs, w.delivered), prospectsAdded: 0,
    }))
    const trendData = sortedMonths.map(m => ({
      month: m.label, openRate: pct(m.opens, m.delivered), mqls: 0,
    }))

    const sequences = [...campaignMap.values()]
      .filter(c => c.sent >= 10)
      .map(c => ({
        name: c.name,
        openRate: pct(c.opens, c.delivered),
        clickRate: pct(c.clicks, c.delivered),
      }))
      .sort((a, b) => b.openRate - a.openRate)

    const topSequences = sequences.slice(0, 3).map(s => ({ name: s.name, mqlRate: s.openRate, sqlRate: s.clickRate, wonRevenue: 0 }))
    const worstSequences = sequences.slice(-3).reverse().map(s => ({ name: s.name, mqlRate: s.openRate, sqlRate: s.clickRate, wonRevenue: 0 }))

    return { monthlyData, weeklyData, trendData, topSequences, worstSequences }
  } catch { return null }
}

async function fetchSegments() {
  try {
    if (!isConfigured()) return null
    interface SegRow { pardot_segments: string; members: bigint | number }
    const rows = await bqQuery<SegRow>(`
      SELECT
        TRIM(SPLIT(pardot_segments, ',')[OFFSET(0)]) AS pardot_segments,
        COUNT(*) AS members
      FROM ${t('Pardot_Prospects')}
      WHERE pardot_segments IS NOT NULL AND pardot_segments != ''
      GROUP BY pardot_segments
      ORDER BY members DESC
      LIMIT 5
    `)
    return rows.map(r => ({ name: String(r.pardot_segments), openRate: 0, clickRate: 0, mqlRate: 0 }))
  } catch { return null }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string | string[]; dateRange?: string }>
}) {
  const session = await auth()
  const params = await searchParams
  const campaigns = params.campaign
    ? (Array.isArray(params.campaign) ? params.campaign : [params.campaign])
    : []
  const dateRange = params.dateRange ?? '30d'

  const [liveKpi, liveFunnel, liveTrendSeq, liveSegments] = await Promise.all([
    fetchKpis(campaigns, dateRange), fetchFunnelData(campaigns, dateRange),
    fetchTrendAndSequences(campaigns, dateRange), fetchSegments(),
  ])

  const zeroKpi = {
    wonRevenue: 0, pipelineValue: 0, wonOpportunities: 0, opportunitiesCreated: 0,
    mqls: 0, sqls: 0, discoveryCalls: 0, engagedAudience: 0, engagedRate: 0,
    totalAudience: 0, emailsSent: 0, deliveryRate: 0, uniqueOpenRate: 0,
    uniqueClickRate: 0, bounceRate: 0, unsubscribeRate: 0, spamRate: 0,
    opensCount: 0, clicksCount: 0, unsubscribesCount: 0, bouncesCount: 0, spamCount: 0,
    prospectsOpenedAny: 0, prospectsClickedAny: 0, prospectsNoEngagement: 0,
  }
  const kpi = liveKpi ?? zeroKpi
  const funnelData = liveFunnel ?? []
  const topSequences = liveTrendSeq?.topSequences ?? []
  const worstSequences = liveTrendSeq?.worstSequences ?? []
  const topSegments = liveSegments ?? []
  const monthlyTrend = liveTrendSeq?.monthlyData ?? []
  const weeklyTrend = liveTrendSeq?.weeklyData ?? []
  const trendChartData = liveTrendSeq?.trendData ?? []
  const isLive = !!liveKpi

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Executive Overview"
        subtitle={isLive ? 'Live BigQuery Data' : 'Configure BQ_PROJECT_ID & BQ_DATASET_ID to see live data'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="flex-1 p-6 space-y-6">

        {/* Connection indicator */}
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No live data — set <code>BQ_PROJECT_ID</code> and <code>BQ_DATASET_ID</code> environment variables.</p>
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
                : 'Configure BigQuery to generate AI executive summaries.'}
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
              weeklyData={weeklyTrend}
              monthlyData={monthlyTrend}
              bars={[{ key: 'opens', color: '#2952FF' }]}
              lines={[{ key: 'clicks', color: '#00C875' }]}
            />
            <DualTrendChart
              title="Bounce & Unsubscribe Rates"
              type="line-only"
              weeklyData={weeklyTrend}
              monthlyData={monthlyTrend}
              lines={[
                { key: 'bounceRate', color: '#fb923c' },
                { key: 'unsubRate', color: '#c084fc' },
              ]}
            />
            <DualTrendChart
              title="New Prospects Added"
              type="bar-line"
              weeklyData={weeklyTrend}
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
              <p className="text-white/30 text-sm">No sequence data available.</p>
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
              <p className="text-white/30 text-sm">No sequence data available.</p>
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
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-4">Top Segments</p>
            {topSegments.length === 0 ? (
              <p className="text-white/30 text-sm">No segment data available.</p>
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
            <p className="text-white/30 text-sm">Industry breakdown available on the Segments page.</p>
          </div>
        </div>

      </div>
    </div>
  )
}
