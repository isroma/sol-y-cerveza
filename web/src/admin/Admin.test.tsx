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

const SUN_VENUE = 'osm:node/4242'

/** The dev server's answers, from fixtures; every request is recorded. */
function stubServer(trust: unknown = { venues: [], missing: false }) {
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
      if (path === ADMIN_ENDPOINTS.trust) return json(trust)
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

  it('shows weak-source venues first in the queue, with the hint', async () => {
    stubServer({
      venues: [
        {
          venueId: calleMenacho.id,
          tier: 'weak',
          positionDoubtful: true,
          confidence: 0.72,
          datasets: ['BrightQuery'],
          junta: false,
        },
      ],
      missing: false,
    })
    const { container } = render(<Admin />)
    await waitFor(() =>
      expect(
        container.querySelector('.admin-queue-list li')?.textContent,
      ).toContain('Weak source, position doubtful'),
    )
    const first = container.querySelector('.admin-queue-list li button')
    expect(first?.textContent).toContain(calleMenacho.name)
    fireEvent.click(first ?? container)
    expect(
      screen.getByText(/Weak source · Overture confidence 0\.72/),
    ).toBeInTheDocument()
  })

  it('says how to write the trust tiers when the file is missing', async () => {
    stubServer({ venues: [], missing: true })
    render(<Admin />)
    expect(await screen.findByText(/No trust tiers yet/)).toBeInTheDocument()
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

  it('shows a sun report against the model, resolves it and records it for Publish', async () => {
    const calls = stubServer()
    const server = globalThis.fetch
    let accepted: unknown[] = []
    const csv: unknown[] = []
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
        const url = String(input)
        // Recorded by stubServer, answered here.
        if (url === ADMIN_ENDPOINTS.sunAccepted)
          return server(input, init).then(() => json({ reports: accepted }))
        if (url === ADMIN_ENDPOINTS.sunCorrections)
          return server(input, init).then(() =>
            json(init?.method === 'POST' ? { added: 1 } : csv),
          )
        if (url !== ADMIN_ENDPOINTS.sun) return server(input, init)
        if (init?.method === 'POST') {
          reports = []
          accepted = [
            {
              id: 4,
              // A real id: the CSV takes only ids the build's reader does,
              // which the fixtures' sample: ids are not.
              venueId: SUN_VENUE,
              leafOff: true,
              azimuth: 176.3,
              altitude: 27.1,
              at: '2026-11-25T12:31:04.000Z',
            },
          ]
          return server(input, init).then(() => json({ ok: true }))
        }
        return json({ reports })
      }),
    )
    render(<Admin />)
    await screen.findByRole('button', { name: new RegExp(plazaAlta.name) })
    // The sync on open finds nothing accepted yet.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url === ADMIN_ENDPOINTS.sunAccepted),
      ).toHaveLength(1),
    )

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
    expect(screen.getByText(/ships with the next Publish/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Accept/ }))

    await waitFor(() =>
      expect(screen.getByText('Nothing waiting here.')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(
        screen.getByText(/Recorded 1 accepted sun report in sun_corrections/),
      ).toBeInTheDocument(),
    )
    expect(
      calls.filter((c) => c.method !== 'GET').map((c) => [c.url, c.body]),
    ).toEqual([
      [ADMIN_ENDPOINTS.sun, { ids: [4, 9], status: 'accepted' }],
      [
        ADMIN_ENDPOINTS.sunCorrections,
        {
          rows: [
            {
              id: 4,
              venueId: SUN_VENUE,
              leafOff: true,
              azimuth: 176.3,
              altitude: 27.1,
              seen: '2026-11-25T12:31:04.000Z',
            },
          ],
        },
      ],
    ])
  })

  it('shows a failed sun corrections sync as an Inbox error and goes on', async () => {
    stubServer()
    render(<Admin />)
    await screen.findByRole('button', { name: new RegExp(plazaAlta.name) })
    fireEvent.click(screen.getByRole('tab', { name: /^Inbox/ }))
    expect(
      await screen.findByText(/Sun corrections: not configured/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Sun reports: not configured/)).toBeInTheDocument()
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
