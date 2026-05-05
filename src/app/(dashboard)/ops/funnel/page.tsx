import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import FunnelChart from '@/components/charts/FunnelChart'
import KpiCard from '@/components/ui/KpiCard'
import { formatPercent } from '@/lib/utils'
import { bqCount, bqQuery, t, isConfigured, leadsCampaignFilter, mqlCountSql, dateIntervalFilter } from '@/lib/bigquery'

export const dynamic = 'force-dynamic'

interface AvgTimesRow {
  avg_to_mql: number | null
  avg_mql_to_sql: number | null
  avg_sql_to_opp: number | null
  avg_opp_to_won: number | null
  avg_total: number | null
}

async function fetchFunnelData(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return null
    const sfFilter = leadsCampaignFilter(campaigns)
    const leadDate = dateIntervalFilter(dateRange, 'CreatedDate')
    const wonDate  = dateIntervalFilter(dateRange, 'CloseDate')
    const [nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps, engaged, avgTimesRows] = await Promise.all([
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE OQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(mqlCountSql(campaigns, dateRange)),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE SQL__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Discovery_Call__c = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter} ${leadDate}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter} ${wonDate}`),
      bqCount(`
        SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}
        ${dateIntervalFilter(dateRange, 'SAFE_CAST(last_activity_at AS TIMESTAMP)', 'WHERE')}
      `),
      bqQuery<AvgTimesRow>(`
        WITH pardot_mql AS (
          SELECT
            LOWER(pp.email) AS email,
            MIN(TIMESTAMP(pp.created_at))  AS nurture_date,
            MIN(TIMESTAMP(ua.created_at))  AS mql_date
          FROM ${t('Pardot_Prospects')} pp
          JOIN ${t('Pardot_userActivity')} ua ON ua.prospect_id = pp.id
          WHERE ua.type = 4
            AND ua.type_name IN ('Form', 'Form Handler')
            AND NOT REGEXP_CONTAINS(LOWER(pp.email), r'test|tkxel|work|uzair|sami')
          GROUP BY pp.email
        ),
        sf_dates AS (
          SELECT
            LOWER(Email) AS email,
            MAX(CASE WHEN SQL__c = TRUE      THEN CreatedDate     END) AS sql_lead_date,
            MAX(CASE WHEN IsConverted = TRUE  THEN CreatedDate_opp END) AS opp_date,
            MAX(CASE WHEN IsWon = TRUE        THEN CloseDate       END) AS won_date
          FROM ${t('Leads_Opp_Joined')}
          WHERE Email IS NOT NULL
            AND NOT REGEXP_CONTAINS(LOWER(Email), r'test|tkxel|work|uzair|sami')
          GROUP BY LOWER(Email)
        )
        SELECT
          AVG(CASE
            WHEN TIMESTAMP_DIFF(m.mql_date, m.nurture_date, DAY) BETWEEN 0 AND 730
            THEN TIMESTAMP_DIFF(m.mql_date, m.nurture_date, DAY)
          END) AS avg_to_mql,
          AVG(CASE
            WHEN sf.sql_lead_date IS NOT NULL
              AND DATE_DIFF(DATE(sf.sql_lead_date), DATE(m.mql_date), DAY) BETWEEN 0 AND 365
            THEN DATE_DIFF(DATE(sf.sql_lead_date), DATE(m.mql_date), DAY)
          END) AS avg_mql_to_sql,
          AVG(CASE
            WHEN sf.opp_date IS NOT NULL AND sf.sql_lead_date IS NOT NULL
              AND DATE_DIFF(DATE(sf.opp_date), DATE(sf.sql_lead_date), DAY) BETWEEN 0 AND 365
            THEN DATE_DIFF(DATE(sf.opp_date), DATE(sf.sql_lead_date), DAY)
          END) AS avg_sql_to_opp,
          AVG(CASE
            WHEN sf.won_date IS NOT NULL AND sf.opp_date IS NOT NULL
              AND DATE_DIFF(DATE(sf.won_date), DATE(sf.opp_date), DAY) BETWEEN 0 AND 730
            THEN DATE_DIFF(DATE(sf.won_date), DATE(sf.opp_date), DAY)
          END) AS avg_opp_to_won,
          AVG(CASE
            WHEN sf.won_date IS NOT NULL
              AND DATE_DIFF(DATE(sf.won_date), DATE(m.nurture_date), DAY) BETWEEN 0 AND 1000
            THEN DATE_DIFF(DATE(sf.won_date), DATE(m.nurture_date), DAY)
          END) AS avg_total
        FROM pardot_mql m
        LEFT JOIN sf_dates sf ON sf.email = m.email
      `),
    ])
    const base = engaged || 1
    const raw = [
      { stage: 'Engaged', count: engaged },
      { stage: 'MQL', count: mqls },
      { stage: 'Discovery Call', count: discoveryCalls },
      { stage: 'SQL', count: sqls },
      { stage: 'Opportunity', count: opps },
      { stage: 'Won', count: wonOpps },
    ]
    const at = avgTimesRows[0] ?? {}
    return {
      stages: raw.map(s => ({ ...s, rate: parseFloat(((s.count / base) * 100).toFixed(2)) })),
      nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps,
      avgToMql:    at.avg_to_mql    != null ? Math.round(Number(at.avg_to_mql))    : null,
      avgMqlToSql: at.avg_mql_to_sql != null ? Math.round(Number(at.avg_mql_to_sql)) : null,
      avgSqlToOpp: at.avg_sql_to_opp != null ? Math.round(Number(at.avg_sql_to_opp)) : null,
      avgOppToWon: at.avg_opp_to_won != null ? Math.round(Number(at.avg_opp_to_won)) : null,
      avgTotal:    at.avg_total     != null ? Math.round(Number(at.avg_total))     : null,
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

  function fmtDays(d: number | null | undefined): string {
    if (d == null) return '—'
    return `${d}d`
  }

  const avgTimes = [
    { label: 'Avg Time to MQL', value: fmtDays(live?.avgToMql), sub: 'from nurture entry' },
    { label: 'Avg Time to SQL', value: fmtDays(live?.avgMqlToSql), sub: 'from MQL' },
    { label: 'Avg Time to Opportunity', value: fmtDays(live?.avgSqlToOpp), sub: 'from SQL' },
    { label: 'Avg Time to Won', value: fmtDays(live?.avgOppToWon), sub: 'from opportunity' },
  ]
  const avgSalesCycle = fmtDays(live?.avgTotal)

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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard label="MQL → Discovery Call" value={formatPercent(mqls ? discoveryCalls / mqls * 100 : 0)} sub="of MQLs" />
          <KpiCard label="Discovery Call → SQL" value={formatPercent(discoveryCalls ? sqls / discoveryCalls * 100 : 0)} sub="of discovery calls" />
          <KpiCard label="SQL → Opportunity" value={formatPercent(sqls ? opps / sqls * 100 : 0)} sub="of SQLs" />
          <KpiCard label="Opportunity → Won" value={formatPercent(opps ? wonOpps / opps * 100 : 0)} sub="of opportunities" accent />
          <KpiCard label="MQL → Won" value={formatPercent(mqls ? wonOpps / mqls * 100 : 0)} sub="end-to-end" />
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
          <KpiCard label="Avg Sales Cycle (End to End)" value={avgSalesCycle} sub="From nurture entry to won opportunity" accent />
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
                {['Stage', 'Count', 'From Previous Stage', 'Drop-off'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-white/25 text-xs font-mono uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {funnelData.map((stage, i) => {
                const prev = funnelData[i - 1]
                const stageConv = prev && prev.count > 0 ? parseFloat((stage.count / prev.count * 100).toFixed(2)) : null
                const dropOff = stageConv !== null ? parseFloat((100 - stageConv).toFixed(2)) : null
                return (
                  <tr key={stage.stage} className="hover:bg-white/2">
                    <td className="px-5 py-3 text-white">{stage.stage}</td>
                    <td className="px-5 py-3 text-white/70 font-mono">{stage.count.toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono text-pulse-blue">{stageConv === null ? '—' : formatPercent(stageConv)}</td>
                    <td className="px-5 py-3 font-mono text-accent-red">{dropOff === null ? '—' : formatPercent(dropOff)}</td>
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
