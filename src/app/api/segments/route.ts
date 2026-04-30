import { NextRequest, NextResponse } from 'next/server'
import {
  bqQuery, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR,
} from '@/lib/bigquery'

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

interface CampaignStatsRow {
  campaign_name: string
  sent: bigint | number
  opens: bigint | number
  clicks: bigint | number
  bounces: bigint | number
  unsubs: bigint | number
}

interface MemberCountRow { code: string; members: bigint | number }
interface IndustryRow { Industry: string; cnt: bigint | number }

export async function GET(_req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({
      segments: Object.values(SEGMENT_NAME_MAP).map(n => emptyRow(n, 0)),
      newsletter: emptyRow(NEWSLETTER_NAME, 0),
      industries: [],
      sfConnected: false,
      pardotConnected: false,
    })
  }

  // Email stats per NS-prefixed campaign
  const [campaignRows, memberRows, industryRows] = await Promise.all([
    bqQuery<CampaignStatsRow>(`
      SELECT
        campaign_name,
        ${EMAIL_SENT_EXPR}   AS sent,
        ${EMAIL_OPEN_EXPR}   AS opens,
        ${EMAIL_CLICK_EXPR}  AS clicks,
        ${EMAIL_BOUNCE_EXPR} AS bounces,
        ${EMAIL_UNSUB_EXPR}  AS unsubs
      FROM ${t('Pardot_userActivity')}
      WHERE campaign_name LIKE 'NS |%'
        AND campaign_name IS NOT NULL
      GROUP BY campaign_name
      HAVING ${EMAIL_SENT_EXPR} >= 10
    `),
    // Member counts per segment from Pardot_Prospects.pardot_segments
    bqQuery<MemberCountRow>(`
      SELECT
        TRIM(SPLIT(pardot_segments, ',')[OFFSET(0)]) AS code,
        COUNT(*) AS members
      FROM ${t('Pardot_Prospects')}
      WHERE pardot_segments IS NOT NULL AND pardot_segments != ''
      GROUP BY code
    `),
    bqQuery<IndustryRow>(`
      SELECT Industry, COUNT(*) AS cnt
      FROM ${t('Leads')}
      WHERE Industry IS NOT NULL AND Industry != ''
      GROUP BY Industry
      ORDER BY cnt DESC
      LIMIT 20
    `),
  ])

  // Build member count map: code → count
  const memberMap = new Map<string, number>()
  for (const r of memberRows) {
    memberMap.set(String(r.code), Number(r.members))
  }

  // Aggregate campaign stats per segment code
  const segStats: Record<string, { sent: number; delivered: number; opens: number; clicks: number; bounces: number; unsubs: number }> = {}
  for (const code of SEGMENT_CODE_ORDER) {
    segStats[code] = { sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 }
  }

  for (const r of campaignRows) {
    const code = extractSegmentCode(r.campaign_name)
    if (!code || !segStats[code]) continue
    const sent = Number(r.sent)
    const bounces = Number(r.bounces)
    segStats[code].sent += sent
    segStats[code].delivered += Math.max(0, sent - bounces)
    segStats[code].opens += Number(r.opens)
    segStats[code].clicks += Number(r.clicks)
    segStats[code].bounces += bounces
    segStats[code].unsubs += Number(r.unsubs)
  }

  const segments: StatsRow[] = SEGMENT_CODE_ORDER.map(code => {
    const name = SEGMENT_NAME_MAP[code] ?? code
    const members = memberMap.get(code) ?? 0
    const st = segStats[code]
    if (!st || st.sent === 0) return emptyRow(name, members)
    return {
      name, members,
      sent: st.sent, delivered: st.delivered, opens: st.opens, clicks: st.clicks, bounces: st.bounces,
      deliveryRate: pct(st.delivered, st.sent),
      openRate: pct(st.opens, st.delivered),
      clickRate: pct(st.clicks, st.delivered),
      ctr: pct(st.clicks, st.opens),
      unsubRate: pct(st.unsubs, st.delivered),
      mqlRate: 0, sqlRate: 0, wonRevenue: 0,
    }
  }).sort((a, b) => b.members - a.members)

  const newsletterMembers = memberMap.get('Nurture & Future Interest') ?? memberMap.get('newsletter') ?? 0
  const newsletter = emptyRow(NEWSLETTER_NAME, newsletterMembers)

  const industries: StatsRow[] = industryRows.map(r => emptyRow(String(r.Industry), Number(r.cnt)))

  return NextResponse.json({ segments, newsletter, industries, sfConnected: true, pardotConnected: true })
}
