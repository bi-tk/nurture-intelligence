'use client'

import SortableTable, { type Column } from '@/components/ui/SortableTable'
import { formatNumber } from '@/lib/utils'

export interface ProspectRow {
  id: number
  name: string
  title: string
  normalizedTitle: string
  score: number
  grade: string
  status: string
  lastActivity: string | null
  segment: string
  nurtureStep: string
}

const STATUS_STYLES: Record<string, { background: string; color: string }> = {
  Engaged: { background: '#0f2a18', color: '#4ade80' },
  'Low Open': { background: '#0f1e38', color: '#38bdf8' },
  'Low Click': { background: '#0f1e38', color: '#38bdf8' },
  Dark: { background: '#2a1a0a', color: '#fb923c' },
  Bounced: { background: '#2a0f0f', color: '#f87171' },
  Unsub: { background: '#2a0f0f', color: '#f87171' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { background: '#1a1a2a', color: '#c084fc' }
  return (
    <span className="text-xs font-mono px-2 py-0.5 rounded-full whitespace-nowrap" style={s}>
      {status}
    </span>
  )
}

const columns: Column[] = [
  { key: 'id', label: '#', format: (v) => <span className="text-white/40 font-mono text-xs">{String(v ?? '')}</span> },
  { key: 'name', label: 'Name', format: (v) => <span className="text-white/80 font-medium whitespace-nowrap">{String(v ?? '')}</span> },
  { key: 'normalizedTitle', label: 'Normalized Title', format: (v) => <span className="text-white/50 whitespace-nowrap text-xs">{String(v ?? '—')}</span> },
  { key: 'title', label: 'Title', format: (v) => <span className="text-white/50 whitespace-nowrap">{String(v ?? '')}</span> },
  { key: 'segment', label: 'Segment', format: (v) => <span className="text-white/50 whitespace-nowrap text-xs">{String(v ?? '—')}</span> },
  { key: 'nurtureStep', label: 'Nurture Step', format: (v) => <span className="text-white/50 whitespace-nowrap text-xs">{String(v ?? '—')}</span> },
  { key: 'score', label: 'Score', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'grade', label: 'Grade', format: (v) => <span className="text-white/70 font-mono">{String(v ?? '—')}</span> },
  { key: 'status', label: 'Status', format: (v) => <StatusBadge status={String(v ?? '')} /> },
  {
    key: 'lastActivity',
    label: 'Last Activity',
    format: (v) => (
      <span className="text-white/40 font-mono text-xs whitespace-nowrap">
        {v ? new Date(String(v)).toLocaleDateString() : '—'}
      </span>
    ),
  },
]

export default function ContactProspectTable({ rows }: { rows: ProspectRow[] }) {
  return (
    <div className="rounded-xl border border-white/5 overflow-hidden">
      <SortableTable
        columns={columns}
        rows={rows as unknown as Record<string, unknown>[]}
        defaultSort="score"
        defaultDir="desc"
        emptyMessage="No data — connect Pardot to see prospect activity"
        maxHeight="600px"
      />
    </div>
  )
}
