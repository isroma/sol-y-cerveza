import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Admin } from './Admin.tsx'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { parseProposalsCsv } from './proposals.ts'
import { IDLE } from './publishStatus.ts'
import proposalsCsv from './fixtures/venue_proposals.csv?raw'
import { calleMenacho, plazaAlta, sampleFile } from '../test/fixtures.ts'

// MapLibre needs WebGL, which jsdom does not provide. The mock shows what the
// map receives so tests can check it.
vi.mock('./AdminMap.tsx', () => ({
  AdminMap: ({
    venues,
    selected,
  }: {
    venues: readonly { id: string }[]
    selected: { id: string } | null
  }) => (
    <div data-testid="map">
      <span data-testid="map-count">{venues.length}</span>
      <span data-testid="map-selected">{selected?.id ?? ''}</span>
    </div>
  ),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type Call = { url: string; method: string; body: unknown }

/** The dev server's answers, from fixtures; every request is recorded. */
function stubServer() {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ url, method, body })
      const path = url.split('?')[0]
      if (path === './data/terraces.json') return json(sampleFile)
      if (path === ADMIN_ENDPOINTS.review)
        return json(method === 'PUT' ? body : [])
      if (path === ADMIN_ENDPOINTS.prices) return json([])
      if (path === ADMIN_ENDPOINTS.proposals)
        return json({ ...parseProposalsCsv(proposalsCsv), ignored: [] })
      if (path === ADMIN_ENDPOINTS.publish) return json(IDLE)
      if (path === ADMIN_ENDPOINTS.pricePhoto)
        return json({ enabled: false, hint: 'no key' })
      return json({ error: 'not configured' }, 503)
    }),
  )
  return calls
}

describe('Admin', () => {
  beforeEach(() => {
    // Only Date is faked, so promises and testing-library's polling work.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists the venues, selects one and saves a decision', async () => {
    const calls = stubServer()
    render(<Admin />)

    const row = await screen.findByRole('button', {
      name: new RegExp(plazaAlta.name),
    })
    expect(
      screen.getByRole('button', { name: new RegExp(calleMenacho.name) }),
    ).toBeInTheDocument()
    expect(screen.getByText(/0 of 4 reviewed/)).toBeInTheDocument()
    expect(screen.getByTestId('map-count')).toHaveTextContent('4')

    fireEvent.click(row)
    expect(
      screen.getByRole('heading', { level: 2, name: plazaAlta.name }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('map-selected')).toHaveTextContent(plazaAlta.id)

    fireEvent.click(screen.getByRole('button', { name: /^No terrace/ }))

    await waitFor(() => expect(screen.getByText(/Saved/)).toBeInTheDocument())
    const puts = calls.filter(
      (c) => c.url === ADMIN_ENDPOINTS.review && c.method === 'PUT',
    )
    expect(puts).toHaveLength(1)
    expect(puts[0]?.body).toEqual({
      venueId: plazaAlta.id,
      status: 'no_terrace',
      name: null,
      kind: null,
      venue: null,
      terrace: null,
      reviewed: '2026-11-25',
      looksRight: false,
    })
    expect(screen.getByText(/1 of 4 reviewed/)).toBeInTheDocument()
  })

  it('takes the decision keys on the selected venue', async () => {
    const calls = stubServer()
    render(<Admin />)
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(plazaAlta.name) }),
    )

    fireEvent.keyDown(window, { key: 'x' })

    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.url === ADMIN_ENDPOINTS.review && c.method === 'PUT',
        )?.body,
      ).toMatchObject({ venueId: plazaAlta.id, status: 'not_venue' }),
    )
  })
})
