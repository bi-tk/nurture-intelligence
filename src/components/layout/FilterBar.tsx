'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const EXCLUDED_PATHS = [
  '/admin/field-discovery',
  '/admin/field-mappings',
  '/admin/benchmarks',
  '/admin/users',
  '/admin/integrations',
  '/ops/ai-insights',
]

const DATE_PRESETS = [
  { value: '7d',   label: 'Last 7 days'    },
  { value: '30d',  label: 'Last 30 days'   },
  { value: '60d',  label: 'Last 60 days'   },
  { value: '90d',  label: 'Last 90 days'   },
  { value: '180d', label: 'Last 6 months'  },
  { value: '365d', label: 'Last 12 months' },
]

function DateRangeFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function displayLabel() {
    if (value.includes('_')) {
      const [from, to] = value.split('_')
      return `${from} – ${to}`
    }
    return DATE_PRESETS.find(p => p.value === value)?.label ?? value
  }

  function applyCustom() {
    if (fromDate && toDate) {
      onChange(`${fromDate}_${toDate}`)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-graphite-800 border border-white/10 text-white/60 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pulse-blue/40 cursor-pointer flex items-center gap-1.5"
      >
        <svg className="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.11-.89-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
        </svg>
        <span>{displayLabel()}</span>
        <svg className="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-[200] bg-graphite-800 border border-white/10 rounded-lg shadow-xl p-3 min-w-[230px]">
          <p className="text-white/25 text-xs font-mono uppercase tracking-widest mb-2">Quick Select</p>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => { onChange(p.value); setOpen(false) }}
                className={`text-xs px-2 py-1.5 rounded-md text-left transition-colors ${value === p.value ? 'bg-pulse-blue text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="border-t border-white/5 pt-3">
            <p className="text-white/25 text-xs font-mono uppercase tracking-widest mb-2">Custom Range</p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-white/30 text-xs">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="bg-graphite-700 border border-white/10 text-white/60 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-pulse-blue/40 w-full"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-white/30 text-xs">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="bg-graphite-700 border border-white/10 text-white/60 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-pulse-blue/40 w-full"
                />
              </div>
              <button
                onClick={applyCustom}
                disabled={!fromDate || !toDate}
                className="text-xs bg-pulse-blue text-white rounded px-3 py-1.5 disabled:opacity-30 hover:bg-pulse-blue/80 transition-colors mt-1"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CampaignMultiSelect({
  campaigns,
  selected,
  onChange,
}: {
  campaigns: string[]
  selected: string[]
  onChange: (selected: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [localSelected, setLocalSelected] = useState<string[]>(selected)
  const ref = useRef<HTMLDivElement>(null)
  // Use refs so the mousedown listener doesn't go stale
  const localRef = useRef<string[]>(selected)
  const selectedRef = useRef<string[]>(selected)
  const onChangeRef = useRef(onChange)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Keep localRef in sync with state
  useEffect(() => { localRef.current = localSelected }, [localSelected])

  // When URL-driven selected changes (e.g. navigating back), re-sync local state
  useEffect(() => {
    selectedRef.current = selected
    setLocalSelected(selected)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(',')])

  function closeAndApply() {
    setOpen(false)
    if (localRef.current.join(',') !== selectedRef.current.join(',')) {
      onChangeRef.current(localRef.current)
    }
  }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) closeAndApply()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  // Empty deps: refs ensure no stale closures
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle(c: string) {
    setLocalSelected(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  function handleToggleOpen() {
    if (open) {
      closeAndApply()
    } else {
      setOpen(true)
    }
  }

  const label =
    localSelected.length === 0 ? 'All Campaigns' :
    localSelected.length === 1 ? (localSelected[0].length > 28 ? localSelected[0].slice(0, 26) + '…' : localSelected[0]) :
    `${localSelected.length} campaigns`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggleOpen}
        className="bg-graphite-800 border border-white/10 text-white/60 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-pulse-blue/40 cursor-pointer flex items-center gap-1.5 max-w-[200px]"
      >
        <span className="truncate">{label}</span>
        <svg className="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-[200] bg-graphite-800 border border-white/10 rounded-lg shadow-xl min-w-[260px] max-h-64 overflow-y-auto">
          {campaigns.length === 0 ? (
            <p className="text-white/30 text-xs px-3 py-2">Loading…</p>
          ) : (
            <>
              <button
                onClick={() => setLocalSelected([])}
                className="w-full text-left px-3 py-2 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 border-b border-white/5"
              >
                Clear all
              </button>
              {campaigns.map(c => (
                <label key={c} className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSelected.includes(c)}
                    onChange={() => toggle(c)}
                    className="accent-pulse-blue shrink-0"
                  />
                  <span className="text-xs text-white/60 truncate">{c}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function FilterBar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [campaigns, setCampaigns] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(setCampaigns).catch(() => {})
  }, [])

  if (EXCLUDED_PATHS.some(p => pathname?.includes(p))) return null

  const dateRange = searchParams.get('dateRange') ?? '30d'
  const selectedCampaigns = searchParams.getAll('campaign')

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.replace(`${pathname}?${params.toString()}`)
  }

  function updateCampaigns(selected: string[]) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('campaign')
    for (const c of selected) params.append('campaign', c)
    router.replace(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="relative z-40 flex items-center gap-3 px-5 py-2 border-b border-white/5 bg-graphite-900/80 backdrop-blur-sm shrink-0">
      <p className="text-white/20 text-xs font-mono uppercase tracking-widest shrink-0">Filters</p>
      <DateRangeFilter value={dateRange} onChange={v => updateFilter('dateRange', v)} />
      <CampaignMultiSelect
        campaigns={campaigns}
        selected={selectedCampaigns}
        onChange={updateCampaigns}
      />
    </div>
  )
}
