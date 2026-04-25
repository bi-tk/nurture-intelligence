import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { getPardotCreds, pardotGet, pardotStats, pct } from '@/lib/sf-api'
import { prisma } from '@/lib/prisma'
import SequencesTables from '@/components/tables/SequencesTables'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SEGMENT_CODE_TO_LIST_ID: Record<string, number> = {
  CIO_NT_MM: 338651,
  CEO_NT: 338939,
  CEO_T_U50: 412789,
  CTO_T_U50: 412798,
  CTO_FTS: 412807,
  PE_MP: 412810,
  CIO_NT_U50: 509437,
}

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
    if (SEGMENT_CODE_TO_LIST_ID[code] !== undefined) return code
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

interface ListEmail { id?: number; name?: string; subject?: string; sentAt?: string; isSent?: boolean }
interface PardotProspect { id?: number; jobTitle?: string; score?: number }

async function getSignalThresholds() {
  try {
    const records = await prisma.benchmark.findMany({
      where: { metric: { in: ['signal_hot_threshold', 'signal_warm_threshold', 'signal_cold_threshold', 'signal_atrisk_bounce'] } },
    })
    const map = Object.fromEntries(records.map(b => [b.metric, b.warningThreshold ?? 0]))
    return { hot: map['signal_hot_threshold'] ?? 20, warm: map['signal_warm_threshold'] ?? 12, cold: map['signal_cold_threshold'] ?? 5, atRiskBounce: map['signal_atrisk_bounce'] ?? 5 }
  } catch {
    return { hot: 20, warm: 12, cold: 5, atRiskBounce: 5 }
  }
}

async function getSequencesData() {
  try {
    const [creds, thresholds] = await Promise.all([getPardotCreds(), getSignalThresholds()])
    if (!creds) return { sequences: [], subjectLines: [], prospectTitles: [], connected: false }

    function signal(openRate: number, bounceRate: number): string {
      if (bounceRate >= thresholds.atRiskBounce) return 'At Risk'
      if (openRate >= thresholds.hot) return 'Hot'
      if (openRate >= thresholds.warm) return 'Warm'
      if (openRate >= thresholds.cold) return 'Cold'
      return 'At Risk'
    }

    const [listEmailsData, prospectData] = await Promise.all([
      pardotGet<{ values?: ListEmail[] }>(creds, 'list-emails?fields=id,name,subject,sentAt,isSent&limit=200'),
      pardotGet<{ values?: PardotProspect[] }>(creds, 'prospects?fields=id,jobTitle,score&limit=1000'),
    ])

    const nsEmails = (listEmailsData?.values ?? [])
      .filter(e => {
        if (e.isSent !== true || e.id == null) return false
        const n = e.name ?? ''
        const nLower = n.toLowerCase()
        if (nLower.includes('copy') || nLower.includes(' test') || nLower.includes('testing')) return false
        return extractSegmentCode(n) !== null
      })
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
      .slice(0, 100)

    const statsResults = await Promise.all(nsEmails.map(e => pardotStats(creds, e.id!)))

    const sequences = nsEmails
      .map((e, i) => {
        const s = statsResults[i]
        if (!s) return null
        const sent = s.sent ?? 0
        if (sent < 10) return null
        const segmentCode = extractSegmentCode(e.name ?? '') ?? ''
        const delivered = s.delivered ?? 0
        const opens = s.uniqueOpens ?? 0
        const clicks = s.uniqueClicks ?? 0
        const bounces = (s.hardBounced ?? 0) + (s.softBounced ?? 0)
        const unsubs = s.optOuts ?? 0
        const spam = s.spamComplaints ?? 0
        const deliveryRate = pct(delivered, sent)
        const openRate = pct(opens, delivered)
        const clickRate = pct(clicks, delivered)
        const ctr = pct(clicks, opens)
        const bounceRate = pct(bounces, sent)
        const unsubRate = pct(unsubs, delivered)
        return {
          id: e.id,
          name: e.name ?? `Email ${e.id}`,
          subject: e.subject ?? '',
          segmentCode,
          segment: SEGMENT_NAME_MAP[segmentCode] ?? segmentCode,
          emailNumber: extractEmailNumber(e.name ?? ''),
          status: 'active',
          sent, delivered, opens, clicks, bounces, unsubs, spam,
          deliveryRate, openRate, clickRate, ctr, bounceRate, unsubRate,
          mqlRate: 0, sqlRate: 0, wonRevenue: 0,
          signal: signal(openRate, bounceRate),
          sentAt: e.sentAt,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.openRate - a.openRate)

    const subjectLines = [...sequences]
      .sort((a, b) => b.opens - a.opens)
      .slice(0, 20)
      .map(s => ({
        subject: s.subject || s.name, delivered: s.delivered, opens: s.opens,
        openRate: s.openRate, clicks: s.clicks, clickRate: s.clickRate,
        unsubs: s.unsubs, bounces: s.bounces,
      }))

    const prospects = prospectData?.values ?? []
    const titleMap: Record<string, { delivered: number; opens: number; clicks: number }> = {}
    for (const p of prospects) {
      const title = p.jobTitle?.trim() || 'Unknown'
      if (!titleMap[title]) titleMap[title] = { delivered: 0, opens: 0, clicks: 0 }
      titleMap[title].delivered++
      if ((p.score ?? 0) > 50) titleMap[title].opens++
      if ((p.score ?? 0) > 100) titleMap[title].clicks++
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

export default async function SequencesPage() {
  const session = await auth()
  const data = await getSequencesData()
  const isLive = data.connected

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Sequence Performance"
        subtitle={isLive ? 'Live Pardot Data' : 'Email engagement, deliverability, and funnel conversion by sequence'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-8">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — <a href="/admin/integrations" className="underline">connect Salesforce &amp; Pardot to see sequence performance</a>.</p>
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
