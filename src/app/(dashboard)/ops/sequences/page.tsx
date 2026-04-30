import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import {
  bqQuery, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR, EMAIL_SPAM_EXPR,
  campaignSqlFilter,
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
  sent: bigint | number; opens: bigint | number; clicks: bigint | number
  bounces: bigint | number; unsubs: bigint | number; spam: bigint | number
  min_created_at: string
}

interface ProspectRow { job_title: string; score: number }

async function getSequencesData(campaigns: string[]) {
  try {
    if (!isConfigured()) return { sequences: [], subjectLines: [], prospectTitles: [], connected: false }

    const campaignFilter = campaigns.length > 0
      ? campaignSqlFilter(campaigns)
      : `AND NOT (
            LOWER(campaign_name) LIKE '%copy%'
            OR LOWER(campaign_name) LIKE '% test%'
            OR LOWER(campaign_name) LIKE '%testing%'
          )`

    const [thresholds, campaignRows, prospectRows] = await Promise.all([
      getSignalThresholds(),
      bqQuery<CampaignRow>(`
        SELECT
          campaign_name,
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
        GROUP BY campaign_name
        HAVING ${EMAIL_SENT_EXPR} >= 10
        ORDER BY opens DESC
        LIMIT 200
      `),
      bqQuery<ProspectRow>(`
        SELECT job_title, COALESCE(score, 0) AS score
        FROM ${t('Pardot_Prospects')}
        WHERE job_title IS NOT NULL AND job_title != ''
        LIMIT 1000
      `),
    ])

    function signal(openRate: number, bounceRate: number): string {
      if (bounceRate >= thresholds.atRiskBounce) return 'At Risk'
      if (openRate >= thresholds.hot) return 'Hot'
      if (openRate >= thresholds.warm) return 'Warm'
      if (openRate >= thresholds.cold) return 'Cold'
      return 'At Risk'
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
      return {
        id: undefined as number | undefined,
        name: r.campaign_name,
        subject: r.campaign_name,
        segmentCode,
        segment: SEGMENT_NAME_MAP[segmentCode] ?? segmentCode,
        emailNumber: extractEmailNumber(r.campaign_name),
        status: 'active',
        sent, delivered, opens, clicks, bounces, unsubs, spam,
        deliveryRate, openRate, clickRate, ctr, bounceRate, unsubRate,
        mqlRate: 0, sqlRate: 0, wonRevenue: 0,
        signal: signal(openRate, bounceRate),
        sentAt: r.min_created_at,
      }
    })

    const nsOnly = allSequences.filter(s => s.name.startsWith('NS |'))
    const sequences = (nsOnly.length > 0 ? nsOnly : allSequences).sort((a, b) => b.openRate - a.openRate)

    const subjectLines = [...sequences]
      .sort((a, b) => b.opens - a.opens)
      .slice(0, 20)
      .map(s => ({
        subject: s.subject || s.name, delivered: s.delivered, opens: s.opens,
        openRate: s.openRate, clicks: s.clicks, clickRate: s.clickRate,
        unsubs: s.unsubs, bounces: s.bounces,
      }))

    const titleMap: Record<string, { delivered: number; opens: number; clicks: number }> = {}
    for (const p of prospectRows) {
      const title = (p.job_title ?? '').trim() || 'Unknown'
      if (!titleMap[title]) titleMap[title] = { delivered: 0, opens: 0, clicks: 0 }
      titleMap[title].delivered++
      if (Number(p.score) > 50) titleMap[title].opens++
      if (Number(p.score) > 100) titleMap[title].clicks++
    }

    const prospectTitles = Object.entries(titleMap)
      .map(([title, v]) => ({
        title, delivered: v.delivered, opens: v.opens,
        openRate: pct(v.opens, v.delivered),
        clicks: v.clicks, clickRate: pct(v.clicks, v.delivered),
        unsubs: 0, bounces: 0,
      }))
      .sort((a, b) => b.delivered - a.delivered)
      .slice(0, 15)

    return { sequences, subjectLines, prospectTitles, connected: true }
  } catch (e) {
    console.error('sequences error:', e)
    return { sequences: [], subjectLines: [], prospectTitles: [], connected: false }
  }
}

export default async function SequencesPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string | string[] }>
}) {
  const session = await auth()
  const params = await searchParams
  const campaigns = params.campaign
    ? (Array.isArray(params.campaign) ? params.campaign : [params.campaign])
    : []
  const data = await getSequencesData(campaigns)
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
