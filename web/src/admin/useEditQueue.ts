import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadQueue,
  outcomeOf,
  parseQueue,
  QUEUE_STORAGE_KEY,
  replay,
  requestFor,
  serializeQueue,
  type Edit,
  type Outcome,
} from './editQueue.ts'

/** A save with no answer by then counts as "server unreachable". */
const TIMEOUT_MS = 10_000
/** How often waiting edits are tried again. */
const RETRY_EVERY_MS = 15_000

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function store(queue: readonly Edit[]) {
  try {
    const s = storage()
    if (queue.length === 0) s?.removeItem(QUEUE_STORAGE_KEY)
    else s?.setItem(QUEUE_STORAGE_KEY, serializeQueue(queue))
  } catch {
    // Storage full or blocked: the edits stay in memory for this page.
  }
}

async function send(edit: Edit): Promise<number | null> {
  const { url, init } = requestFor(edit)
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return response.status
  } catch {
    return null
  }
}

export type Rejected = { edit: Edit; status: number }

/**
 * Saves edits to the dev server, keeping the ones it can't reach (in order,
 * in localStorage) and replaying them when it is back. While edits wait, new
 * ones queue behind them so the server sees every edit in the order made.
 */
export function useEditQueue(onRejected: (rejected: Rejected[]) => void) {
  const [queue, setQueue] = useState<Edit[]>(() => loadQueue(storage()))
  const [reachable, setReachable] = useState(true)
  const queueRef = useRef(queue)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const rejectedRef = useRef(onRejected)
  useEffect(() => {
    rejectedRef.current = onRejected
  })

  const commit = useCallback((next: Edit[]) => {
    queueRef.current = next
    store(next)
    setQueue(next)
  }, [])

  // Runs one step at a time: sends and replays never overtake each other.
  const serial = useCallback(<T>(step: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(step)
    chain.current = run.catch(() => undefined)
    return run
  }, [])

  const drain = useCallback(async () => {
    if (queueRef.current.length === 0) return
    const result = await replay(queueRef.current, send)
    // Edits queued meanwhile are already behind these in queueRef.
    const sent = queueRef.current.length - result.remaining.length
    commit(queueRef.current.slice(sent))
    setReachable(result.remaining.length === 0)
    if (result.rejected.length > 0) rejectedRef.current(result.rejected)
  }, [commit])

  const flush = useCallback(() => serial(drain), [serial, drain])

  /** Saves an edit now, or queues it. */
  const submit = useCallback(
    (edit: Edit): Promise<Outcome | 'queued'> =>
      serial(async () => {
        if (queueRef.current.length > 0) {
          commit([...queueRef.current, edit])
          await drain()
          return queueRef.current.length > 0 ? 'queued' : 'saved'
        }
        const status = await send(edit)
        const outcome = outcomeOf(status)
        if (outcome === 'retry') {
          commit([edit])
          setReachable(false)
          return 'queued'
        }
        setReachable(true)
        if (outcome === 'rejected')
          rejectedRef.current([{ edit, status: status ?? 0 }])
        return outcome
      }),
    [serial, commit, drain],
  )

  /** Adds edits from an export file, behind the ones already waiting. */
  const importFile = useCallback(
    (text: string) => {
      const edits = parseQueue(text)
      return serial(async () => {
        commit([...queueRef.current, ...edits])
        await drain()
        return edits.length
      })
    },
    [serial, commit, drain],
  )

  const waiting = queue.length > 0
  useEffect(() => {
    if (!waiting) return
    const retry = () => void flush()
    const timer = window.setInterval(retry, RETRY_EVERY_MS)
    window.addEventListener('online', retry)
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [waiting, flush])

  /** The edits waiting right now, also between renders. */
  const pending = useCallback(() => queueRef.current, [])

  return { queue, reachable, submit, flush, importFile, pending }
}
