import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import {
  bqQuery, t, pct, isConfigured,
  campaignSqlFilter, dateIntervalFilter,
} from '@/lib/bigquery'
import SegmentTables from '@/components/tables/SegmentTables'

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

const NEWSLETTER_NAME = 'Nurture & Future Interest'

type StatsRow = {
  name: string; members: number
  sent: number; delivered: number; opens: number; clicks: number; bounces: number
  deliveryRate: number; openRate: number; clickRate: number; ctr: number
  unsubRate: number; mqlRate: number; sqlRate: number; wonRevenue: number
}

function emptyRow(name: string, members: number): StatsRow {
  return { name, members, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, deliveryRate: 0, openRate: 0, clickRate: 0, ctr: 0, unsubRate: 0, mqlRate: 0, sqlRate: 0, wonRevenue: 0 }
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

interface SegmentRow {
  segment_name: string
  members: bigint | number
  sent: bigint | number; opens: bigint | number
  clicks: bigint | number; bounces: bigint | number; unsubs: bigint | number
}

interface SegmentFunnelRow {
  segment_code: string
  mqls: bigint | number; sqls: bigint | number; won_revenue: number | null
}

interface IndustryRow {
  industry: string
  members: bigint | number
  sent: bigint | number; opens: bigint | number
  clicks: bigint | number; bounces: bigint | number; unsubs: bigint | number
  mqls: bigint | number; sqls: bigint | number; won_revenue: number | null
}

async function getSegmentsData(campaigns: string[], dateRange: string) {
  try {
    if (!isConfigured()) {
      return {
        segments: SEGMENT_CODE_ORDER.map(code => emptyRow(SEGMENT_NAME_MAP[code] ?? code, 0)),
        newsletter: emptyRow(NEWSLETTER_NAME, 0),
        industries: [],
        sfConnected: false, pardotConnected: false,
      }
    }

    const uaCampaignFilter = campaigns.length > 0
      ? campaignSqlFilter(campaigns, 'AND', 'ua.campaign_name')
      : `AND ua.campaign_name LIKE 'NS |%'`
    const uaDateFilter = dateIntervalFilter(dateRange, 'TIMESTAMP(ua.created_at)')

    const [segmentRows, campaignFunnelRows, industryRows] = await Promise.all([

      // Segment member counts + email stats — join Pardot_Prospects → Pardot_userActivity
      bqQuery<SegmentRow>(`
        SELECT
          pp.segment_name,
          COUNT(DISTINCT pp.id)                                                         AS members,
          COUNTIF(ua.type = 6)                                                          AS sent,
          COUNTIF(ua.type = 11)                                                         AS opens,
          COUNTIF((ua.type = 1 AND ua.type_name = 'Email Tracker') OR ua.type = 17)    AS clicks,
          COUNTIF(ua.type IN (13, 36))                                                  AS bounces,
          COUNTIF(ua.type IN (12, 35))                                                  AS unsubs
        FROM (
          SELECT id, TRIM(SPLIT(pardot_segments, ',')[OFFSET(0)]) AS segment_name
          FROM ${t('Pardot_Prospects')}
          WHERE pardot_segments IS NOT NULL
            AND pardot_segments != ''
            AND LOWER(TRIM(pardot_segments)) != 'nan'
        ) pp
        LEFT JOIN ${t('Pardot_userActivity')} ua
          ON ua.prospect_id = pp.id
          ${uaCampaignFilter}
          ${uaDateFilter}
        GROUP BY pp.segment_name
        HAVING COUNT(DISTINCT pp.id) > 0
        ORDER BY members DESC
      `),

      // MQL / SQL / Won Revenue per segment — form submitters scoped to segment_code
      bqQuery<SegmentFunnelRow>(`
        WITH segment_prospects AS (
          SELECT id, LOWER(email) AS email,
                 TRIM(SPLIT(pardot_segments, ',')[OFFSET(0)]) AS segment_code
          FROM ${t('Pardot_Prospects')}
          WHERE pardot_segments IS NOT NULL AND pardot_segments != ''
            AND LOWER(TRIM(pardot_segments)) != 'nan'
            AND NOT REGEXP_CONTAINS(LOWER(email), r'test|tkxel|work|uzair|sami')
        ),
        mql_per_segment AS (
          SELECT DISTINCT sp.segment_code, sp.email
          FROM ${t('Pardot_userActivity')} ua
          JOIN segment_prospects sp ON sp.id = ua.prospect_id
          WHERE ua.type = 4
            AND ua.type_name IN ('Form', 'Form Handler')
            AND ua.campaign_name IS NOT NULL AND ua.campaign_name != ''
            ${uaCampaignFilter}
            ${uaDateFilter}
        ),
        sf_by_email AS (
          SELECT
            LOWER(Email) AS email,
            MAX(IF(SQL__c = TRUE, 1, 0))                           AS is_sql,
            SUM(IF(IsWon = TRUE, COALESCE(Amount, 0), 0))         AS won_amount
          FROM ${t('Leads_Opp_Joined')}
          WHERE Email IS NOT NULL
            AND NOT REGEXP_CONTAINS(LOWER(Email), r'test|tkxel|work|uzair|sami')
          GROUP BY LOWER(Email)
        )
        SELECT
          m.segment_code,
          COUNT(DISTINCT m.email)                                        AS mqls,
          COUNT(DISTINCT IF(sf.is_sql = 1, m.email, NULL))              AS sqls,
          COALESCE(SUM(sf.won_amount), 0)                               AS won_revenue
        FROM mql_per_segment m
        LEFT JOIN sf_by_email sf ON sf.email = m.email
        GROUP BY m.segment_code
      `),

      // Industry: Pardot_Prospects as base → activity for email stats → Leads_Opp_Joined for MQL/SQL/Won
      bqQuery<IndustryRow>(`
        WITH prospect_industry AS (
          SELECT id, LOWER(email) AS email, industry
          FROM ${t('Pardot_Prospects')}
          WHERE industry IS NOT NULL AND industry != ''
            AND NOT REGEXP_CONTAINS(LOWER(email), r'test|tkxel|work|uzair|sami')
        ),
        email_stats AS (
          SELECT
            ua.prospect_id,
            SUM(IF(ua.type = 6, 1, 0))                                                       AS sent,
            SUM(IF(ua.type = 11, 1, 0))                                                      AS opens,
            SUM(IF((ua.type = 1 AND ua.type_name = 'Email Tracker') OR ua.type = 17, 1, 0)) AS clicks,
            SUM(IF(ua.type IN (13, 36), 1, 0))                                               AS bounces,
            SUM(IF(ua.type IN (12, 35), 1, 0))                                               AS unsubs,
            MAX(IF(ua.type = 4 AND ua.type_name IN ('Form', 'Form Handler'), 1, 0))          AS is_mql
          FROM ${t('Pardot_userActivity')} ua
          WHERE ua.campaign_name IS NOT NULL AND ua.campaign_name != ''
            ${uaCampaignFilter}
            ${uaDateFilter}
          GROUP BY ua.prospect_id
        ),
        sf_by_email AS (
          SELECT
            LOWER(Email) AS email,
            MAX(IF(SQL__c = TRUE, 1, 0))                           AS is_sql,
            SUM(IF(IsWon = TRUE, COALESCE(Amount, 0), 0))         AS won_amount
          FROM ${t('Leads_Opp_Joined')}
          WHERE Email IS NOT NULL
            AND NOT REGEXP_CONTAINS(LOWER(Email), r'test|tkxel|work|uzair|sami')
          GROUP BY LOWER(Email)
        )
        SELECT
          pi.industry,
          COUNT(DISTINCT pi.id)                                                AS members,
          COALESCE(SUM(es.sent), 0)                                            AS sent,
          COALESCE(SUM(es.opens), 0)                                           AS opens,
          COALESCE(SUM(es.clicks), 0)                                          AS clicks,
          COALESCE(SUM(es.bounces), 0)                                         AS bounces,
          COALESCE(SUM(es.unsubs), 0)                                          AS unsubs,
          COUNT(DISTINCT IF(es.is_mql = 1, pi.email, NULL))                   AS mqls,
          COUNT(DISTINCT IF(sf.is_sql = 1, pi.email, NULL))                   AS sqls,
          COALESCE(SUM(sf.won_amount), 0)                                      AS won_revenue
        FROM prospect_industry pi
        LEFT JOIN email_stats es ON es.prospect_id = pi.id
        LEFT JOIN sf_by_email sf ON sf.email = pi.email
        GROUP BY pi.industry
        ORDER BY members DESC
      `),
    ])

    // Build funnel lookup keyed directly by segment_code
    const funnelMap = new Map<string, { mqls: number; sqls: number; wonRevenue: number }>()
    for (const r of campaignFunnelRows) {
      funnelMap.set(r.segment_code, {
        mqls: Number(r.mqls),
        sqls: Number(r.sqls),
        wonRevenue: Number(r.won_revenue ?? 0),
      })
    }

    // Aggregate segment stats from the Pardot join query
    const segStats: Record<string, { members: number; sent: number; delivered: number; opens: number; clicks: number; bounces: number; unsubs: number; mqls: number; sqls: number; wonRevenue: number }> = {}
    for (const code of SEGMENT_CODE_ORDER) {
      segStats[code] = { members: 0, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0, mqls: 0, sqls: 0, wonRevenue: 0 }
    }

    let newsletterMembers = 0
    let newsletterStats = { sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0, mqls: 0, sqls: 0, wonRevenue: 0 }

    for (const r of segmentRows) {
      const code = extractSegmentCode(r.segment_name)
      const sent = Number(r.sent)
      const bounces = Number(r.bounces)
      const delivered = Math.max(0, sent - bounces)
      if (code && segStats[code]) {
        segStats[code].members += Number(r.members)
        segStats[code].sent += sent
        segStats[code].delivered += delivered
        segStats[code].opens += Number(r.opens)
        segStats[code].clicks += Number(r.clicks)
        segStats[code].bounces += bounces
        segStats[code].unsubs += Number(r.unsubs)
      } else if (
        r.segment_name.toLowerCase().includes('newsletter') ||
        r.segment_name.toLowerCase().includes('future interest') ||
        r.segment_name === NEWSLETTER_NAME
      ) {
        newsletterMembers += Number(r.members)
        newsletterStats.sent += sent
        newsletterStats.delivered += delivered
        newsletterStats.opens += Number(r.opens)
        newsletterStats.clicks += Number(r.clicks)
        newsletterStats.bounces += bounces
        newsletterStats.unsubs += Number(r.unsubs)
      }
    }

    // Add funnel metrics to segments — funnelMap is already keyed by segment_code
    for (const [code, funnel] of funnelMap) {
      if (segStats[code]) {
        segStats[code].mqls += funnel.mqls
        segStats[code].sqls += funnel.sqls
        segStats[code].wonRevenue += funnel.wonRevenue
      }
    }

    const segments: StatsRow[] = SEGMENT_CODE_ORDER.map(code => {
      const name = SEGMENT_NAME_MAP[code] ?? code
      const st = segStats[code]
      if (!st || st.members === 0) return emptyRow(name, 0)
      return {
        name, members: st.members,
        sent: st.sent, delivered: st.delivered, opens: st.opens, clicks: st.clicks, bounces: st.bounces,
        deliveryRate: pct(st.delivered, st.sent),
        openRate: pct(st.opens, st.delivered),
        clickRate: pct(st.clicks, st.delivered),
        ctr: pct(st.clicks, st.opens),
        unsubRate: pct(st.unsubs, st.delivered),
        mqlRate: pct(st.mqls, st.delivered),
        sqlRate: pct(st.sqls, st.delivered),
        wonRevenue: st.wonRevenue,
      }
    }).sort((a, b) => b.members - a.members)

    const ns = newsletterStats
    const newsletter: StatsRow = {
      name: NEWSLETTER_NAME,
      members: newsletterMembers,
      sent: ns.sent, delivered: ns.delivered, opens: ns.opens, clicks: ns.clicks, bounces: ns.bounces,
      deliveryRate: pct(ns.delivered, ns.sent),
      openRate: pct(ns.opens, ns.delivered),
      clickRate: pct(ns.clicks, ns.delivered),
      ctr: pct(ns.clicks, ns.opens),
      unsubRate: pct(ns.unsubs, ns.delivered),
      mqlRate: pct(ns.mqls, ns.delivered),
      sqlRate: pct(ns.sqls, ns.delivered),
      wonRevenue: ns.wonRevenue,
    }

    const industries: StatsRow[] = industryRows.map(r => {
      const sent = Number(r.sent)
      const bounces = Number(r.bounces)
      const delivered = Math.max(0, sent - bounces)
      const mqls = Number(r.mqls)
      const sqls = Number(r.sqls)
      return {
        name: String(r.industry),
        members: Number(r.members),
        sent, delivered, opens: Number(r.opens), clicks: Number(r.clicks), bounces,
        deliveryRate: pct(delivered, sent),
        openRate: pct(Number(r.opens), delivered),
        clickRate: pct(Number(r.clicks), delivered),
        ctr: pct(Number(r.clicks), Number(r.opens)),
        unsubRate: pct(Number(r.unsubs), delivered),
        mqlRate: pct(mqls, delivered),
        sqlRate: pct(sqls, delivered),
        wonRevenue: Number(r.won_revenue ?? 0),
      }
    })

    return { segments, newsletter, industries, sfConnected: true, pardotConnected: true }
  } catch (e) {
    console.error('segments error:', e)
    return {
      segments: [], newsletter: emptyRow(NEWSLETTER_NAME, 0),
      industries: [], sfConnected: false, pardotConnected: false,
    }
  }
}

export default async function SegmentsPage({
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
  const data = await getSegmentsData(campaigns, dateRange)
  const isLive = data.pardotConnected || data.sfConnected

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Segments & Industries"
        subtitle={isLive ? 'Live BigQuery Data' : 'Performance breakdown by audience segment and account industry'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — configure <code>BQ_PROJECT_ID</code> and <code>BQ_DATASET_ID</code> to see live segment performance.</p>
          </div>
        )}

        <SegmentTables
          segments={data.segments}
          newsletter={data.newsletter}
          industries={data.industries}
        />
      </div>
    </div>
  )
}
