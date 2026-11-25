import {
  describe,
  isActive,
  isBusy,
  type PublishStatus,
} from './publishStatus.ts'

type Props = {
  reviewed: number
  total: number
  /** Records of terraces.json this client can't read. */
  dropped: number
  message: string
  publish: PublishStatus
  onPublish: () => void
}

/** The admin's header: the title with Publish, and the count. */
export function AdminToolbar({
  reviewed,
  total,
  dropped,
  message,
  publish,
  onPublish,
}: Props) {
  return (
    <>
      <div className="admin-title admin-publish" aria-live="polite">
        <h1>Venue review</h1>
        <button type="button" disabled={isBusy(publish)} onClick={onPublish}>
          {isBusy(publish) ? 'Publishing…' : 'Publish'}
        </button>
      </div>
      <p className="admin-status">
        {reviewed} of {total} reviewed
      </p>
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
