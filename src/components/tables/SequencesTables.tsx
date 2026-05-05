'use client'

import SortableTable, { type Column } from '@/components/ui/SortableTable'
import { formatNumber, formatPercent, formatCurrency, cn } from '@/lib/utils'

export interface SequenceRow {
  id?: number
  name: string
  subject: string
  segmentCode: string
  segment: string
  emailNumber: string
  status: string
  sent: number
  delivered: number
  opens: number
  clicks: number
  bounces: number
  unsubs: number
  deliveryRate: number
  openRate: number
  clickRate: number
  ctr: number
  bounceRate: number
  unsubRate: number
  mqlRate: number
  sqlRate: number
  wonRevenue: number
  signal: string
  sentAt?: string
}

export interface SubjectLineRow {
  subject: string
  delivered: number
  opens: number
  openRate: number
  clicks: number
  clickRate: number
  unsubs: number
  bounces: number
}

export interface ProspectTitleRow {
  title: string
  delivered: number
  opens: number
  openRate: number
  clicks: number
  clickRate: number
  unsubs: number
  bounces: number
}

function formatSequenceName(name: string, emailNumber: string, segment: string): string {
  if (!name.startsWith('NS | ')) return name
  const segShort = segment.split(' | ')[0]
  const emailNum = emailNumber ? emailNumber.replace(/^E(\d+)$/, 'Email $1') : ''
  return emailNum ? `${segShort} · ${emailNum}` : segShort
}

function MetricCell({ value, warn, bad, invert }: { value: number; warn: number; bad: number; invert: boolean }) {
  const isGood = invert ? value < warn : value >= warn
  const isBad = invert ? value >= bad : value < bad
  return (
    <span className={cn(isBad ? 'text-accent-red' : isGood ? 'text-accent-green' : 'text-accent-yellow')}>
      {formatPercent(value)}
    </span>
  )
}

function SignalBadge({ signal }: { signal: string }) {
  const styles: Record<string, { background: string; color: string }> = {
    Hot: { background: '#0f2a18', color: '#4ade80' },
    Warm: { background: '#2a1a0a', color: '#fb923c' },
    Neutral: { background: '#1a1a2a', color: '#c084fc' },
    Cold: { background: '#0f1e38', color: '#38bdf8' },
    'At Risk': { background: '#2a0f0f', color: '#f87171' },
  }
  const s = styles[signal] ?? styles.Neutral
  return (
    <span className="text-xs font-mono px-2 py-0.5 rounded-full whitespace-nowrap" style={s}>
      {signal}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('text-xs font-mono px-2 py-0.5 rounded-full', status === 'active' ? 'bg-accent-green/10 text-accent-green' : 'bg-white/5 text-white/30')}>
      {status}
    </span>
  )
}

const sequenceColumns: Column[] = [
  {
    key: 'name',
    label: 'Sequence',
    format: (v, row) => (
      <p className="truncate max-w-[200px] text-white font-medium whitespace-nowrap">
        {formatSequenceName(String(v ?? ''), String(row?.emailNumber ?? ''), String(row?.segment ?? ''))}
      </p>
    ),
  },
  { key: 'segment', label: 'NS Segment', format: (v) => <span className="text-white/50 whitespace-nowrap text-xs">{v ? String(v) : '—'}</span> },
  { key: 'status', label: 'Status', format: (v) => <StatusBadge status={String(v ?? '')} /> },
  { key: 'sent', label: 'Sent', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'delivered', label: 'Delivered', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'opens', label: 'Opens', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'clicks', label: 'Clicks', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'bounces', label: 'Bounces', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'deliveryRate', label: 'Delivery %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={95} bad={92} invert={false} /> },
  { key: 'openRate', label: 'Open %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={20} bad={15} invert={false} /> },
  { key: 'clickRate', label: 'Click %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={3} bad={2} invert={false} /> },
  { key: 'ctr', label: 'CTR', format: (v) => <span className="text-white/50 font-mono">{formatPercent(Number(v ?? 0))}</span> },
  { key: 'unsubRate', label: 'Unsub %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={0.5} bad={1} invert={true} /> },
  { key: 'mqlRate', label: 'MQL %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={10} bad={5} invert={false} /> },
  { key: 'sqlRate', label: 'SQL %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={6} bad={3} invert={false} /> },
  { key: 'wonRevenue', label: 'Won Revenue', format: (v) => <span className="text-white font-mono font-medium whitespace-nowrap">{Number(v) > 0 ? formatCurrency(Number(v)) : '—'}</span> },
  { key: 'signal', label: 'Signal', format: (v) => <SignalBadge signal={String(v ?? '')} /> },
]

const subjectColumns: Column[] = [
  { key: 'subject', label: 'Subject Line', format: (v) => <p className="truncate max-w-[260px] text-white/80">{String(v ?? '')}</p> },
  { key: 'delivered', label: 'Delivered', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'opens', label: 'Opens', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'openRate', label: 'Open %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={20} bad={15} invert={false} /> },
  { key: 'clicks', label: 'Clicks', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'clickRate', label: 'Click %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={3} bad={2} invert={false} /> },
  { key: 'unsubs', label: 'Unsub', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'bounces', label: 'Bounce', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
]

const titleColumns: Column[] = [
  { key: 'title', label: 'Title', format: (v) => <p className="truncate max-w-[260px] text-white/80">{String(v ?? '')}</p> },
  { key: 'delivered', label: 'Delivered', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'opens', label: 'Opens', format: (v) => <span className="text-white/70 font-mono">{formatNumber(Number(v ?? 0))}</span> },
  { key: 'openRate', label: 'Open %', format: (v) => <MetricCell value={Number(v ?? 0)} warn={20} bad={15} invert={false} /> },
  { key: 'clicks', label: 'Clicks', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'clickRate', label: 'Click %', format: (v) => Number(v) > 0 ? <MetricCell value={Number(v)} warn={3} bad={2} invert={false} /> : <span className="text-white/30">—</span> },
  { key: 'unsubs', label: 'Unsub', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
  { key: 'bounces', label: 'Bounce', format: (v) => <span className="text-white/70 font-mono">{Number(v) > 0 ? formatNumber(Number(v)) : '—'}</span> },
]

export default function SequencesTables({
  sequences,
  subjectLines,
  prospectTitles,
}: {
  sequences: SequenceRow[]
  subjectLines: SubjectLineRow[]
  prospectTitles: ProspectTitleRow[]
}) {
  return (
    <div className="space-y-8">
      <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
        <SortableTable
          columns={sequenceColumns}
          rows={sequences as unknown as Record<string, unknown>[]}
          defaultSort="openRate"
          defaultDir="desc"
          emptyMessage="No data — connect Salesforce & Pardot to see sequence performance"
          maxHeight="520px"
        />
      </div>

      <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Subject Line Performance</p>
        </div>
        <SortableTable
          columns={subjectColumns}
          rows={subjectLines as unknown as Record<string, unknown>[]}
          defaultSort="opens"
          defaultDir="desc"
          emptyMessage="No data"
          maxHeight="480px"
        />
      </div>

      <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Performance by Prospect Title</p>
        </div>
        <SortableTable
          columns={titleColumns}
          rows={prospectTitles as unknown as Record<string, unknown>[]}
          defaultSort="delivered"
          defaultDir="desc"
          emptyMessage="No data — connect Pardot to see performance by prospect title"
          maxHeight="480px"
        />
      </div>
    </div>
  )
}
