'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

export interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: (val: unknown, row: Record<string, unknown>) => string | ReactNode
}

interface SortableTableProps {
  columns: Column[]
  rows: Record<string, unknown>[]
  defaultSort?: string
  defaultDir?: 'asc' | 'desc'
  emptyMessage?: string
  maxHeight?: string
}

export default function SortableTable({
  columns,
  rows,
  defaultSort,
  defaultDir = 'desc',
  emptyMessage = 'No data',
  maxHeight,
}: SortableTableProps) {
  const [sortKey, setSortKey] = useState(defaultSort ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir)

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const headerRow = (
    <tr className="border-b border-white/5">
      {columns.map(col => (
        <th
          key={col.key}
          onClick={() => toggleSort(col.key)}
          className={`px-4 py-3 text-white/25 text-xs font-mono uppercase tracking-widest whitespace-nowrap cursor-pointer select-none hover:text-white/50 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
        >
          {col.label}
          <span className="ml-1 opacity-60">
            {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </th>
      ))}
    </tr>
  )

  const bodyRows = (
    <>
      {sorted.length === 0 && (
        <tr>
          <td colSpan={columns.length} className="px-4 py-8 text-center text-white/30 text-sm">
            {emptyMessage}
          </td>
        </tr>
      )}
      {sorted.map((row, i) => (
        <tr key={i} className="hover:bg-white/2 transition-colors">
          {columns.map(col => (
            <td key={col.key} className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : ''}`}>
              {col.format
                ? col.format(row[col.key], row)
                : (row[col.key] != null ? String(row[col.key]) : '—')}
            </td>
          ))}
        </tr>
      ))}
    </>
  )

  if (maxHeight) {
    return (
      <div className="overflow-x-auto">
        <div style={{ maxHeight }} className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-graphite-800">{headerRow}</thead>
            <tbody className="divide-y divide-white/5">{bodyRows}</tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>{headerRow}</thead>
        <tbody className="divide-y divide-white/5">{bodyRows}</tbody>
      </table>
    </div>
  )
}
