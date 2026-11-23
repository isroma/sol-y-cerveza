import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { sampleFile } from './test/fixtures.ts'

// MapLibre needs WebGL, which jsdom does not provide. The mock shows what the
// map receives so tests can check it.
vi.mock('./map/MapView.tsx', () => ({
  MapView: ({
    statuses,
    attribution,
  }: {
    statuses: readonly { venue: { name: string } }[]
    attribution: readonly string[]
  }) => (
    <div data-testid="map">
      <span data-testid="map-count">{statuses.length}</span>
      {attribution.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  ),
}))

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function listedNames() {
  const list = await screen.findByRole('list')
  return within(list)
    .getAllByRole('button')
    .map((row) => row.querySelector('.venue-row-name')?.textContent)
}

describe('App', () => {
  beforeEach(() => {
    // 14:00 in Madrid on the winter solstice. Only Date is faked, so
    // promises and testing-library's polling keep working.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-21T13:00:00Z'))
    // The app mirrors date and time into the URL; start each test clean.
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders the brand, the controls and the map', () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Sol y Cerveza' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('searchbox', { name: 'Buscar bar o terraza' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Con sol ahora' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('loads the venues from a relative URL', () => {
    const fetchMock = stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(fetchMock).toHaveBeenCalledWith('./data/terraces.json')
  })

  it('defaults to today at the current time and lists sunny terraces first', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Hora del día')).toHaveValue('840')
    expect(await listedNames()).toEqual([
      'Terraza de ejemplo · Plaza Alta',
      'Terraza de ejemplo · Calle Menacho',
      'Terraza de ejemplo · Paseo de San Francisco',
      'Terraza de ejemplo · Sin horizonte',
    ])
    expect(
      screen.getByText('2 con sol ahora', { exact: false }),
    ).toBeInTheDocument()
  })

  it('recomputes the sun when the time changes', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()

    fireEvent.change(screen.getByLabelText('Hora del día'), {
      target: { value: '1260' },
    })

    expect(
      screen.getByText('· 0 con sol ahora', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/sin más sol hoy/i).length).toBeGreaterThan(0)
  })

  it('starts at the date and time in the URL and keeps the URL in sync', async () => {
    window.history.replaceState(null, '', '/?fecha=2026-06-21&hora=21:30')
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-06-21')
    expect(screen.getByText('21:30')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mañana' }))
    expect(window.location.search).toBe('?fecha=2026-12-22&hora=21%3A30')
  })

  it('switches to tomorrow', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Mañana' }))

    expect(screen.getByRole('button', { name: 'Mañana' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-12-22')
  })

  it('filters by sun now and by search, on the list and the map', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()

    fireEvent.click(screen.getByRole('switch', { name: 'Con sol ahora' }))
    expect(await listedNames()).toEqual([
      'Terraza de ejemplo · Plaza Alta',
      'Terraza de ejemplo · Calle Menacho',
    ])
    expect(screen.getByTestId('map-count')).toHaveTextContent('2')

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'menacho' },
    })
    expect(await listedNames()).toEqual(['Terraza de ejemplo · Calle Menacho'])
  })

  it('opens a card with sun details and no made-up values', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()

    fireEvent.click(screen.getByRole('button', { name: /Plaza Alta/ }))

    const card = screen.getByRole('article')
    expect(
      within(card).getByRole('heading', {
        name: 'Terraza de ejemplo · Plaza Alta',
      }),
    ).toBeInTheDocument()
    expect(within(card).getByText('Con sol ahora')).toBeInTheDocument()
    expect(within(card).queryByText(/€/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/^ejemplo$/)).not.toBeInTheDocument()
    const footer = within(card).getByRole('button', {
      name: /Sol hasta las 17:15/,
    })
    expect(footer).toHaveTextContent('Sol hasta las 17:15 (3 h 15 min)')

    fireEvent.click(footer)
    expect(
      within(card).getByRole('img', { name: /Sol: .*–17:15/ }),
    ).toBeInTheDocument()
    expect(within(card).getByText('Posición sin verificar')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Cerrar ficha' }))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('shows when a terrace position was checked on site', async () => {
    stubFetch(
      Response.json({
        ...sampleFile,
        terraces: sampleFile.terraces.map((terrace, index) =>
          index === 0 ? { ...terrace, verified: '2026-11-01' } : terrace,
        ),
      }),
    )
    render(<App />)
    await listedNames()

    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(sampleFile.terraces[0]?.name ?? ''),
      }),
    )
    fireEvent.click(
      within(screen.getByRole('article')).getByRole('button', {
        expanded: false,
      }),
    )
    expect(
      screen.getByText('Posición verificada el 1 nov 2026'),
    ).toBeInTheDocument()
  })

  it('shows the sample notice and passes the attribution to the map', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Datos de ejemplo',
    )
    expect(
      screen.getByText('Datos de ejemplo: terrazas y horizontes ficticios'),
    ).toBeInTheDocument()
  })

  it('turns the whole app dark at night', async () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
    stubFetch(Response.json(sampleFile))
    const { container } = render(<App />)
    await listedNames()
    const app = container.querySelector('.app')
    expect(app).not.toHaveClass('is-night')

    // 22:00 in Madrid, well after sunset on 21 December.
    window.history.replaceState(null, '', '/?fecha=2026-12-21&hora=22:00')
    const { container: night } = render(<App />)
    await waitFor(() =>
      expect(night.querySelector('.app')).toHaveClass('is-night'),
    )
    expect(meta).toHaveAttribute('content', '#141826')
    meta.remove()
  })

  it('hides the sample notice for real data', async () => {
    stubFetch(Response.json({ ...sampleFile, sample: false }))
    render(<App />)

    await listedNames()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows an error when the file is malformed', async () => {
    stubFetch(Response.json({ ...sampleFile, version: 1 }))
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se han podido cargar las terrazas.',
    )
  })
})
