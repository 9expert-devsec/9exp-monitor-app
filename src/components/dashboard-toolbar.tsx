'use client'

import { Search } from 'lucide-react'

export interface FilterTab {
  key: string
  label: string
  count: number
}

interface Props {
  tabs: FilterTab[]
  activeFilter: string
  /** Initial text of the search box; the URL stays the source of truth. */
  defaultQuery: string
  onFilterChange: (key: string) => void
  onQueryChange: (value: string) => void
}

/**
 * Filter tabs + search. Purely presentational: the parent derives the active
 * filter and the query from the URL and passes them back in.
 */
export function DashboardToolbar({
  tabs,
  activeFilter,
  defaultQuery,
  onFilterChange,
  onQueryChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      {/* ≥ 640 px: segmented control. */}
      <div
        role="group"
        aria-label="Filter sites"
        className="hidden w-fit flex-wrap gap-1 rounded-md border border-(--border-subtle) bg-(--surface-sunken) p-1 sm:flex"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeFilter
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(tab.key)}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
                active
                  ? 'bg-(--surface-raised) text-(--text-primary)'
                  : 'text-(--text-secondary) hover:text-(--text-primary)'
              }`}
            >
              {tab.label} <span className="font-mono text-xs text-(--text-muted)">{tab.count}</span>
            </button>
          )
        })}
      </div>

      {/* < 640 px: horizontally scrollable chips. */}
      <div
        role="group"
        aria-label="Filter sites"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:hidden"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeFilter
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(tab.key)}
              className={`shrink-0 rounded-pill border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                active
                  ? 'border-(--brand-nine-blue) bg-(--brand-nine-blue) text-(--brand-cloud-base)'
                  : 'border-(--border-subtle) bg-(--surface-card) text-(--text-secondary)'
              }`}
            >
              {tab.label} {tab.count}
            </button>
          )
        })}
      </div>

      <label className="relative block w-full sm:w-80">
        <span className="sr-only">Search sites</span>
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--text-muted)"
        />
        <input
          type="search"
          defaultValue={defaultQuery}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by name or URL…"
          className="w-full rounded-md border border-(--border-strong) bg-(--surface-sunken) py-2 pr-3 pl-9 text-sm text-(--text-primary) placeholder:text-(--text-muted)"
        />
      </label>
    </div>
  )
}
