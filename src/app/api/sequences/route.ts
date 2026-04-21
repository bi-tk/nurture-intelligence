import { NextResponse } from 'next/server'
import { getPardotCreds, pardotGet, pardotStats, pct } from '@/lib/sf-api'

interface ListEmail {
  id?: number
  name?: string
  subject?: string
  sentAt?: string
  isSent?: boolean
  campaignId?: number
}

interface ListEmailsResponse {
  values?: ListEmail[]
}

function signal(openRate: number, clickRate: number, bounceRate: number): string {
  if (openRate >= 25 && clickRate >= 5) return 'Hot'
  if (openRate >= 15 || clickRate >= 3) return 'Warm'
  if (bounceRate >= 5) return 'At Risk'
  return 'Cold'
}

export async function GET() {
  const pardotCreds = await getPardotCreds()
  if (!pardotCreds) {
    return NextResponse.json({ sequences: [], connected: false })
  }

  const listEmailsData = await pardotGet<ListEmailsResponse>(
    pardotCreds,
    'list-emails?fields=id,name,subject,sentAt,isSent,campaignId&limit=200'
  )

  const sentEmails = (listEmailsData?.values ?? [])
    .filter(e => e.isSent === true && e.id != null)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
    .slice(0, 50)

  const statsResults = await Promise.all(
    sentEmails.map(e => pardotStats(pardotCreds, e.id!))
  )

  const sequences = sentEmails
    .map((e, i) => {
      const s = statsResults[i]
      if (!s) return null
      const sent = s.sent ?? 0
      const delivered = s.delivered ?? 0
      const opens = s.uniqueOpens ?? 0
      const clicks = s.uniqueClicks ?? 0
      const bounces = (s.hardBounced ?? 0) + (s.softBounced ?? 0)
      const unsubs = s.optOuts ?? 0
      const spam = s.spamComplaints ?? 0

      const deliveryRate = pct(delivered, sent)
      const openRate = pct(opens, delivered)
      const clickRate = pct(clicks, delivered)
      const ctor = pct(clicks, opens)
      const bounceRate = pct(bounces, sent)
      const unsubRate = pct(unsubs, delivered)

      return {
        id: e.id,
        name: e.subject ?? e.name ?? `Email ${e.id}`,
        segment: 'All Prospects',
        status: 'active',
        sent, delivered, opens, clicks, bounces, unsubs, spam,
        deliveryRate, openRate, clickRate, ctor, bounceRate, unsubRate,
        mqlRate: 0, sqlRate: 0, wonRevenue: 0,
        signal: signal(openRate, clickRate, bounceRate),
        sentAt: e.sentAt,
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.openRate - a.openRate)

  const subjectLines = [...sequences]
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 20)
    .map(s => ({
      subject: s.name,
      delivered: s.delivered,
      opens: s.opens,
      openRate: s.openRate,
      clicks: s.clicks,
      clickRate: s.clickRate,
      unsubs: s.unsubs,
      bounces: s.bounces,
    }))

  return NextResponse.json({ sequences, subjectLines, connected: true })
}
