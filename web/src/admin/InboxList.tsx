import type { Lead } from './priceCandidates.ts'
import type { ReportedVenue } from './reports.ts'
import {
  describeItem,
  KIND_LABELS,
  type InboxItem,
  type InboxKind,
} from './inbox.ts'
import type { InboxFilter } from './useInbox.ts'

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'report', label: 'Reports' },
  { id: 'suggestion', label: 'Suggestions' },
  { id: 'price', label: 'Website prices' },
  { id: 'junk', label: 'Not venues' },
]

type Props = {
  items: readonly InboxItem[]
  shown: readonly InboxItem[]
  filter: InboxFilter
  onFilter: (filter: InboxFilter) => void
  openKey: string | null
  onOpen: (item: InboxItem) => void
  venueOf: (id: string) => ReportedVenue | undefined
  loaded: boolean
  errors: readonly string[]
  leads: readonly Lead[]
}

const count = (items: readonly InboxItem[], kind: InboxKind) =>
  items.filter((i) => i.kind === kind).length

/** The Inbox's filters and its list: one row per item, the open one highlighted. */
export function InboxFilters({
  items,
  filter,
  onFilter,
}: Pick<Props, 'items' | 'filter' | 'onFilter'>) {
  return (
    <div className="admin-filters" role="tablist" aria-label="Inbox filter">
      {FILTERS.map((f) => {
        const n = f.id === 'all' ? items.length : count(items, f.id)
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
            {n ? ` ${n}` : ''}
          </button>
        )
      })}
    </div>
  )
}

export function InboxList({
  shown,
  filter,
  openKey,
  onOpen,
  venueOf,
  loaded,
  errors,
  leads,
}: Omit<Props, 'items' | 'onFilter'>) {
  return (
    <div className="admin-list">
      {errors.map((e) => (
        <p key={e} className="admin-help admin-inbox-error">
          {e}
        </p>
      ))}
      {!loaded && <p className="admin-help">Loading the Inbox…</p>}
      {loaded && shown.length === 0 && (
        <p className="admin-help">Nothing waiting here.</p>
      )}
      <ol>
        {shown.map((item) => {
          const { title, detail } = describeItem(item, venueOf)
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-current={item.key === openKey ? 'true' : undefined}
                onClick={() => onOpen(item)}
              >
                <span className={`admin-tag admin-tag-${item.kind}`}>
                  {KIND_LABELS[item.kind]}
                </span>
                <span className="admin-name">
                  {title}
                  <span className="admin-reason">{detail}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {(filter === 'price' || filter === 'all') && leads.length > 0 && (
        <details className="admin-help admin-leads">
          <summary>
            Menus as PDF or image, to read by hand ({leads.length})
          </summary>
          <ul className="admin-candidate-leads">
            {leads.map((lead) => (
              <li key={`${lead.venueId}|${lead.url}`}>
                {venueOf(lead.venueId)?.name ?? lead.venueId}:{' '}
                <a href={lead.url} target="_blank" rel="noreferrer">
                  {decodeURIComponent(
                    new URL(lead.url).pathname.split('/').pop() ||
                      new URL(lead.url).host,
                  )}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
