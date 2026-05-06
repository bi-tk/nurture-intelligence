'use client'

import SortableTable, { type Column } from '@/components/ui/SortableTable'
import { formatNumber, formatPercent, formatCurrency } from '@/lib/utils'

export interface StatsRow {
  name: string
  members: number
  sent: number
  delivered: number
  opens: number
  clicks: number
  bounces: number
  deliveryRate: number
  openRate: number
  clickRate: number
  ctr: number
  unsubRate: number
  mqlRate: number
  sqlRate: number
  wonRevenue: number
}

const segmentColumns: Column[] = [
  { key: 'name', label: 'Segment', format: (v) => <p className="truncate max-w-[240px] text-white whitespace-nowrap">{String(v ?? '')}</p> },
  { key: 'sent', label: 'Sent', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'delivered', label: 'Delivered', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'opens', label: 'Opens', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'clicks', label: 'Clicks', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'bounces', label: 'Bounces', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'deliveryRate', label: 'Delivery %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'openRate', label: 'Open %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'clickRate', label: 'Click %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'ctr', label: 'CTR', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'unsubRate', label: 'Unsub %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'mqlRate', label: 'MQL %', format: (v) => <span className="text-pulse-blue font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'sqlRate', label: 'SQL %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'wonRevenue', label: 'Won Revenue', format: (v) => <span className="text-accent-green font-mono whitespace-nowrap">{Number(v) > 0 ? formatCurrency(Number(v)) : '—'}</span> },
]

const industryColumns: Column[] = [
  { key: 'name', label: 'Industry', format: (v) => <p className="truncate max-w-[240px] text-white whitespace-nowrap">{String(v ?? '')}</p> },
  { key: 'members', label: 'Members', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'sent', label: 'Sent', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'delivered', label: 'Delivered', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'opens', label: 'Opens', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'clicks', label: 'Clicks', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'bounces', label: 'Bounces', format: (v) => <span className="text-white/60 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'deliveryRate', label: 'Delivery %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'openRate', label: 'Open %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'clickRate', label: 'Click %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'ctr', label: 'CTR', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'unsubRate', label: 'Unsub %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'mqlRate', label: 'MQL %', format: (v) => <span className="text-pulse-blue font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'sqlRate', label: 'SQL %', format: (v) => <span className="text-white/50 font-mono">{Number(v) > 0 ? formatPercent(Number(v)) : '—'}</span> },
  { key: 'wonRevenue', label: 'Won Revenue', format: (v) => <span className="text-accent-green font-mono whitespace-nowrap">{Number(v) > 0 ? formatCurrency(Number(v)) : '—'}</span> },
]

function TableCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5">
        <p className="text-white font-medium">{title}</p>
        <p className="text-white/30 text-xs mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export default function SegmentTables({
  segments,
  newsletter,
  industries,
}: {
  segments: StatsRow[]
  newsletter: StatsRow
  industries: StatsRow[]
}) {
  return (
    <div className="space-y-6">
      <TableCard
        title="Nurture Segment Performance"
        subtitle="7 sequence lists — Members = live list count · Email stats matched by NS email name pattern"
      >
        <SortableTable
          columns={segmentColumns}
          rows={segments as unknown as Record<string, unknown>[]}
          defaultSort="sent"
          defaultDir="desc"
          emptyMessage="No nurture segments found — connect Pardot to see segment performance"
          maxHeight="600px"
        />
      </TableCard>

      <TableCard
        title="Newsletter Performance"
        subtitle="Nurture & Future Interest list — receives newsletters, not sequences"
      >
        <SortableTable
          columns={segmentColumns}
          rows={[newsletter] as unknown as Record<string, unknown>[]}
          defaultSort="members"
          defaultDir="desc"
          emptyMessage="No newsletter data"
        />
      </TableCard>

      <TableCard
        title="Industry Performance"
        subtitle="Members = nurture leads in that industry via Salesforce Normalized_Industry__c"
      >
        <SortableTable
          columns={industryColumns}
          rows={industries as unknown as Record<string, unknown>[]}
          defaultSort="members"
          defaultDir="desc"
          emptyMessage="No data — connect Salesforce to see industry performance"
          maxHeight="480px"
        />
      </TableCard>
    </div>
  )
}
