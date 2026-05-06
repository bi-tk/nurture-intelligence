import { bqQuery, t, isConfigured } from '@/lib/bigquery'
import { NextResponse } from 'next/server'

export async function GET() {
  if (!isConfigured()) return NextResponse.json([])
  try {
    const rows = await bqQuery<{ campaign_name: string }>(`
      SELECT DISTINCT campaign_name
      FROM ${t('Pardot_userActivity')}
      WHERE campaign_name IS NOT NULL AND campaign_name != ''
        AND (campaign_name LIKE 'NS |%' OR LOWER(campaign_name) LIKE '%newsletter%')
      ORDER BY campaign_name
      LIMIT 500
    `)
    return NextResponse.json(rows.map(r => r.campaign_name))
  } catch {
    return NextResponse.json([])
  }
}
