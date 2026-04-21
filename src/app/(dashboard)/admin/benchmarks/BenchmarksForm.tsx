'use client'

import { useState } from 'react'

type Benchmark = {
  id: string
  metric: string
  warningThreshold: number | null
  criticalThreshold: number | null
  inactivityDays: number | null
}

const META: Record<string, { label: string; description: string; unit: string }> = {
  open_rate:             { label: 'Open Rate',               description: 'Alert when unique open rate falls below threshold',          unit: '%'    },
  bounce_rate:           { label: 'Bounce Rate',             description: 'Alert when bounce rate exceeds threshold',                   unit: '%'    },
  spam_rate:             { label: 'Spam Complaint Rate',     description: 'Alert when spam complaint rate exceeds threshold',           unit: '%'    },
  unsub_rate:            { label: 'Unsubscribe Rate',        description: 'Alert when unsubscribe rate exceeds threshold',              unit: '%'    },
  click_rate:            { label: 'Click Rate',              description: 'Alert when click rate falls below threshold',                unit: '%'    },
  inactivity_days:       { label: 'Inactivity Window',       description: 'Days without activity before contact is classified inactive', unit: 'days' },
  signal_hot_threshold:  { label: 'Signal — Hot threshold',  description: 'Open Rate at or above this → Hot signal',                   unit: '%'    },
  signal_warm_threshold: { label: 'Signal — Warm threshold', description: 'Open Rate at or above this → Warm signal',                  unit: '%'    },
  signal_cold_threshold: { label: 'Signal — Cold threshold', description: 'Open Rate at or above this → Cold signal',                  unit: '%'    },
  signal_atrisk_bounce:  { label: 'Signal — At Risk bounce', description: 'Bounce Rate at or above this → At Risk signal',             unit: '%'    },
}

export default function BenchmarksForm({ initialBenchmarks }: { initialBenchmarks: Benchmark[] }) {
  const [values, setValues] = useState<Record<string, { warn: string; critical: string }>>(() => {
    const map: Record<string, { warn: string; critical: string }> = {}
    for (const b of initialBenchmarks) {
      if (b.metric === 'inactivity_days') {
        map[b.metric] = {
          warn:     String(b.inactivityDays ?? 60),
          critical: String(b.inactivityDays ?? 90),
        }
      } else {
        map[b.metric] = {
          warn:     String(b.warningThreshold ?? ''),
          critical: String(b.criticalThreshold ?? ''),
        }
      }
    }
    // Ensure defaults exist for all known metrics even if not in DB
    for (const metric of Object.keys(META)) {
      if (!map[metric]) {
        const defaults: Record<string, { warn: string; critical: string }> = {
          open_rate:             { warn: '20',  critical: '15'  },
          bounce_rate:           { warn: '3',   critical: '5'   },
          spam_rate:             { warn: '0.1', critical: '0.3' },
          unsub_rate:            { warn: '0.5', critical: '1'   },
          click_rate:            { warn: '2',   critical: '1'   },
          inactivity_days:       { warn: '60',  critical: '90'  },
          signal_hot_threshold:  { warn: '20',  critical: ''    },
          signal_warm_threshold: { warn: '12',  critical: ''    },
          signal_cold_threshold: { warn: '5',   critical: ''    },
          signal_atrisk_bounce:  { warn: '5',   critical: ''    },
        }
        map[metric] = defaults[metric]
      }
    }
    return map
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function update(metric: string, field: 'warn' | 'critical', val: string) {
    setValues((prev) => ({ ...prev, [metric]: { ...prev[metric], [field]: val } }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)

    const payload = Object.entries(values).map(([metric, v]) => {
      if (metric === 'inactivity_days') {
        return { metric, warningThreshold: null, criticalThreshold: null, inactivityDays: Number(v.critical) }
      }
      return {
        metric,
        warningThreshold:  Number(v.warn),
        criticalThreshold: Number(v.critical),
        inactivityDays: null,
      }
    })

    try {
      const res = await fetch('/api/benchmarks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const EMAIL_METRICS = ['open_rate', 'bounce_rate', 'spam_rate', 'unsub_rate', 'click_rate', 'inactivity_days']
  const SIGNAL_METRICS = ['signal_hot_threshold', 'signal_warm_threshold', 'signal_cold_threshold', 'signal_atrisk_bounce']

  function BenchmarkRow({ metric }: { metric: string }) {
    const meta = META[metric]
    const val = values[metric] ?? { warn: '', critical: '' }
    const isInactivity = metric === 'inactivity_days'
    const isSignal = metric.startsWith('signal_')

    return (
      <div className="bg-graphite-800 border border-white/5 rounded-xl p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <p className="text-white font-medium mb-0.5">{meta.label}</p>
            <p className="text-white/40 text-sm">{meta.description}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="text-white/25 text-xs font-mono mb-1">
                {isInactivity ? 'Days' : isSignal ? 'Threshold' : 'Warning'}
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={val.warn}
                  onChange={(e) => update(metric, 'warn', e.target.value)}
                  step={metric === 'spam_rate' || metric === 'unsub_rate' ? 0.1 : 1}
                  className="w-16 bg-graphite-700 border border-white/10 rounded px-2 py-1 text-accent-yellow text-sm font-mono text-center focus:outline-none focus:border-accent-yellow/40"
                />
                <span className="text-white/30 text-xs">{meta.unit}</span>
              </div>
            </div>
            {!isInactivity && !isSignal && (
              <div className="text-right">
                <p className="text-white/25 text-xs font-mono mb-1">Critical</p>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={val.critical}
                    onChange={(e) => update(metric, 'critical', e.target.value)}
                    className="w-16 bg-graphite-700 border border-white/10 rounded px-2 py-1 text-accent-red text-sm font-mono text-center focus:outline-none focus:border-accent-red/40"
                  />
                  <span className="text-white/30 text-xs">{meta.unit}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {EMAIL_METRICS.map(m => <BenchmarkRow key={m} metric={m} />)}
      </div>

      <div>
        <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-3">Signal Thresholds</p>
        <div className="space-y-3">
          {SIGNAL_METRICS.map(m => <BenchmarkRow key={m} metric={m} />)}
        </div>
      </div>

      {error && (
        <p className="text-accent-red text-sm text-right">{error}</p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved && (
          <span className="text-accent-green text-sm font-mono">✓ Saved</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="gradient-core-flow text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Benchmarks'}
        </button>
      </div>
    </div>
  )
}
