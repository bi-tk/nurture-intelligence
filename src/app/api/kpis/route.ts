import { NextResponse } from 'next/server'
import {
  bqQuery, bqCount, bqSum, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR, EMAIL_SPAM_EXPR,
  leadsCampaignFilter, mqlCountSql,
} from '@/lib/bigquery'

interface EmailStatsRow {
  sent: bigint | number
  opens: bigint | number
  clicks: bigint | number
  bounces: bigint | number
  unsubs: bigint | number
  spam: bigint | number
}

const ZERO = {
  period: 'All Time',
  nurtureCount: 0, mqls: 0, sqls: 0, discoveryCalls: 0,
  opportunities: 0, wonOpportunities: 0,
  wonRevenue: 0, pipelineValue: 0, opportunitiesCreated: 0,
  emailsSent: 0, deliveryRate: 0, uniqueOpenRate: 0, uniqueClickRate: 0,
  bounceRate: 0, unsubscribeRate: 0, spamRate: 0,
  opensCount: 0, clicksCount: 0, unsubscribesCount: 0, bouncesCount: 0, spamCount: 0,
  totalAudience: 0, engagedAudience: 0, engagedRate: 0,
  prospectsOpenedAny: 0, prospectsClickedAny: 0, prospectsNoEngagement: 0,
  sfConnected: false, pardotConnected: false,
}

export async function GET() {
  if (!isConfigured()) return NextResponse.json(ZERO)

  const sfFilter = leadsCampaignFilter([])

  const [nurtureCount, mqlCount, sqlCount, discoveryCount, wonRevenue, pipelineValue, opportunitiesCreated] =
    await Promise.all([
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Marketing_nurture__c = TRUE ${sfFilter}`),
      bqCount(mqlCountSql([])),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE SQL__c = TRUE ${sfFilter}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE Discovery_Call__c = TRUE ${sfFilter}`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter}`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsClosed = FALSE ${sfFilter}`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter}`),
    ])

  const [wonOpportunities, opportunities] = await Promise.all([
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsWon = TRUE ${sfFilter}`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads_Opp_Joined')} WHERE IsConverted = TRUE ${sfFilter}`),
  ])

  const [emailRows, totalAudience, engagedCount] = await Promise.all([
    bqQuery<EmailStatsRow>(`
      SELECT
        ${EMAIL_SENT_EXPR}   AS sent,
        ${EMAIL_OPEN_EXPR}   AS opens,
        ${EMAIL_CLICK_EXPR}  AS clicks,
        ${EMAIL_BOUNCE_EXPR} AS bounces,
        ${EMAIL_UNSUB_EXPR}  AS unsubs,
        ${EMAIL_SPAM_EXPR}   AS spam
      FROM ${t('Pardot_userActivity')}
    `),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}`),
    bqCount(`
      SELECT COUNT(*) AS n FROM ${t('Pardot_Prospects')}
      WHERE SAFE_CAST(last_activity_at AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    `),
  ])

  const es = emailRows[0]
  const totalSent = Number(es?.sent ?? 0)
  const totalOpens = Number(es?.opens ?? 0)
  const totalClicks = Number(es?.clicks ?? 0)
  const totalBounces = Number(es?.bounces ?? 0)
  const totalUnsubs = Number(es?.unsubs ?? 0)
  const totalSpam = Number(es?.spam ?? 0)
  const totalDelivered = Math.max(0, totalSent - totalBounces)

  const engagedAudience = engagedCount
  const prospectsNoEngagement = Math.max(0, totalAudience - engagedAudience)
  const engagedRate = pct(engagedAudience, totalAudience)
  const prospectsClickedAny = Math.round(engagedAudience * pct(totalClicks, totalOpens) / 100)

  return NextResponse.json({
    period: 'All Time',
    nurtureCount, mqls: mqlCount, sqls: sqlCount, discoveryCalls: discoveryCount,
    opportunities, wonOpportunities,
    wonRevenue, pipelineValue, opportunitiesCreated,
    emailsSent: totalSent,
    deliveryRate: pct(totalDelivered, totalSent),
    uniqueOpenRate: pct(totalOpens, totalDelivered),
    uniqueClickRate: pct(totalClicks, totalDelivered),
    bounceRate: pct(totalBounces, totalSent),
    unsubscribeRate: pct(totalUnsubs, totalDelivered),
    spamRate: pct(totalSpam, totalDelivered),
    opensCount: totalOpens,
    clicksCount: totalClicks,
    unsubscribesCount: totalUnsubs,
    bouncesCount: totalBounces,
    spamCount: totalSpam,
    totalAudience, engagedAudience, engagedRate,
    prospectsOpenedAny: engagedAudience,
    prospectsClickedAny,
    prospectsNoEngagement,
    sfConnected: true,
    pardotConnected: true,
  })
}
