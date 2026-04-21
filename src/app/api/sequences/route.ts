import { NextRequest, NextResponse } from 'next/server'
import { getPardotCreds, getSfCreds, pardotGet, pardotStats, sfQuery, pct } from '@/lib/sf-api'
import { prisma } from '@/lib/prisma'

interface ListEmail {
  id?: number
  name?: string
  subject?: string
  sentAt?: string
  isSent?: boolean
  campaignId?: number
}

interface PardotCampaign {
  id?: number
  name?: string
}

interface TitleRecord {
  Normalize_Title_del__c: string
  expr0: number
}

async function getSignalThresholds() {
  try {
    const records = await prisma.benchmark.findMany({
      where: { metric: { in: ['signal_hot_threshold', 'signal_warm_threshold', 'signal_cold_threshold', 'signal_atrisk_bounce'] } },
    })
    const map = Object.fromEntries(records.map(b => [b.metric, b.warningThreshold ?? 0]))
    return {
      hot: map['signal_hot_threshold'] ?? 20,
      warm: map['signal_warm_threshold'] ?? 12,
      cold: map['signal_cold_threshold'] ?? 5,
      atRiskBounce: map['signal_atrisk_bounce'] ?? 5,
    }
  } catch {
    return { hot: 20, warm: 12, cold: 5, atRiskBounce: 5 }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const dateRange = searchParams.get('dateRange') ?? '30d'
  const segmentFilter = searchParams.get('segment') ?? ''

  const [pardotCreds, sfCreds, thresholds] = await Promise.all([
    getPardotCreds(),
    getSfCreds(),
    getSignalThresholds(),
  ])

  if (!pardotCreds) {
    return NextResponse.json({ sequences: [], subjectLines: [], prospectTitles: [], connected: false })
  }

  function signal(openRate: number, clickRate: number, bounceRate: number): string {
    if (bounceRate >= thresholds.atRiskBounce) return 'At Risk'
    if (openRate >= thresholds.hot) return 'Hot'
    if (openRate >= thresholds.warm) return 'Warm'
    if (openRate >= thresholds.cold) return 'Cold'
    return 'At Risk'
  }

  // Find the tkxel | Nurture campaign
  const campaignsData = await pardotGet<{ values?: PardotCampaign[] }>(
    pardotCreds,
    'campaigns?fields=id,name&limit=200'
  )
  const nurtureCampaign = (campaignsData?.values ?? []).find(
    c => c.name?.toLowerCase().includes('nurture')
  )
  const nurtureCampaignId = nurtureCampaign?.id

  const listEmailsData = await pardotGet<{ values?: ListEmail[] }>(
    pardotCreds,
    'list-emails?fields=id,name,subject,sentAt,isSent,campaignId&limit=200'
  )

  const allSentEmails = (listEmailsData?.values ?? [])
    .filter(e => e.isSent === true && e.id != null)
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))

  // Filter to nurture campaign only when a campaign ID is found
  const sentEmails = (nurtureCampaignId
    ? allSentEmails.filter(e => e.campaignId === nurtureCampaignId)
    : allSentEmails
  ).slice(0, 50)

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
      const ctr = pct(clicks, opens)
      const bounceRate = pct(bounces, sent)
      const unsubRate = pct(unsubs, delivered)

      return {
        id: e.id,
        name: e.subject ?? e.name ?? `Email ${e.id}`,
        segment: 'All Prospects',
        status: 'active',
        sent, delivered, opens, clicks, bounces, unsubs, spam,
        deliveryRate, openRate, clickRate, ctr, bounceRate, unsubRate,
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

  // Prospect title performance via Salesforce normalized title field
  let prospectTitles: Array<{
    title: string; delivered: number; opens: number; openRate: number
    clicks: number; clickRate: number; unsubs: number; bounces: number
  }> = []

  if (sfCreds) {
    const [totalResult, engagedResult] = await Promise.all([
      sfQuery<TitleRecord>(
        sfCreds,
        'SELECT Normalize_Title_del__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalize_Title_del__c != null GROUP BY Normalize_Title_del__c ORDER BY COUNT(Id) DESC LIMIT 20'
      ),
      sfQuery<TitleRecord>(
        sfCreds,
        'SELECT Normalize_Title_del__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalize_Title_del__c != null AND pi__score__c > 0 GROUP BY Normalize_Title_del__c ORDER BY COUNT(Id) DESC LIMIT 20'
      ),
    ])

    const engagedMap = Object.fromEntries(
      (engagedResult?.records ?? []).map(r => [r.Normalize_Title_del__c, r.expr0])
    )

    prospectTitles = (totalResult?.records ?? []).map(r => {
      const total = r.expr0
      const engaged = engagedMap[r.Normalize_Title_del__c] ?? 0
      return {
        title: r.Normalize_Title_del__c,
        delivered: total,
        opens: engaged,
        openRate: pct(engaged, total),
        clicks: 0,
        clickRate: 0,
        unsubs: 0,
        bounces: 0,
      }
    })
  }

  return NextResponse.json({ sequences, subjectLines, prospectTitles, connected: true })
}
