import { NextRequest, NextResponse } from 'next/server'
import { getPardotCreds, getSfCreds, pardotGet, sfQuery, pct } from '@/lib/sf-api'

const NURTURE_SEGMENT_KEYWORDS = [
  'CIOs and Tech Leaders of Non-Tech',
  'CEOs and Non-Tech Leaders of Non-Tech',
  'Managing Partners in Private Equity',
  'CTOs and Technology Leaders of Tech',
  'CTOs and Tech Leaders of Funded Tech',
  'CIOs and Tech Leaders of Non-Tech Businesses With Under',
  'CEOs and Non-Tech Leaders of Tech Businesses',
]

interface PardotList {
  id?: number
  name?: string
  title?: string
  description?: string
}

interface ListMembership {
  id?: number
}

interface IndustryRecord {
  Normalized_Industry__c: string
  expr0: number
}

type SegmentRow = {
  name: string
  sent: number; delivered: number; opens: number; clicks: number; bounces: number
  deliveryRate: number; openRate: number; clickRate: number; ctr: number
  unsubRate: number; mqlRate: number; sqlRate: number; wonRevenue: number
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const dateRange = searchParams.get('dateRange') ?? '30d'

  const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])

  // ── Pardot lists — match against the 7 nurture segments ──────────────────────
  const listData = pardotCreds
    ? await pardotGet<{ values?: PardotList[] }>(pardotCreds, 'lists?fields=id,name,title,description&limit=200')
    : null

  const allLists = listData?.values ?? []

  const nurtureLists = allLists.filter(l => {
    const listName = l.name ?? l.title ?? ''
    return NURTURE_SEGMENT_KEYWORDS.some(kw => listName.includes(kw.substring(0, 20)))
  })

  // Get member counts via list-memberships
  const memberCounts = pardotCreds && nurtureLists.length
    ? await Promise.all(
        nurtureLists.map(async l => {
          const data = await pardotGet<{ values?: ListMembership[] }>(
            pardotCreds,
            `list-memberships?fields=id&listId=${l.id}&limit=1000`
          )
          return { listId: l.id, count: (data?.values ?? []).length }
        })
      )
    : []

  const memberCountMap = Object.fromEntries(memberCounts.map(m => [m.listId, m.count]))

  const makeEmptyRow = (name: string, delivered: number): SegmentRow => ({
    name, delivered,
    sent: 0, opens: 0, clicks: 0, bounces: 0,
    deliveryRate: 0, openRate: 0, clickRate: 0, ctr: 0,
    unsubRate: 0, mqlRate: 0, sqlRate: 0, wonRevenue: 0,
  })

  const segments: SegmentRow[] = nurtureLists.length
    ? nurtureLists
        .map(l => makeEmptyRow(l.name ?? l.title ?? `List ${l.id}`, memberCountMap[l.id ?? 0] ?? 0))
        .sort((a, b) => b.delivered - a.delivered)
    : allLists
        .slice(0, 10)
        .map(l => makeEmptyRow(l.name ?? l.title ?? `List ${l.id}`, 0))

  // ── Salesforce industry breakdown from nurture leads ──────────────────────────
  const industryResult = sfCreds
    ? await sfQuery<IndustryRecord>(
        sfCreds,
        'SELECT Normalized_Industry__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalized_Industry__c != null GROUP BY Normalized_Industry__c ORDER BY COUNT(Id) DESC LIMIT 20'
      )
    : null

  const industries: SegmentRow[] = (industryResult?.records ?? []).map(r =>
    makeEmptyRow(r.Normalized_Industry__c, r.expr0)
  )

  return NextResponse.json({
    segments,
    industries,
    sfConnected: !!sfCreds,
    pardotConnected: !!pardotCreds,
  })
}
