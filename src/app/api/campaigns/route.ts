import { bqQuery, t, isConfigured } from '@/lib/bigquery'
import { SEGMENT_NAME_MAP, SEGMENT_CODE_ORDER, extractSegmentCode } from '@/lib/segments'
import { NextResponse } from 'next/server'

export async function GET() {
  if (!isConfigured()) return NextResponse.json([])
  try {
    const rows = await bqQuery<{ campaign_name: string }>(`
      SELECT DISTINCT campaign_name
      FROM ${t('Pardot_userActivity')}
      WHERE campaign_name IS NOT NULL AND campaign_name != ''
        AND campaign_name LIKE 'NS |%'
      LIMIT 500
    `)

    const seen = new Set<string>()
    for (const r of rows) {
      const code = extractSegmentCode(r.campaign_name)
      if (code) seen.add(code)
    }

    const segments = SEGMENT_CODE_ORDER
      .filter(code => seen.has(code))
      .map(code => ({ code, label: SEGMENT_NAME_MAP[code] }))

    // Append any codes found in data but not in our known order
    for (const code of seen) {
      if (!SEGMENT_CODE_ORDER.includes(code)) {
        segments.push({ code, label: SEGMENT_NAME_MAP[code] ?? code })
      }
    }

    return NextResponse.json(segments)
  } catch {
    return NextResponse.json([])
  }
}
