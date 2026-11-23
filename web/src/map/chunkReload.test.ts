import { describe, expect, it, vi } from 'vitest'
import { CHUNK_RELOAD_KEY, importOrReload } from './chunkReload.ts'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

const failed = () => Promise.reject(new Error('Failed to fetch module'))

describe('importOrReload', () => {
  it('returns the module and clears the guard', async () => {
    const storage = memoryStorage()
    storage.setItem(CHUNK_RELOAD_KEY, '1')
    const reload = vi.fn()
    await expect(
      importOrReload(() => Promise.resolve('map'), {
        storage,
        reload,
        now: () => 100_000,
      }),
    ).resolves.toBe('map')
    expect(reload).not.toHaveBeenCalled()
    expect(storage.items.has(CHUNK_RELOAD_KEY)).toBe(false)
  })

  it('reloads once when the chunk is gone', async () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    void importOrReload(failed, { storage, reload, now: () => 100_000 })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(storage.getItem(CHUNK_RELOAD_KEY)).toBe('100000')
  })

  it('does not reload again right after a reload', async () => {
    const storage = memoryStorage()
    storage.setItem(CHUNK_RELOAD_KEY, '100000')
    const reload = vi.fn()
    await expect(
      importOrReload(failed, { storage, reload, now: () => 130_000 }),
    ).rejects.toThrow('Failed to fetch module')
    expect(reload).not.toHaveBeenCalled()
  })

  it('may reload again much later', async () => {
    const storage = memoryStorage()
    storage.setItem(CHUNK_RELOAD_KEY, '100000')
    const reload = vi.fn()
    void importOrReload(failed, { storage, reload, now: () => 500_000 })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('never reloads without sessionStorage', async () => {
    const reload = vi.fn()
    await expect(
      importOrReload(failed, { storage: null, reload, now: () => 100_000 }),
    ).rejects.toThrow()
    expect(reload).not.toHaveBeenCalled()
  })
})
