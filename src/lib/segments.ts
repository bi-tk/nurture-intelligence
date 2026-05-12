export const SEGMENT_NAME_MAP: Record<string, string> = {
  CIO_NT_MM:  'CIOs & Tech Leaders | Non-Tech | $50–$500M',
  CEO_NT:     'CEOs & Non-Tech Leaders | Non-Tech',
  CEO_T_U50:  'CEOs & Non-Tech Leaders | Tech | Under $50M',
  CTO_T_U50:  'CTOs & Tech Leaders | Tech | Under $50M',
  CTO_FTS:    'CTOs & Tech Leaders | Funded Tech Startups',
  PE_MP:      'Managing Partners | Private Equity',
  CIO_NT_U50: 'CIOs & Tech Leaders | Non-Tech | Under $50M new',
}

export const SEGMENT_CODE_ORDER = [
  'CIO_NT_MM', 'CIO_NT_U50', 'CEO_T_U50', 'CTO_T_U50', 'CEO_NT', 'CTO_FTS', 'PE_MP',
]

export function extractSegmentCode(name: string): string | null {
  const parts = name.split(' | ')
  if (parts.length >= 2 && parts[0].trim() === 'NS') {
    const code = parts[1].trim()
    if (SEGMENT_NAME_MAP[code]) return code
  }
  for (const code of SEGMENT_CODE_ORDER) {
    if (name.includes(code)) return code
  }
  return null
}
