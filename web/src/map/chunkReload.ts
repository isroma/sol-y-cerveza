/** sessionStorage key: when we last reloaded because a chunk failed to load. */
export const CHUNK_RELOAD_KEY = 'syc:chunk-reload'

/** A second failure within this window is not retried: no reload loops. */
const RETRY_WINDOW_MS = 60_000

type Deps = {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  reload: () => void
  now: () => number
}

function sessionStore(): Deps['storage'] {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const browser: Deps = {
  storage: null,
  reload: () => window.location.reload(),
  now: () => Date.now(),
}

/**
 * Runs a dynamic import. If it fails, typically because a deploy removed
 * the old hashed chunk an open page still asks for, reloads the page once
 * so it picks up the new version. A second failure soon after rejects, so
 * the caller can show an error instead of looping. Without sessionStorage
 * there is no loop guard, so it never reloads.
 */
export async function importOrReload<T>(
  load: () => Promise<T>,
  deps: Deps = { ...browser, storage: sessionStore() },
): Promise<T> {
  const { storage, reload, now } = deps
  try {
    const loaded = await load()
    safely(() => storage?.removeItem(CHUNK_RELOAD_KEY))
    return loaded
  } catch (error) {
    const last = Number(safely(() => storage?.getItem(CHUNK_RELOAD_KEY)) ?? 0)
    if (storage === null || now() - last <= RETRY_WINDOW_MS) throw error
    const saved = safely(() => {
      storage.setItem(CHUNK_RELOAD_KEY, String(now()))
      return true
    })
    if (!saved) throw error
    reload()
    // The page is going away; never settle, so nothing renders an error.
    return new Promise<T>(() => {})
  }
}

function safely<T>(run: () => T): T | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}
