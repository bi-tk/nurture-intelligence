import { NextResponse } from 'next/server'
import { getSfCreds, getPardotCreds, sfQuery, sfCount, pardotGet, pardotStats, pct } from '@/lib/sf-api'

interface OppRecord { Amount: number; StageName: string }
interface AggRecord { expr0: number }
interface ListEmail { id?: number; name?: string; sentAt?: string; isSent?: boolean }
interface ListEmailsResponse { values?: ListEmail[] }
const TOTAL_NURTURE_AUDIENCE = 6421

export async function GET() {
  const [sfCreds, pardotCreds] = await Promise.all([getSfCreds(), getPardotCreds()])

  // ── Salesforce queries — journey-based (same prospect tracked through each stage) ─
  const [nurtureCount, mqlCount, sqlCount, discoveryCount, oppResult, wonAgg, pipelineAgg, newOpps] =
    await Promise.all([
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Marketing_nurture__c = true') : Promise.resolve(0),
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Marketing_nurture__c = true AND Non_MQL_Date__c != null') : Promise.resolve(0),
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Marketing_nurture__c = true AND Non_MQL_Date__c != null AND SQL__c = true AND Not_Accepted__c = false') : Promise.resolve(0),
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Lead WHERE Marketing_nurture__c = true AND Discovery_Call__c = true') : Promise.resolve(0),
      sfCreds ? sfQuery<OppRecord>(sfCreds, 'SELECT StageName, Amount FROM Opportunity WHERE IsClosed = false AND Amount != null') : Promise.resolve(null),
      sfCreds ? sfQuery<AggRecord>(sfCreds, 'SELECT SUM(Amount) FROM Opportunity WHERE IsWon = true AND IsClosed = true') : Promise.resolve(null),
      sfCreds ? sfQuery<AggRecord>(sfCreds, 'SELECT SUM(Amount) FROM Opportunity WHERE IsClosed = false') : Promise.resolve(null),
      sfCreds ? sfCount(sfCreds, 'SELECT COUNT() FROM Opportunity WHERE CreatedDate = THIS_MONTH') : Promise.resolve(0),
    ])

  const wonRevenue = wonAgg?.records?.[0]?.expr0 ?? 0
  const pipelineValue = pipelineAgg?.records?.[0]?.expr0 ?? 0
  const wonOpportunities = (oppResult?.records ?? []).filter(r => r.StageName === 'Closed Won').length
  const opportunities = oppResult?.totalSize ?? 0

  // ── Pardot email aggregate (list-emails + per-email stats) ─────────────────
  let totalSent = 0, totalDelivered = 0, totalUniqueOpens = 0, totalUniqueClicks = 0
  let totalHardBounces = 0, totalSoftBounces = 0, totalUnsubs = 0, totalSpam = 0

  if (pardotCreds) {
    const listEmailsData = await pardotGet<ListEmailsResponse>(
      pardotCreds,
      'list-emails?fields=id,name,sentAt,isSent&limit=200'
    )
    const sentEmails = (listEmailsData?.values ?? [])
      .filter(e => e.isSent === true && e.id != null)
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
      .slice(0, 50)

    const statsResults = await Promise.all(
      sentEmails.map(e => pardotStats(pardotCreds, e.id!))
    )

    for (const s of statsResults) {
      if (!s) continue
      totalSent += s.sent ?? 0
      totalDelivered += s.delivered ?? 0
      totalUniqueOpens += s.uniqueOpens ?? 0
      totalUniqueClicks += s.uniqueClicks ?? 0
      totalHardBounces += s.hardBounced ?? 0
      totalSoftBounces += s.softBounced ?? 0
      totalUnsubs += s.optOuts ?? 0
      totalSpam += s.spamComplaints ?? 0
    }
  }

  const totalBounces = totalHardBounces + totalSoftBounces

  const totalProspects = TOTAL_NURTURE_AUDIENCE

  const prospectsOpenedAny = totalUniqueOpens
  const prospectsNoEngagement = Math.max(0, totalProspects - prospectsOpenedAny)

  return NextResponse.json({
    // period
    period: 'Last 30 Days',

    // Funnel
    nurtureCount,
    mqls: mqlCount,
    sqls: sqlCount,
    discoveryCalls: discoveryCount,
    opportunities,
    wonOpportunities,

    // Revenue
    wonRevenue,
    pipelineValue,
    opportunitiesCreated: newOpps,

    // Email health
    emailsSent: totalSent,
    deliveryRate: pct(totalDelivered, totalSent),
    uniqueOpenRate: pct(totalUniqueOpens, totalDelivered),
    uniqueClickRate: pct(totalUniqueClicks, totalDelivered),
    bounceRate: pct(totalBounces, totalSent),
    unsubscribeRate: pct(totalUnsubs, totalDelivered),
    spamRate: pct(totalSpam, totalDelivered),

    // Raw counts
    opensCount: totalUniqueOpens,
    clicksCount: totalUniqueClicks,
    unsubscribesCount: totalUnsubs,
    bouncesCount: totalBounces,
    spamCount: totalSpam,

    // Audience
    totalAudience: totalProspects,
    engagedAudience: prospectsOpenedAny,
    engagedRate: pct(prospectsOpenedAny, totalProspects),
    prospectsOpenedAny,
    prospectsClickedAny: totalUniqueClicks,
    prospectsNoEngagement,

    // Connected status
    sfConnected: !!sfCreds,
    pardotConnected: !!pardotCreds,
  })
}
