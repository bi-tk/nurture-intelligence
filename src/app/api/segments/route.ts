import { NextRequest, NextResponse } from 'next/server'
import { getPardotCreds, getSfCreds, pardotGet, sfQuery } from '@/lib/sf-api'

const NURTURE_LISTS = [
  { id: 338651, name: 'Nurture | CIOs & Tech Leaders | Non-Tech | $50–$500M' },
  { id: 338939, name: 'Nurture | CEOs & Non-Tech Leaders | Non-Tech' },
  { id: 412789, name: 'Nurture | CEOs & Non-Tech Leaders | Tech | Under $50M' },
  { id: 412798, name: 'Nurture | CTOs & Tech Leaders | Tech | Under $50M' },
  { id: 412807, name: 'Nurture | CTOs & Tech Leaders | Funded Tech Startups' },
  { id: 412810, name: 'Nurture | Managing Partners | Private Equity' },
  { id: 509437, name: 'Nurture | CIOs & Tech Leaders | Non-Tech | Under $50M new' },
  { id: 619875, name: 'Nurture & Future Interest' },
]

interface ListMembership { id?: number }
interface IndustryRecord { Normalized_Industry__c: string; expr0: number }

type SegmentRow = {
  name: string
  sent: number; delivered: number; opens: number; clicks: number; bounces: number
  deliveryRate: number; openRate: number; clickRate: number; ctr: number
  unsubRate: number; mqlRate: number; sqlRate: number; wonRevenue: number
}

export async function GET(req: NextRequest) {
  const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])

  // Count members for each nurture list via list-memberships (parallel)
  const memberCounts = pardotCreds
    ? await Promise.all(
        NURTURE_LISTS.map(list =>
          pardotGet<{ values?: ListMembership[] }>(
            pardotCreds,
            `list-memberships?fields=id&listId=${list.id}&limit=1000`
          ).then(res => res?.values?.length ?? 0)
        )
      )
    : NURTURE_LISTS.map(() => 0)

  const segments: SegmentRow[] = NURTURE_LISTS
    .map((list, i) => ({
      name: list.name,
      delivered: memberCounts[i],
      sent: 0, opens: 0, clicks: 0, bounces: 0,
      deliveryRate: 0, openRate: 0, clickRate: 0, ctr: 0,
      unsubRate: 0, mqlRate: 0, sqlRate: 0, wonRevenue: 0,
    }))
    .sort((a, b) => b.delivered - a.delivered)

  // Salesforce industry breakdown from nurture leads
  const industryResult = sfCreds
    ? await sfQuery<IndustryRecord>(
        sfCreds,
        'SELECT Normalized_Industry__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalized_Industry__c != null GROUP BY Normalized_Industry__c ORDER BY COUNT(Id) DESC LIMIT 20'
      )
    : null

  const industries: SegmentRow[] = (industryResult?.records ?? []).map(r => ({
    name: r.Normalized_Industry__c,
    delivered: r.expr0,
    sent: 0, opens: 0, clicks: 0, bounces: 0,
    deliveryRate: 0, openRate: 0, clickRate: 0, ctr: 0,
    unsubRate: 0, mqlRate: 0, sqlRate: 0, wonRevenue: 0,
  }))

  return NextResponse.json({
    segments,
    industries,
    sfConnected: !!sfCreds,
    pardotConnected: !!pardotCreds,
  })
}
