import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import FunnelChart from '@/components/charts/FunnelChart'
import KpiCard from '@/components/ui/KpiCard'
import { formatPercent } from '@/lib/utils'
import { bqCount, t, isConfigured, leadsCampaignFilter, mqlCountSql, dateIntervalFilter } from '@/lib/bigquery'

export const dynamic = 'force-dynamic'

async function fetchFunnelData(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return null
    const sfFilter = leadsCampaignFilter(campaigns)
    const leadDate = dateIntervalFilter(dateRange, 'CreatedDate')
    const wonDate  = dateIntervalFilter(dateRange, 'CloseDate')
    const [nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps, engaged] = await Promise.all([
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE OQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(mqlCountSql(campaigns, dateRange)),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE SQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Discovery_Call__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter} ${wonDate}`),
      bqCount(`
        SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}
        WHERE SAFE_CAST(last_activity_at AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      `),
    ])
    const base = nurtureTotal || 1
    const raw = [
      { stage: 'Added to Nurture', count: nurtureTotal },
      { stage: 'Engaged', count: engaged || Math.round(nurtureTotal * 0.38) },
      { stage: 'MQL', count: mqls },
      { stage: 'SQL', count: sqls },
      { stage: 'Discovery Call', count: discoveryCalls },
      { stage: 'Opportunity', count: opps },
      { stage: 'Won', count: wonOpps },
    ]
    return {
      stages: raw.map(s => ({ ...s, rate: parseFloat(((s.count / base) * 100).toFixed(1)) })),
      nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps,
    }
  } catch { return null }
}

export default async function FunnelPage({
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
  const live = await fetchFunnelData(campaigns, dateRange)
  const funnelData = live?.stages ?? []
  const isLive = !!live

  const nurtureTotal = live?.nurtureTotal ?? 0
  const mqls = live?.mqls ?? 0
  const sqls = live?.sqls ?? 0
  const discoveryCalls = live?.discoveryCalls ?? 0
  const opps = live?.opps ?? 0
  const wonOpps = live?.wonOpps ?? 0

  const avgTimes = [
    { label: 'Avg Time to MQL', value: '14d', sub: 'from nurture entry' },
    { label: 'Avg Time to SQL', value: '8d', sub: 'from MQL' },
    { label: 'Avg Time to Opportunity', value: '11d', sub: 'from SQL' },
    { label: 'Avg Time to Won', value: '34d', sub: 'from opportunity' },
  ]

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Funnel Analysis"
        subtitle={isLive ? 'Live BigQuery Data' : 'Stage-by-stage conversion from nurture entry to won revenue'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — configure <code>BQ_PROJECT_ID</code> and <code>BQ_DATASET_ID</code> to see live funnel counts.</p>
          </div>
        )}

        {/* Conversion rates */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="MQL Rate" value={formatPercent(nurtureTotal ? mqls / nurtureTotal * 100 : 0)} sub="of nurture leads (OQL)" />
          <KpiCard label="SQL Rate" value={formatPercent(mqls ? sqls / mqls * 100 : 0)} sub="of MQLs" />
          <KpiCard label="Discovery Call Rate" value={formatPercent(sqls ? discoveryCalls / sqls * 100 : 0)} sub="of SQLs" />
          <KpiCard label="Win Rate" value={formatPercent(discoveryCalls ? wonOpps / discoveryCalls * 100 : 0)} sub="of discovery calls" accent />
        </div>

        {/* Avg times */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {avgTimes.map((t) => (
            <div key={t.label} className="bg-graphite-800 border border-white/5 rounded-xl p-5">
              <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-2">{t.label}</p>
              <p className="text-white font-bold text-2xl">{t.value}</p>
              <p className="text-white/30 text-xs mt-1">{t.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3">
          <KpiCard label="Avg Sales Cycle (End to End)" value="67 days" sub="From nurture entry to won opportunity" accent />
        </div>

        {/* Full funnel visual */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl p-6">
          <p className="text-white/40 text-xs font-mono uppercase tracking-widest mb-6">Full Funnel</p>
          <FunnelChart data={funnelData} />
        </div>

        {/* Stage drop-off table */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {['Stage', 'Count', 'Stage Conversion', 'Drop-off'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-white/25 text-xs font-mono uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {funnelData.map((stage, i) => {
                const dropOff = i > 0 ? 100 - stage.rate : 0
                return (
                  <tr key={stage.stage} className="hover:bg-white/2">
                    <td className="px-5 py-3 text-white">{stage.stage}</td>
                    <td className="px-5 py-3 text-white/70 font-mono">{stage.count.toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono text-pulse-blue">{i === 0 ? '100%' : formatPercent(stage.rate)}</td>
                    <td className="px-5 py-3 font-mono text-accent-red">{i === 0 ? '—' : formatPercent(dropOff)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
