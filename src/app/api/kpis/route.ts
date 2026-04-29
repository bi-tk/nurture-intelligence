import { NextResponse } from 'next/server'
import {
  bqQuery, bqCount, bqSum, t, pct, isConfigured,
  EMAIL_SENT_EXPR, EMAIL_OPEN_EXPR, EMAIL_CLICK_EXPR,
  EMAIL_BOUNCE_EXPR, EMAIL_UNSUB_EXPR, EMAIL_SPAM_EXPR,
  IS_EMAIL_OPEN, IS_EMAIL_CLICK,
} from '@/lib/bigquery'

interface OppRow { StageName: string; Amount: number }
interface EmailStatsRow {
  sent: bigint | number
  opens: bigint | number
  unique_opens: bigint | number
  clicks: bigint | number
  unique_clicks: bigint | number
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

  const [nurtureCount, mqlCount, sqlCount, discoveryCount, oppRows, wonRevenue, pipelineValue, newOpps] =
    await Promise.all([
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE Marketing_nurture__c = TRUE`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE MQL_Response__c = TRUE`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE SQL__c = TRUE`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE Discovery_Call__c = TRUE`),
      bqQuery<OppRow>(`SELECT StageName, Amount FROM ${t('Opportunities')} WHERE IsClosed = FALSE AND Amount IS NOT NULL`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Opportunities')} WHERE IsWon = TRUE AND IsClosed = TRUE AND Amount < 10000000`),
      bqSum(`SELECT SUM(Amount) AS n FROM ${t('Opportunities')} WHERE IsClosed = FALSE`),
      bqCount(`SELECT COUNT(*) AS n FROM ${t('Opportunities')} WHERE FORMAT_DATE('%Y-%m', DATE(CreatedDate)) = FORMAT_DATE('%Y-%m', CURRENT_DATE())`),
    ])

  const wonOpportunities = oppRows.filter(r => r.StageName === 'Closed Won').length
  const opportunities = oppRows.length

  const [emailRows, totalAudience, engagedCount] = await Promise.all([
    bqQuery<EmailStatsRow>(`
      SELECT
        ${EMAIL_SENT_EXPR}   AS sent,
        ${EMAIL_OPEN_EXPR}   AS opens,
        COUNT(DISTINCT IF(${IS_EMAIL_OPEN},  prospect_id, NULL)) AS unique_opens,
        ${EMAIL_CLICK_EXPR}  AS clicks,
        COUNT(DISTINCT IF(${IS_EMAIL_CLICK}, prospect_id, NULL)) AS unique_clicks,
        ${EMAIL_BOUNCE_EXPR} AS bounces,
        ${EMAIL_UNSUB_EXPR}  AS unsubs,
        ${EMAIL_SPAM_EXPR}   AS spam
      FROM ${t('pardot_userActivities')}
    `),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('pardot_prospects')}`),
    bqCount(`
      SELECT COUNT(*) AS n FROM ${t('pardot_prospects')}
      WHERE SAFE_CAST(last_activity_at AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    `),
  ])

  const es = emailRows[0]
  const totalSent = Number(es?.sent ?? 0)
  const totalUniqueOpens = Number(es?.unique_opens ?? 0)
  const totalUniqueClicks = Number(es?.unique_clicks ?? 0)
  const totalBounces = Number(es?.bounces ?? 0)
  const totalUnsubs = Number(es?.unsubs ?? 0)
  const totalSpam = Number(es?.spam ?? 0)
  const totalDelivered = Math.max(0, totalSent - totalBounces)

  const engagedAudience = engagedCount
  const prospectsNoEngagement = Math.max(0, totalAudience - engagedAudience)
  const engagedRate = pct(engagedAudience, totalAudience)
  const prospectsClickedAny = Math.round(engagedAudience * pct(totalUniqueClicks, totalUniqueOpens) / 100)

  return NextResponse.json({
    period: 'All Time',
    nurtureCount, mqls: mqlCount, sqls: sqlCount, discoveryCalls: discoveryCount,
    opportunities, wonOpportunities,
    wonRevenue, pipelineValue, opportunitiesCreated: newOpps,
    emailsSent: totalSent,
    deliveryRate: pct(totalDelivered, totalSent),
    uniqueOpenRate: pct(totalUniqueOpens, totalDelivered),
    uniqueClickRate: pct(totalUniqueClicks, totalDelivered),
    bounceRate: pct(totalBounces, totalSent),
    unsubscribeRate: pct(totalUnsubs, totalDelivered),
    spamRate: pct(totalSpam, totalDelivered),
    opensCount: totalUniqueOpens,
    clicksCount: totalUniqueClicks,
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
