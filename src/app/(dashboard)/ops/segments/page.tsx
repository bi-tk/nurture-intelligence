import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { getPardotCreds, getSfCreds, sfQuery, pardotGet, pardotStats, pct, type PardotCreds } from '@/lib/sf-api'
import SegmentTables from '@/components/tables/SegmentTables'

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

const MEMBER_COUNTS: Record<number, number> = {
  338651: 97,
  338939: 1780,
  412789: 250,
  412798: 38,
  412807: 5,
  412810: 50,
  509437: 228,
  619875: 3973,
}

const NEWSLETTER_LIST = { id: 619875, name: 'Nurture & Future Interest' }

function extractSegmentCode(name: string): string | null {
  const parts = name.split(' | ')
  if (parts.length >= 2 && parts[0].trim() === 'NS') {
    const code = parts[1].trim()
    if (SEGMENT_CODE_TO_LIST_ID[code] !== undefined) return code
  }
  return null
}

interface ListEmail { id?: number; name?: string; sentAt?: string; isSent?: boolean }
interface IndustryRecord { Industry: string; expr0: number }

type StatsRow = {
  name: string; members: number
  sent: number; delivered: number; opens: number; clicks: number; bounces: number
  deliveryRate: number; openRate: number; clickRate: number; ctr: number
  unsubRate: number; mqlRate: number; sqlRate: number; wonRevenue: number
}

function emptyRow(name: string, members: number): StatsRow {
  return { name, members, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, deliveryRate: 0, openRate: 0, clickRate: 0, ctr: 0, unsubRate: 0, mqlRate: 0, sqlRate: 0, wonRevenue: 0 }
}

async function getMemberCount(creds: PardotCreds, listId: number): Promise<number> {
  try {
    const { countListMembers } = await import('@/lib/sf-api')
    const count = await Promise.race([
      countListMembers(creds, listId),
      new Promise<number>(resolve => setTimeout(() => resolve(0), 5000)),
    ])
    return count > 0 ? count : (MEMBER_COUNTS[listId] ?? 0)
  } catch {
    return MEMBER_COUNTS[listId] ?? 0
  }
}

async function getSegmentsData() {
  try {
    const [pardotCreds, sfCreds] = await Promise.all([getPardotCreds(), getSfCreds()])

    if (!pardotCreds) {
      const industryResult = sfCreds
        ? await sfQuery<IndustryRecord>(sfCreds, 'SELECT Industry, COUNT(Id) FROM Lead WHERE Industry != null GROUP BY Industry ORDER BY COUNT(Id) DESC LIMIT 20')
        : null
      const segments = Object.entries(SEGMENT_NAME_MAP).map(([code, name]) =>
        emptyRow(name, MEMBER_COUNTS[SEGMENT_CODE_TO_LIST_ID[code]] ?? 0)
      )
      return {
        segments,
        newsletter: emptyRow(NEWSLETTER_LIST.name, 0),
        industries: (industryResult?.records ?? []).map(r => emptyRow(r.Industry, r.expr0)),
        sfConnected: !!sfCreds, pardotConnected: false,
      }
    }

    const listEmailsData = await pardotGet<{ values?: ListEmail[] }>(
      pardotCreds, 'list-emails?fields=id,name,sentAt,isSent&limit=200'
    )

    // Filter to NS emails only
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

    const statsResults = await Promise.all(nsEmails.map(e => pardotStats(pardotCreds, e.id!)))

    // Aggregate per segment code
    const segmentStats: Record<string, { sent: number; delivered: number; opens: number; clicks: number; bounces: number; unsubs: number }> = {}
    for (const code of Object.keys(SEGMENT_CODE_TO_LIST_ID)) {
      segmentStats[code] = { sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 }
    }
    for (const [i, e] of nsEmails.entries()) {
      const code = extractSegmentCode(e.name ?? '')
      if (!code) continue
      const s = statsResults[i]
      if (!s) continue
      const emailSent = s.sent ?? 0
      if (emailSent < 10) continue
      segmentStats[code].sent += emailSent
      segmentStats[code].delivered += s.delivered ?? 0
      segmentStats[code].opens += s.uniqueOpens ?? 0
      segmentStats[code].clicks += s.uniqueClicks ?? 0
      segmentStats[code].bounces += (s.hardBounced ?? 0) + (s.softBounced ?? 0)
      segmentStats[code].unsubs += s.optOuts ?? 0
    }

    const allListIds = [...Object.values(SEGMENT_CODE_TO_LIST_ID), NEWSLETTER_LIST.id]
    const [memberCountArr, industryResult] = await Promise.all([
      Promise.all(allListIds.map(id => getMemberCount(pardotCreds, id))),
      sfCreds
        ? sfQuery<IndustryRecord>(sfCreds, 'SELECT Industry, COUNT(Id) FROM Lead WHERE Industry != null GROUP BY Industry ORDER BY COUNT(Id) DESC LIMIT 20')
        : Promise.resolve(null),
    ])
    const memberCountMap = new Map(allListIds.map((id, i) => [id, memberCountArr[i]]))

    const segments: StatsRow[] = Object.entries(SEGMENT_CODE_TO_LIST_ID)
      .map(([code, listId]) => {
        const st = segmentStats[code]
        const members = memberCountMap.get(listId) ?? MEMBER_COUNTS[listId] ?? 0
        const name = SEGMENT_NAME_MAP[code] ?? code
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
      })
      .sort((a, b) => b.members - a.members)

    const newsletter: StatsRow = emptyRow(
      NEWSLETTER_LIST.name,
      memberCountMap.get(NEWSLETTER_LIST.id) ?? MEMBER_COUNTS[NEWSLETTER_LIST.id] ?? 0
    )

    const industries: StatsRow[] = (industryResult?.records ?? []).map(r => emptyRow(r.Industry, r.expr0))

    return { segments, newsletter, industries, sfConnected: !!sfCreds, pardotConnected: true }
  } catch (e) {
    console.error('segments error:', e)
    return {
      segments: [], newsletter: emptyRow(NEWSLETTER_LIST.name, 0),
      industries: [], sfConnected: false, pardotConnected: false,
    }
  }
}

export default async function SegmentsPage() {
  const session = await auth()
  const data = await getSegmentsData()
  const isLive = data.pardotConnected || data.sfConnected

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Segments & Industries"
        subtitle={isLive ? 'Live Pardot & Salesforce Data' : 'Performance breakdown by audience segment and account industry'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-6">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — <a href="/admin/integrations" className="underline">connect Salesforce &amp; Pardot to see live segment performance</a>.</p>
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
