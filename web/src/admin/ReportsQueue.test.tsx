import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsQueue } from './ReportsQueue.tsx'

const closed = {
  ids: [3, 9],
  kind: 'closed',
  venueId: 'osm:node/1',
  reporters: 2,
  last: '2026-11-24T10:00:00.000Z',
}
const gone = { ...closed, ids: [7], venueId: 'osm:node/99', reporters: 1 }
const add = {
  ids: [5],
  kind: 'add',
  name: 'Bar Nuevo',
  venueKind: 'bar',
  terrace: false,
  lat: 38.878,
  lon: -6.97,
  reporters: 1,
  last: '2026-11-24T08:00:00.000Z',
}

function stubApi(reports: unknown[]) {
  const posts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return new Response('{"updated":1}', { status: 200 })
      }
      return new Response(JSON.stringify({ reports }), { status: 200 })
    }),
  )
  return posts
}

const venueOf = (id: string) =>
  id === 'osm:node/1'
    ? { name: 'Bar Pepe', at: { lat: 38.878, lon: -6.97 } }
    : undefined

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportsQueue', () => {
  it('accepts, then resolves the entry’s ids', async () => {
    const posts = stubApi([closed])
    const onAccept = vi.fn(async () => true)
    render(
      <ReportsQueue
        venueOf={venueOf}
        onSelect={() => undefined}
        onAccept={onAccept}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() =>
      expect(posts).toEqual([{ ids: [3, 9], status: 'accepted' }]),
    )
    expect(onAccept).toHaveBeenCalledOnce()
  })

  it('does not resolve when the review was not saved', async () => {
    const posts = stubApi([closed])
    const onAccept = vi.fn(async () => false)
    render(
      <ReportsQueue
        venueOf={venueOf}
        onSelect={() => undefined}
        onAccept={onAccept}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(onAccept).toHaveBeenCalledOnce())
    expect(posts).toEqual([])
  })

  it('selects a report, and only lets a stale one be rejected', async () => {
    const posts = stubApi([gone, add])
    const onSelect = vi.fn()
    render(
      <ReportsQueue
        venueOf={venueOf}
        onSelect={onSelect}
        onAccept={async () => true}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'New · Bar Nuevo (bar)' }),
    )
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ids: [5] }))
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]!)
    await waitFor(() =>
      expect(posts).toEqual([{ ids: [7], status: 'rejected' }]),
    )
  })

  it('says why the queue is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"set VITE_PRICES_API"}', { status: 503 }),
      ),
    )
    render(
      <ReportsQueue
        venueOf={venueOf}
        onSelect={() => undefined}
        onAccept={async () => true}
      />,
    )
    expect(
      await screen.findByText('Reports unavailable: set VITE_PRICES_API'),
    ).toBeTruthy()
  })
})
