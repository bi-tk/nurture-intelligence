import { auth } from '@/lib/auth'
import Header from '@/components/layout/Header'

const insights = [
  {
    type: 'executive_summary',
    label: 'Executive Summary',
    audience: 'executive',
    content: 'Over the past 18 days, email performance has improved meaningfully — unique open rate is up 2.1pp to 24.7%, driven by strong gains in the SaaS Mid-Market and Enterprise Re-Engagement sequences. MQLs grew 11.4% to 312, and won revenue reached $540K, up 28.6% vs. last period.',
    approved: true,
  },
  {
    type: 'recommendation',
    label: 'Recommendation',
    audience: 'ops',
    content:
      'Suppress the bottom 20% of inactive contacts in the SMB Cold Outreach Legacy sequence. Estimated impact: +0.4pp delivery rate, -1.2% list churn rate. Create a recycle list for contacts inactive 90–180 days for a re-engagement sequence.',
    approved: false,
  },
  {
    type: 'anomaly',
    label: 'Anomaly Detected',
    audience: 'ops',
    content:
      'Discovery-call-to-opportunity conversion dropped 4.9pp (68% → 64.9%) vs. prior period. This change is outside normal variance. Likely cause: sales handoff quality, not marketing performance. Recommend reviewing SQL acceptance criteria with sales leadership.',
    approved: false,
  },
]

const typeColors: Record<string, string> = {
  executive_summary: 'text-pulse-blue',
  recommendation: 'text-accent-green',
  anomaly: 'text-accent-yellow',
}

const typeBg: Record<string, string> = {
  executive_summary: 'bg-pulse-blue/8 border-pulse-blue/15',
  recommendation: 'bg-accent-green/8 border-accent-green/15',
  anomaly: 'bg-accent-yellow/8 border-accent-yellow/15',
}

export default async function AiInsightsPage() {
  const session = await auth()

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="AI Insights"
        subtitle="AI-generated summaries, anomalies, and recommendations"
        userName={session?.user?.name}
        userRole={session?.user?.role!}
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 bg-graphite-800 border border-white/5 rounded-xl px-5 py-3">
          <svg className="w-4 h-4 text-white/30" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <p className="text-white/40 text-sm">
            AI recommendations require admin approval before any actions are taken. Phase 3 will add anomaly detection and natural language query.
          </p>
        </div>

        {insights.map((ins, i) => (
          <div key={i} className={`rounded-xl border p-5 ${typeBg[ins.type]}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className={`text-xs font-mono uppercase tracking-widest ${typeColors[ins.type]}`}>
                  {ins.label}
                </p>
                <span className="text-white/20 text-xs font-mono">· {ins.audience}</span>
              </div>
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                  ins.approved
                    ? 'bg-accent-green/10 text-accent-green'
                    : 'bg-white/5 text-white/30'
                }`}
              >
                {ins.approved ? 'approved' : 'pending approval'}
              </span>
            </div>
            <p className="text-white/70 text-sm leading-relaxed whitespace-pre-line">{ins.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
