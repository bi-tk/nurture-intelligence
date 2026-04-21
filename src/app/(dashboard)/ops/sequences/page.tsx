import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'
import { formatNumber, formatPercent, formatCurrency, cn } from '@/lib/utils'
import { getPardotCreds, getSfCreds, pardotGet, pardotStats, sfQuery, pct } from '@/lib/sf-api'
import { prisma } from '@/lib/prisma'

type ListEmail = { id?: number; subject?: string; name?: string; sentAt?: string; isSent?: boolean; campaignId?: number }
type PardotCampaign = { id?: number; name?: string }
type TitleRecord = { Normalize_Title_del__c: string; expr0: number }

async function getSignalThresholds() {
  try {
    const records = await prisma.benchmark.findMany({
      where: { metric: { in: ['signal_hot_threshold', 'signal_warm_threshold', 'signal_cold_threshold', 'signal_atrisk_bounce'] } },
    })
    const map = Object.fromEntries(records.map(b => [b.metric, b.warningThreshold ?? 0]))
    return { hot: map['signal_hot_threshold'] ?? 20, warm: map['signal_warm_threshold'] ?? 12, cold: map['signal_cold_threshold'] ?? 5, atRiskBounce: map['signal_atrisk_bounce'] ?? 5 }
  } catch {
    return { hot: 20, warm: 12, cold: 5, atRiskBounce: 5 }
  }
}

async function fetchSequences() {
  try {
    const [pardotCreds, thresholds] = await Promise.all([getPardotCreds(), getSignalThresholds()])
    if (!pardotCreds) return null

    function signal(openRate: number, bounceRate: number): string {
      if (bounceRate >= thresholds.atRiskBounce) return 'At Risk'
      if (openRate >= thresholds.hot) return 'Hot'
      if (openRate >= thresholds.warm) return 'Warm'
      if (openRate >= thresholds.cold) return 'Cold'
      return 'At Risk'
    }

    // Find tkxel | Nurture campaign
    const campaignsData = await pardotGet<{ values?: PardotCampaign[] }>(pardotCreds, 'campaigns?fields=id,name&limit=200')
    const nurtureCampaignId = (campaignsData?.values ?? []).find(c => c.name?.toLowerCase().includes('nurture'))?.id

    const data = await pardotGet<{ values?: ListEmail[] }>(
      pardotCreds,
      'list-emails?fields=id,name,subject,sentAt,isSent,campaignId&limit=200'
    )

    const allSent = (data?.values ?? [])
      .filter(e => e.isSent === true && e.id != null)
      .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))

    const sentEmails = (nurtureCampaignId
      ? allSent.filter(e => e.campaignId === nurtureCampaignId)
      : allSent
    ).slice(0, 50)

    if (!sentEmails.length) return null

    const statsResults = await Promise.all(sentEmails.map(e => pardotStats(pardotCreds, e.id!)))

    const sequences = sentEmails
      .map((e, i) => {
        const s = statsResults[i]
        if (!s) return null
        const sent = s.sent ?? 0
        const delivered = s.delivered ?? 0
        const opens = s.uniqueOpens ?? 0
        const clicks = s.uniqueClicks ?? 0
        const bounces = (s.hardBounced ?? 0) + (s.softBounced ?? 0)
        const unsubs = s.optOuts ?? 0
        const deliveryRate = pct(delivered, sent)
        const openRate = pct(opens, delivered)
        const clickRate = pct(clicks, delivered)
        const ctr = pct(clicks, opens)
        const bounceRate = pct(bounces, sent)
        const unsubRate = pct(unsubs, delivered)
        return {
          name: e.subject ?? e.name ?? `Email ${e.id}`,
          segment: 'All Prospects',
          status: 'active',
          sent, delivered, opens, clicks, bounces, unsubs,
          wonRevenue: 0, mqlRate: 0, sqlRate: 0,
          deliveryRate, openRate, clickRate, ctr, bounceRate, unsubRate,
          signal: signal(openRate, bounceRate),
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.sent - a.sent)

    const subjectLines = sequences.slice(0, 20).map(s => ({
      subject: s.name,
      delivered: s.delivered, opens: s.opens,
      openRate: s.openRate, clicks: s.clicks,
      clickRate: s.clickRate, unsubs: s.unsubs, bounces: s.bounces,
    }))

    return { sequences, subjectLines }
  } catch { return null }
}

async function fetchProspectTitles() {
  try {
    const sfCreds = await getSfCreds()
    if (!sfCreds) return []

    const [totalResult, engagedResult] = await Promise.all([
      sfQuery<TitleRecord>(sfCreds, 'SELECT Normalize_Title_del__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalize_Title_del__c != null GROUP BY Normalize_Title_del__c ORDER BY COUNT(Id) DESC LIMIT 20'),
      sfQuery<TitleRecord>(sfCreds, 'SELECT Normalize_Title_del__c, COUNT(Id) FROM Lead WHERE Marketing_nurture__c = true AND Normalize_Title_del__c != null AND pi__score__c > 0 GROUP BY Normalize_Title_del__c ORDER BY COUNT(Id) DESC LIMIT 20'),
    ])

    const engagedMap = Object.fromEntries(
      (engagedResult?.records ?? []).map(r => [r.Normalize_Title_del__c, r.expr0])
    )

    return (totalResult?.records ?? []).map(r => {
      const total = r.expr0
      const engaged = engagedMap[r.Normalize_Title_del__c] ?? 0
      return {
        title: r.Normalize_Title_del__c,
        delivered: total,
        opens: engaged,
        openRate: pct(engaged, total),
        clicks: 0, clickRate: 0, unsubs: 0, bounces: 0,
      }
    })
  } catch { return [] }
}

export default async function SequencesPage() {
  const session = await auth()
  const [live, prospectTitles] = await Promise.all([fetchSequences(), fetchProspectTitles()])
  const sequences = live?.sequences ?? []
  const subjectLines = live?.subjectLines ?? []
  const isLive = !!live

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Sequence Performance"
        subtitle={isLive ? 'Live Pardot Data — tkxel | Nurture campaign' : 'Email engagement, deliverability, and funnel conversion by sequence'}
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-8">
        {!isLive && (
          <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-400 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            <p className="text-yellow-400/80 text-sm">No data — <a href="/admin/integrations" className="underline">connect Salesforce &amp; Pardot to see sequence performance</a>.</p>
          </div>
        )}

        {/* Main sequences table */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Sequence','Segment','Status','Sent','Delivered','Opens','Clicks','Bounces','Delivery %','Open %','Click %','CTR','Unsub %','MQL %','SQL %','Won Revenue','Signal'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/25 text-xs font-mono uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sequences.length === 0 && (
                  <tr><td colSpan={17} className="px-4 py-8 text-center text-white/30 text-sm">No data — connect Salesforce &amp; Pardot to see sequence performance</td></tr>
                )}
                {sequences.map((s) => (
                  <tr key={s.name} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 text-white font-medium whitespace-nowrap max-w-[200px]"><p className="truncate">{s.name}</p></td>
                    <td className="px-4 py-3 text-white/50 whitespace-nowrap">{s.segment}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('text-xs font-mono px-2 py-0.5 rounded-full', s.status === 'active' ? 'bg-accent-green/10 text-accent-green' : 'bg-white/5 text-white/30')}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(s.sent)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(s.delivered)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(s.opens)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(s.clicks)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(s.bounces)}</td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.deliveryRate} warn={95} bad={92} invert={false} /></td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.openRate} warn={20} bad={15} invert={false} /></td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.clickRate} warn={3} bad={2} invert={false} /></td>
                    <td className="px-4 py-3 text-white/50 font-mono">{formatPercent(s.ctr)}</td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.unsubRate} warn={0.5} bad={1} invert={true} /></td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.mqlRate} warn={10} bad={5} invert={false} /></td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={s.sqlRate} warn={6} bad={3} invert={false} /></td>
                    <td className="px-4 py-3 text-white font-mono font-medium whitespace-nowrap">{s.wonRevenue ? formatCurrency(s.wonRevenue) : '—'}</td>
                    <td className="px-4 py-3"><SignalBadge signal={s.signal} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Subject Line Performance */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Subject Line Performance</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Subject Line','Delivered','Opens','Open %','Clicks','Click %','Unsub','Bounce'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/25 text-xs font-mono uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {subjectLines.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-white/30 text-sm">No data</td></tr>
                )}
                {subjectLines.map((row) => (
                  <tr key={row.subject} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 text-white/80 max-w-[260px]"><p className="truncate">{row.subject}</p></td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.delivered)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.opens)}</td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={row.openRate} warn={20} bad={15} invert={false} /></td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.clicks)}</td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={row.clickRate} warn={3} bad={2} invert={false} /></td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.unsubs)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.bounces)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Performance by Prospect Title */}
        <div className="bg-graphite-800 border border-white/5 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <p className="text-white/40 text-xs font-mono uppercase tracking-widest">Performance by Prospect Title</p>
            <p className="text-white/25 text-xs mt-1">Delivered = leads in nurture · Opens = prospects with Pardot score &gt; 0</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  {['Title','Delivered','Opens','Open %','Clicks','Click %','Unsub','Bounce'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-white/25 text-xs font-mono uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {prospectTitles.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-white/30 text-sm">No data — connect Salesforce to see performance by prospect title</td></tr>
                )}
                {prospectTitles.map((row) => (
                  <tr key={row.title} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 text-white/80 max-w-[260px]"><p className="truncate">{row.title}</p></td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.delivered)}</td>
                    <td className="px-4 py-3 text-white/70 font-mono">{formatNumber(row.opens)}</td>
                    <td className="px-4 py-3 font-mono"><MetricCell value={row.openRate} warn={20} bad={15} invert={false} /></td>
                    <td className="px-4 py-3 text-white/70 font-mono">{row.clicks > 0 ? formatNumber(row.clicks) : '—'}</td>
                    <td className="px-4 py-3 font-mono">{row.clickRate > 0 ? <MetricCell value={row.clickRate} warn={3} bad={2} invert={false} /> : <span className="text-white/30">—</span>}</td>
                    <td className="px-4 py-3 text-white/30 font-mono">—</td>
                    <td className="px-4 py-3 text-white/30 font-mono">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
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
  return <span className="text-xs font-mono px-2 py-0.5 rounded-full whitespace-nowrap" style={s}>{signal}</span>
}
