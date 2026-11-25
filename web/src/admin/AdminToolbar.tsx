import {
  describe,
  isActive,
  isBusy,
  type PublishStatus,
} from './publishStatus.ts'

type Props = {
  queueMode: boolean
  onQueue: () => void
  junkOpen: boolean
  junkCount: number
  onJunk: () => void
  suggestionsOpen: boolean
  onSuggestions: () => void
  reportsOpen: boolean
  reportCount: number | null
  onReports: () => void
  candidatesOpen: boolean
  onCandidates: () => void
  onAdd: () => void
  reviewed: number
  total: number
  /** Records of terraces.json this client can't read. */
  dropped: number
  message: string
  publish: PublishStatus
  onPublish: () => void
}

/** The admin's header: its panel buttons, the counts and Publish. */
export function AdminToolbar({
  queueMode,
  onQueue,
  junkOpen,
  junkCount,
  onJunk,
  suggestionsOpen,
  onSuggestions,
  reportsOpen,
  reportCount,
  onReports,
  candidatesOpen,
  onCandidates,
  onAdd,
  reviewed,
  total,
  dropped,
  message,
  publish,
  onPublish,
}: Props) {
  return (
    <>
      <div className="admin-title">
        <h1>Venue review</h1>
        <span className="admin-title-actions">
          <button type="button" aria-pressed={queueMode} onClick={onQueue}>
            Review queue
          </button>
          <button type="button" aria-pressed={junkOpen} onClick={onJunk}>
            Not venues ({junkCount})
          </button>
          <button
            type="button"
            aria-pressed={suggestionsOpen}
            onClick={onSuggestions}
          >
            Suggestions
          </button>
          <button type="button" aria-pressed={reportsOpen} onClick={onReports}>
            Reports{reportCount ? ` (${reportCount})` : ''}
          </button>
          <button
            type="button"
            aria-pressed={candidatesOpen}
            onClick={onCandidates}
          >
            Website prices
          </button>
          <button type="button" onClick={onAdd}>
            + Add venue
          </button>
        </span>
      </div>
      <p>
        {reviewed} of {total} reviewed
        {dropped > 0 && (
          <span className="admin-message" role="alert">
            {' '}
            · {dropped} invalid {dropped === 1 ? 'record' : 'records'} in
            terraces.json left out
          </span>
        )}
        {message && <span className="admin-message"> · {message}</span>}
      </p>
      <div className="admin-publish" aria-live="polite">
        <button type="button" disabled={isBusy(publish)} onClick={onPublish}>
          {isBusy(publish) ? 'Publishing…' : 'Publish'}
        </button>
        <p className={`admin-publish-${publish.step}`}>
          {isActive(publish) && <span className="admin-spinner" />}
          {describe(publish)}{' '}
          {publish.url && (
            <a href={publish.url} target="_blank" rel="noreferrer">
              {publish.pr ? 'Open PR' : 'GitHub'}
            </a>
          )}
        </p>
        {isActive(publish) && (
          <p>You can keep editing: new changes go out with the next Publish.</p>
        )}
      </div>
    </>
  )
}
