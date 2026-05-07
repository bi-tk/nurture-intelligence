import { bqQuery, t, isConfigured } from '@/lib/bigquery'
import { NextResponse } from 'next/server'

const SEGMENT_NAME_MAP: Record<string, string> = {
  CIO_NT_MM: 'CIOs & Tech Leaders | Non-Tech | $50–$500M',
  CEO_NT:    'CEOs & Non-Tech Leaders | Non-Tech',
  CEO_T_U50: 'CEOs & Non-Tech Leaders | Tech | Under $50M',
  CTO_T_U50: 'CTOs & Tech Leaders | Tech | Under $50M',
  CTO_FTS:   'CTOs & Tech Leaders | Funded Tech Startups',
  PE_MP:     'Managing Partners | Private Equity',
  CIO_NT_U50:'CIOs & Tech Leaders | Non-Tech | Under $50M new',
}

const SEGMENT_ORDER = ['CIO_NT_MM', 'CIO_NT_U50', 'CEO_T_U50', 'CTO_T_U50', 'CEO_NT', 'CTO_FTS', 'PE_MP']

function extractCode(campaignName: string): string | null {
  const parts = campaignName.split(' | ')
  if (parts.length >= 2 && parts[0].trim() === 'NS') {
    const code = parts[1].trim()
    if (SEGMENT_NAME_MAP[code]) return code
  }
  return null
}

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
      const code = extractCode(r.campaign_name)
      if (code) seen.add(code)
    }

    const segments = SEGMENT_ORDER
      .filter(code => seen.has(code))
      .map(code => ({ code, label: SEGMENT_NAME_MAP[code] }))

    // Append any codes found in data but not in our known order
    for (const code of seen) {
      if (!SEGMENT_ORDER.includes(code)) {
        segments.push({ code, label: SEGMENT_NAME_MAP[code] ?? code })
      }
    }

    return NextResponse.json(segments)
  } catch {
    return NextResponse.json([])
  }
}
