'use client'

import { createContext, useContext } from 'react'

export interface DashboardFilters {
  dateRange: '7d' | '30d' | '90d' | '180d' | '365d' | 'custom'
  startDate?: string
  endDate?: string
  segment?: string
}

export const defaultFilters: DashboardFilters = {
  dateRange: '30d',
}

export const FiltersContext = createContext<{
  filters: DashboardFilters
  setFilters: (f: DashboardFilters) => void
}>({
  filters: defaultFilters,
  setFilters: () => {},
})

export function useFilters() {
  return useContext(FiltersContext)
}
