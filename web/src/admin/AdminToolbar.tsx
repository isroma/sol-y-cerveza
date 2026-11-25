import {
  describe,
  isActive,
  isBusy,
  type PublishStatus,
} from './publishStatus.ts'

type Props = {
  inboxOpen: boolean
  /** Reports and likely non-venues waiting (suggestion and price counts load in the Inbox). */
  inboxCount: number
  onInbox: () => void
  reviewed: number
  total: number
  /** Records of terraces.json this client can't read. */
  dropped: number
  message: string
  publish: PublishStatus
  onPublish: () => void
}

/** The admin's header: the title, the Inbox, the count and Publish. */
export function AdminToolbar({
  inboxOpen,
  inboxCount,
  onInbox,
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
        <button type="button" aria-pressed={inboxOpen} onClick={onInbox}>
          Inbox{inboxCount ? ` (${inboxCount})` : ''}
        </button>
      </div>
      <div className="admin-publish" aria-live="polite">
        <span className="admin-count">
          {reviewed} of {total} reviewed
        </span>
        <button type="button" disabled={isBusy(publish)} onClick={onPublish}>
          {isBusy(publish) ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      {publish.step !== 'idle' && (
        <p className={`admin-status admin-publish-${publish.step}`}>
          {isActive(publish) && <span className="admin-spinner" />}
          {describe(publish)}{' '}
          {publish.url && (
            <a href={publish.url} target="_blank" rel="noreferrer">
              {publish.pr ? 'Open PR' : 'GitHub'}
            </a>
          )}
          {isActive(publish) && ' You can keep editing.'}
        </p>
      )}
      {(dropped > 0 || message) && (
        <p className="admin-status">
          {dropped > 0 && (
            <span className="admin-message" role="alert">
              {dropped} invalid {dropped === 1 ? 'record' : 'records'} in
              terraces.json left out.{' '}
            </span>
          )}
          {message && <span className="admin-message">{message}</span>}
        </p>
      )}
    </>
  )
}
