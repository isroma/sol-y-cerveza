export type InboxTab = 'reports' | 'suggestions' | 'prices' | 'junk'

const TABS: { id: InboxTab; label: string }[] = [
  { id: 'reports', label: 'Reports' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'prices', label: 'Website prices' },
  { id: 'junk', label: 'Not venues' },
]

/**
 * The Inbox's tabs: what came from outside to accept or dismiss (visitor
 * reports and price suggestions, prices found on venue websites, likely
 * non-venues to mark in a batch).
 */
export function InboxTabs({
  tab,
  onTab,
  counts,
}: {
  tab: InboxTab
  onTab: (tab: InboxTab) => void
  counts: { reports: number | null; junk: number }
}) {
  return (
    <div className="admin-filters" role="tablist" aria-label="Inbox">
      {TABS.map((t) => {
        const count =
          t.id === 'reports'
            ? counts.reports
            : t.id === 'junk'
              ? counts.junk
              : 0
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
          >
            {t.label}
            {count ? ` (${count})` : ''}
          </button>
        )
      })}
    </div>
  )
}
