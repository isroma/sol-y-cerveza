import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PriceCandidates } from './PriceCandidates.tsx'

const cana = {
  venueId: 'osm:node/1',
  item: 'cana',
  brand: null,
  cents: 150,
  sourceUrl: 'https://www.bar.es/carta',
  snippet: 'Caña 1,50 €',
  fetched: '2026-11-20',
  status: 'pending',
}
const tercio = {
  ...cana,
  item: 'tercio',
  brand: 'sagres',
  cents: 210,
  snippet: 'Tercio Sagres 2,10 €',
}
const done = { ...cana, cents: 140, status: 'dismissed' }

function stubApi(candidates: unknown[], leads: unknown[] = []) {
  const posts: unknown[] = []
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return new Response('{}', { status: 200 })
    }
    return new Response(JSON.stringify({ candidates, leads }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return posts
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PriceCandidates', () => {
  it('lists pending candidates with their snippet and source', async () => {
    stubApi(
      [cana, tercio, done],
      [
        {
          venueId: 'osm:node/1',
          url: 'https://bar.es/docs/Carta%20bebidas.pdf',
        },
      ],
    )
    render(
      <PriceCandidates
        nameOf={() => 'Bar Pepe'}
        onSelect={() => undefined}
        onAccept={async () => undefined}
      />,
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Website price candidates (2)',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Caña 1,50 €', { selector: 'q' })).toBeVisible()
    expect(screen.getByText('Tercio Sagres')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'bar.es' })[0]).toHaveAttribute(
      'href',
      'https://www.bar.es/carta',
    )
    expect(screen.getByRole('link', { name: 'Carta bebidas.pdf' })).toBeTruthy()
  })

  it('accepts into the prices and records the decision', async () => {
    const posts = stubApi([cana])
    const onAccept = vi.fn(async () => undefined)
    render(
      <PriceCandidates
        nameOf={(id) => id}
        onSelect={() => undefined}
        onAccept={onAccept}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(onAccept).toHaveBeenCalledWith({
      venueId: 'osm:node/1',
      item: 'cana',
      brand: null,
      cents: 150,
      seen: '2026-11-20',
    })
    expect(posts[0]).toEqual({
      key: 'osm:node/1|cana||150|https://www.bar.es/carta',
      status: 'accepted',
    })
  })

  it('dismisses without saving a price', async () => {
    const posts = stubApi([cana])
    const onAccept = vi.fn(async () => undefined)
    render(
      <PriceCandidates
        nameOf={(id) => id}
        onSelect={() => undefined}
        onAccept={onAccept}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(onAccept).not.toHaveBeenCalled()
    expect(posts[0]).toMatchObject({ status: 'dismissed' })
  })

  it('says how to get candidates when there are none', async () => {
    stubApi([done])
    render(
      <PriceCandidates
        nameOf={(id) => id}
        onSelect={() => undefined}
        onAccept={async () => undefined}
      />,
    )
    expect(
      await screen.findByText(/solycerveza.price_candidates/),
    ).toBeInTheDocument()
  })
})
