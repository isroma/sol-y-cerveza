import { describeEdit, serializeQueue, type Edit } from './editQueue.ts'

type Props = {
  queue: readonly Edit[]
  /** Whether the last attempt reached the dev server. */
  reachable: boolean
  nameOf: (venueId: string) => string
  onRetry: () => void
  onImport: (text: string) => void
}

function download(queue: readonly Edit[]) {
  const blob = new Blob([serializeQueue(queue)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `admin-edits-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Edits kept on this device while the dev server is unreachable. */
export function EditsWaiting({
  queue,
  reachable,
  nameOf,
  onRetry,
  onImport,
}: Props) {
  const importer = (
    <label className="admin-import">
      Import edits…
      <input
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void file.text().then(onImport)
        }}
      />
    </label>
  )
  if (queue.length === 0) return <p className="admin-import-line">{importer}</p>
  return (
    <section className="admin-waiting" aria-label="Edits waiting">
      <p>
        <strong>
          {queue.length} {queue.length === 1 ? 'edit' : 'edits'} waiting
        </strong>
        {reachable ? ' · sending…' : ' · the dev server is unreachable'}. They
        are kept on this device and sent in order when it is back.
      </p>
      <details>
        <summary>Show</summary>
        <ol>
          {queue.map((edit, i) => (
            <li key={`${i}-${edit.queuedAt}`}>{describeEdit(edit, nameOf)}</li>
          ))}
        </ol>
      </details>
      <div className="admin-actions">
        <button type="button" onClick={onRetry}>
          Retry now
        </button>
        <button type="button" onClick={() => download(queue)}>
          Export file
        </button>
        {importer}
      </div>
    </section>
  )
}
