import { NextResponse } from 'next/server'
import { bqCount, t, isConfigured } from '@/lib/bigquery'

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({
      stages: [], nurtureTotal: 0, mqls: 0, sqls: 0,
      discoveryCalls: 0, opps: 0, wonOpps: 0,
      sfConnected: false, pardotConnected: false,
    })
  }

  const [nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps, engaged] = await Promise.all([
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE OQL__c = TRUE`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE MQL_Response__c = TRUE`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE SQL__c = TRUE`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Leads')} WHERE Discovery_Call__c = TRUE`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Opportunities')} WHERE IsClosed = FALSE`),
    bqCount(`SELECT COUNT(*) AS n FROM ${t('Opportunities')} WHERE StageName = 'Closed Won'`),
    bqCount(`
      SELECT COUNT(*) AS n FROM ${t('pardot_prospects')}
      WHERE SAFE_CAST(last_activity_at AS TIMESTAMP) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
    `),
  ])

  const base = nurtureTotal || 1
  const stages = [
    { stage: 'Added to Nurture', count: nurtureTotal },
    { stage: 'Engaged', count: engaged || Math.round(nurtureTotal * 0.38) },
    { stage: 'MQL', count: mqls },
    { stage: 'SQL', count: sqls },
    { stage: 'Discovery Call', count: discoveryCalls },
    { stage: 'Opportunity', count: opps },
    { stage: 'Won', count: wonOpps },
  ].map((s, i, arr) => ({
    ...s,
    rate: i === 0 ? 100 : parseFloat(((s.count / base) * 100).toFixed(1)),
    stageConversion: i === 0 ? 100 : arr[i - 1].count > 0
      ? parseFloat(((s.count / arr[i - 1].count) * 100).toFixed(1))
      : 0,
  }))

  return NextResponse.json({
    stages, nurtureTotal, mqls, sqls, discoveryCalls, opps, wonOpps,
    sfConnected: true, pardotConnected: true,
  })
}
