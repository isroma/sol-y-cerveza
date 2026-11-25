import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Admin } from './Admin.tsx'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { parseProposalsCsv } from './proposals.ts'
import { IDLE } from './publishStatus.ts'
import proposalsCsv from './fixtures/venue_proposals.csv?raw'
import {
  calleMenacho,
  paseoSanFrancisco,
  plazaAlta,
  sampleFile,
} from '../test/fixtures.ts'

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

  it('answers an Inbox item and moves on to the next one', async () => {
    const calls = stubServer()
    const server = globalThis.fetch
    let suggestions = [plazaAlta, calleMenacho].map((v, n) => ({
      venue_id: v.id,
      item: 'cana',
      brand: '',
      cents: 150 + n * 10,
      voters: 2,
      last: '2026-11-24T10:00:00Z',
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== ADMIN_ENDPOINTS.suggestions)
          return server(input, init)
        if (init?.method === 'POST') {
          // Resolved: the API no longer lists it.
          suggestions = suggestions.slice(1)
          return json({ ok: true })
        }
        return json({ suggestions })
      }),
    )
    render(<Admin />)
    await screen.findByRole('button', { name: new RegExp(plazaAlta.name) })

    fireEvent.click(screen.getByRole('tab', { name: /^Inbox/ }))
    const first = await screen.findByRole('button', {
      name: new RegExp(`${plazaAlta.name}.*1,50`),
    })
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Inbox 1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Accept/ }))

    await waitFor(() =>
      expect(screen.getByText('Inbox 1 of 1')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('map-selected')).toHaveTextContent(
      calleMenacho.id,
    )
    expect(
      calls.find((c) => c.url === ADMIN_ENDPOINTS.prices && c.method === 'PUT')
        ?.body,
    ).toMatchObject({ venueId: plazaAlta.id, item: 'cana', cents: 150 })
  })

  it('shows a sun report against the model and resolves it in the API only', async () => {
    const calls = stubServer()
    const server = globalThis.fetch
    let reports = [
      {
        ids: [4, 9],
        venueId: paseoSanFrancisco.id,
        leafOff: true,
        sightings: [
          {
            id: 4,
            azimuth: 176.3,
            altitude: 27.1,
            at: '2026-11-25T12:31:04.000Z',
          },
        ],
        reporters: 3,
        shown: true,
        last: '2026-11-25T12:31:04.000Z',
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== ADMIN_ENDPOINTS.sun) return server(input, init)
        if (init?.method === 'POST') {
          reports = []
          return server(input, init).then(() => json({ ok: true }))
        }
        return json({ reports })
      }),
    )
    render(<Admin />)
    await screen.findByRole('button', { name: new RegExp(plazaAlta.name) })

    fireEvent.click(screen.getByRole('tab', { name: /^Inbox/ }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: new RegExp(`${paseoSanFrancisco.name}.*leaf-off · 3 people`),
      }),
    )
    expect(screen.getByTestId('map-selected')).toHaveTextContent(
      paseoSanFrancisco.id,
    )
    const row = screen.getByRole('row', { name: /2026-11-25 13:31/ })
    expect(row).toHaveTextContent('176° / 27.1°')
    expect(row).toHaveTextContent('31.0°sun 3.9° below it')
    expect(screen.getByText(/nothing to Publish/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Accept/ }))

    await waitFor(() =>
      expect(screen.getByText('Nothing waiting here.')).toBeInTheDocument(),
    )
    expect(
      calls.filter((c) => c.method !== 'GET').map((c) => [c.url, c.body]),
    ).toEqual([[ADMIN_ENDPOINTS.sun, { ids: [4, 9], status: 'accepted' }]])
  })

  it('opens a sun report’s venue in To review to move its pin', async () => {
    stubServer()
    const server = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === ADMIN_ENDPOINTS.sun
          ? json({
              reports: [
                {
                  ids: [4],
                  venueId: calleMenacho.id,
                  leafOff: false,
                  sightings: [
                    {
                      id: 4,
                      azimuth: 120,
                      altitude: 30,
                      at: '2026-11-25T10:00:00.000Z',
                    },
                  ],
                  reporters: 1,
                  shown: false,
                  last: '2026-11-25T10:00:00.000Z',
                },
              ],
            })
          : server(input, init),
      ),
    )
    render(<Admin />)
    await screen.findByRole('button', { name: new RegExp(plazaAlta.name) })
    fireEvent.click(screen.getByRole('tab', { name: /^Inbox/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /leaf-on · 1 person/ }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Move the pin' }))

    const sidebar = screen.getByRole('tablist', { name: 'Sidebar' })
    expect(
      within(sidebar).getByRole('tab', { name: /^To review/ }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('heading', { level: 2, name: calleMenacho.name }),
    ).toBeInTheDocument()
  })
})
