import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import {
  bqQuery, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR, EMAIL_SPAM_EXPR,
  campaignSqlFilter, dateIntervalFilter,
} from '@/lib/bigquery'
import { prisma } from '@/lib/prisma'
import SequencesTables from '@/components/tables/SequencesTables'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SEGMENT_CODE_ORDER = ['CIO_NT_MM', 'CIO_NT_U50', 'CEO_T_U50', 'CTO_T_U50', 'CEO_NT', 'CTO_FTS', 'PE_MP']

const SEGMENT_NAME_MAP: Record<string, string> = {
  CIO_NT_MM: 'CIOs & Tech Leaders | Non-Tech | $50–$500M',
  CEO_NT: 'CEOs & Non-Tech Leaders | Non-Tech',
  CEO_T_U50: 'CEOs & Non-Tech Leaders | Tech | Under $50M',
  CTO_T_U50: 'CTOs & Tech Leaders | Tech | Under $50M',
  CTO_FTS: 'CTOs & Tech Leaders | Funded Tech Startups',
  PE_MP: 'Managing Partners | Private Equity',
  CIO_NT_U50: 'CIOs & Tech Leaders | Non-Tech | Under $50M new',
}

function extractSegmentCode(name: string): string | null {
  const parts = name.split(' | ')
  if (parts.length >= 2 && parts[0].trim() === 'NS') {
    const code = parts[1].trim()
    if (SEGMENT_NAME_MAP[code]) return code
  }
  for (const code of SEGMENT_CODE_ORDER) {
    if (name.includes(code)) return code
  }
  return null
}

function extractEmailNumber(name: string): string {
  for (const part of name.split(' | ')) {
    const m = part.trim().match(/^(E\d+)/)
    if (m) return m[1]
  }
  return ''
}

async function getSignalThresholds() {
  try {
    const records = await prisma.benchmark.findMany({
      where: { metric: { in: ['signal_hot_threshold', 'signal_warm_threshold', 'signal_cold_threshold', 'signal_atrisk_bounce'] } },
    })
    const map = Object.fromEntries((records as Array<{ metric: string; warningThreshold: number | null }>).map(b => [b.metric, b.warningThreshold ?? 0]))
    return { hot: map['signal_hot_threshold'] ?? 20, warm: map['signal_warm_threshold'] ?? 12, cold: map['signal_cold_threshold'] ?? 5, atRiskBounce: map['signal_atrisk_bounce'] ?? 5 }
  } catch {
    return { hot: 20, warm: 12, cold: 5, atRiskBounce: 5 }
  }
}

interface CampaignRow {
  campaign_name: string
  details: string
  sent: bigint | number; opens: bigint | number; clicks: bigint | number
  bounces: bigint | number; unsubs: bigint | number; spam: bigint | number
  min_created_at: string
}

interface CampaignFunnelRow {
  campaign_name: string
  mqls: bigint | number
  sqls: bigint | number
  won_revenue: number | null
}

interface TitleActivityRow {
  normalized_title: string
  sent: bigint | number
  opens: bigint | number
  clicks: bigint | number
  unsubs: bigint | number
  bounces: bigint | number
}

async function getSequencesData(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) return { sequences: [], subjectLines: [], prospectTitles: [], connected: false }

    // Filters for the simple (non-aliased) campaign query
    const campaignFilter = campaigns.length > 0
      ? campaignSqlFilter(campaigns)
      : `AND NOT (
            LOWER(campaign_name) LIKE '%copy%'
            OR LOWER(campaign_name) LIKE '% test%'
            OR LOWER(campaign_name) LIKE '%testing%'
          )`
    // Filters for aliased-table queries (ua.campaign_name)
    const uaCampaignFilter = campaigns.length > 0
      ? campaignSqlFilter(campaigns, 'AND', 'ua.campaign_name')
      : `AND NOT (
            LOWER(ua.campaign_name) LIKE '%copy%'
            OR LOWER(ua.campaign_name) LIKE '% test%'
            OR LOWER(ua.campaign_name) LIKE '%testing%'
          )`
    const dateFilter = dateIntervalFilter(dateRange, 'TIMESTAMP(created_at)')
    const uaDateFilter = dateIntervalFilter(dateRange, 'TIMESTAMP(ua.created_at)')

    const [thresholds, campaignRows, funnelRows, titleRows] = await Promise.all([
      getSignalThresholds(),

      // Email engagement per campaign
      bqQuery<CampaignRow>(`
        SELECT
          campaign_name,
          MAX(details) AS details,
          ${EMAIL_SENT_EXPR}   AS sent,
          ${EMAIL_OPEN_EXPR}   AS opens,
          ${EMAIL_CLICK_EXPR}  AS clicks,
          ${EMAIL_BOUNCE_EXPR} AS bounces,
          ${EMAIL_UNSUB_EXPR}  AS unsubs,
          ${EMAIL_SPAM_EXPR}   AS spam,
          MIN(CAST(created_at AS STRING)) AS min_created_at
        FROM ${t('Pardot_userActivity')}
        WHERE campaign_name IS NOT NULL AND campaign_name != ''
          ${campaignFilter}
          ${dateFilter}
        GROUP BY campaign_name
        HAVING ${EMAIL_SENT_EXPR} >= 10
        ORDER BY opens DESC
        LIMIT 200
      `),

      // MQL (form submissions), SQL, and Won Revenue per campaign via prospect→Salesforce join
      bqQuery<CampaignFunnelRow>(`
        SELECT
          ua.campaign_name,
          COUNT(DISTINCT CASE WHEN fa.prospect_id IS NOT NULL THEN ua.prospect_id END) AS mqls,
          COUNT(DISTINCT CASE WHEN loj.SQL__c = TRUE THEN LOWER(pp.email) END)         AS sqls,
          SUM(CASE WHEN loj.IsWon = TRUE THEN COALESCE(loj.Amount, 0) ELSE 0 END)      AS won_revenue
        FROM ${t('Pardot_userActivity')} ua
        JOIN ${t('Pardot_Prospects')} pp ON pp.id = ua.prospect_id
        LEFT JOIN (
          SELECT DISTINCT prospect_id FROM ${t('Pardot_userActivity')} WHERE type = 4
        ) fa ON fa.prospect_id = ua.prospect_id
        LEFT JOIN ${t('Leads_Opp_Joined')} loj ON LOWER(loj.Email) = LOWER(pp.email)
        WHERE ua.type = 6
          AND ua.campaign_name IS NOT NULL AND ua.campaign_name != ''
          ${uaCampaignFilter}
          ${uaDateFilter}
        GROUP BY ua.campaign_name
      `),

      // Actual email activity aggregated by prospect job title
      bqQuery<TitleActivityRow>(`
        SELECT
          pp.normalized_title,
          COUNTIF(ua.type = 6)                                                        AS sent,
          COUNTIF(ua.type = 11)                                                       AS opens,
          COUNTIF((ua.type = 1 AND ua.type_name = 'Email Tracker') OR ua.type = 17)  AS clicks,
          COUNTIF(ua.type IN (12, 35))                                                AS unsubs,
          COUNTIF(ua.type IN (13, 36))                                                AS bounces
        FROM ${t('Pardot_userActivity')} ua
        JOIN ${t('Pardot_Prospects')} pp 
          ON pp.id = ua.prospect_id
        WHERE pp.normalized_title IS NOT NULL 
          AND pp.normalized_title != ''
          AND ua.campaign_name IS NOT NULL 
          AND ua.campaign_name != ''
          ${uaCampaignFilter}
          ${uaDateFilter}
        GROUP BY pp.normalized_title
        HAVING COUNTIF(ua.type = 6) > 0
        ORDER BY sent DESC
        LIMIT 20
      `)

    function signal(openRate: number, bounceRate: number): string {
      if (bounceRate >= thresholds.atRiskBounce) return 'At Risk'
      if (openRate >= thresholds.hot) return 'Hot'
      if (openRate >= thresholds.warm) return 'Warm'
      if (openRate >= thresholds.cold) return 'Cold'
      return 'At Risk'
    }

    // Build campaign funnel lookup
    const funnelMap = new Map<string, { mqls: number; sqls: number; wonRevenue: number }>()
    for (const r of funnelRows) {
      funnelMap.set(r.campaign_name, {
        mqls: Number(r.mqls),
        sqls: Number(r.sqls),
        wonRevenue: Number(r.won_revenue ?? 0),
      })
    }

    const allSequences = campaignRows.map(r => {
      const sent = Number(r.sent)
      const opens = Number(r.opens)
      const clicks = Number(r.clicks)
      const bounces = Number(r.bounces)
      const unsubs = Number(r.unsubs)
      const spam = Number(r.spam)
      const delivered = Math.max(0, sent - bounces)
      const deliveryRate = pct(delivered, sent)
      const openRate = pct(opens, delivered)
      const clickRate = pct(clicks, delivered)
      const ctr = pct(clicks, opens)
      const bounceRate = pct(bounces, sent)
      const unsubRate = pct(unsubs, delivered)
      const segmentCode = extractSegmentCode(r.campaign_name) ?? ''
      const funnel = funnelMap.get(r.campaign_name)
      const mqls = funnel?.mqls ?? 0
      const sqls = funnel?.sqls ?? 0
      return {
        id: undefined as number | undefined,
        name: r.campaign_name,
        subject: String(r.details ?? '') || r.campaign_name,
        segmentCode,
        segment: SEGMENT_NAME_MAP[segmentCode] ?? segmentCode,
        emailNumber: extractEmailNumber(r.campaign_name),
        status: 'active',
        sent, delivered, opens, clicks, bounces, unsubs, spam,
        deliveryRate, openRate, clickRate, ctr, bounceRate, unsubRate,
        mqlRate: pct(mqls, delivered),
        sqlRate: pct(sqls, delivered),
        wonRevenue: funnel?.wonRevenue ?? 0,
        signal: signal(openRate, bounceRate),
        sentAt: r.min_created_at,
      }
    })

    const nsOnly = allSequences.filter(s => s.name.startsWith('NS |'))
    const sequences = (nsOnly.length > 0 ? nsOnly : allSequences).sort((a, b) => b.openRate - a.openRate)

    // Aggregate same subject lines across campaigns
    const subjectMap = new Map<string, { subject: string; delivered: number; opens: number; clicks: number; unsubs: number; bounces: number }>()
    for (const s of sequences) {
      const key = (s.subject || s.name).toLowerCase().trim()
      const existing = subjectMap.get(key)
      if (existing) {
        existing.delivered += s.delivered
        existing.opens += s.opens
        existing.clicks += s.clicks
        existing.unsubs += s.unsubs
        existing.bounces += s.bounces
      } else {
        subjectMap.set(key, {
          subject: s.subject || s.name,
          delivered: s.delivered,
          opens: s.opens,
          clicks: s.clicks,
          unsubs: s.unsubs,
          bounces: s.bounces,
        })
      }
    }
    const subjectLines = Array.from(subjectMap.values())
      .map(s => ({
        ...s,
        openRate: pct(s.opens, s.delivered),
        clickRate: pct(s.clicks, s.delivered),
      }))
      .sort((a, b) => b.opens - a.opens)
      .slice(0, 20)

    // Prospect titles from real activity data
    const prospectTitles = titleRows.map(r => {
      const sent = Number(r.sent)
      const opens = Number(r.opens)
      const clicks = Number(r.clicks)
      const bounces = Number(r.bounces)
      const delivered = Math.max(0, sent - bounces)
      return {
        title: r.normalized_title,
        delivered,
        opens,
        openRate: pct(opens, delivered),
        clicks,
        clickRate: pct(clicks, delivered),
        unsubs: Number(r.unsubs),
        bounces,
      }
    })

    return { sequences, subjectLines, prospectTitles, connected: true }
  } catch (e) {
    console.error('sequences error:', e)
    return { sequences: [], subjectLines: [], prospectTitles: [], connected: false }
  }
}

export default async function SequencesPage({
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
  const data = await getSequencesData(campaigns, dateRange)
  const isLive = data.connected

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Sequence Performance"
        subtitle={isLive ? 'Live BigQuery Data' : 'Email engagement, deliverability, and funnel conversion by sequence'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-8">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — configure <code>BQ_PROJECT_ID</code> and <code>BQ_DATASET_ID</code> to see sequence performance.</p>
          </div>
        )}

        <SequencesTables
          sequences={data.sequences}
          subjectLines={data.subjectLines}
          prospectTitles={data.prospectTitles}
        />
      </div>
    </div>
  )
}
