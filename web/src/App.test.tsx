import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { plazaAlta, sampleFile } from './test/fixtures.ts'

// MapLibre needs WebGL, which jsdom does not provide. The mock shows what the
// map receives so tests can check it.
vi.mock('./map/MapView.tsx', () => ({
  MapView: ({
    statuses,
    selectedId,
    attribution,
  }: {
    statuses: readonly { venue: { name: string } }[]
    selectedId: string | null
    attribution: readonly string[]
  }) => (
    <div data-testid="map">
      <span data-testid="map-count">{statuses.length}</span>
      <span data-testid="map-selected">{selectedId ?? ''}</span>
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
    // The app mirrors the time and the venue into the URL; start each test
    // clean.
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

  it('on phones, keeps the time in the footer and the rest in a menu', () => {
    stubFetch(Response.json(sampleFile))
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) satisfies Partial<MediaQueryList>,
    )
    render(<App />)

    expect(screen.getByRole('slider', { name: 'Hora del día' })).toBeVisible()
    expect(
      screen.queryByRole('searchbox', { name: 'Buscar bar o terraza' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    expect(
      screen.getByRole('searchbox', { name: 'Buscar bar o terraza' }),
    ).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }))
    expect(
      screen.queryByRole('searchbox', { name: 'Buscar bar o terraza' }),
    ).not.toBeInTheDocument()
  })

  it('loads the venues from a relative URL', () => {
    const fetchMock = stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(fetchMock).toHaveBeenCalledWith('./data/terraces.json')
  })

  it('defaults to today at the current time and lists sunny terraces first', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(screen.getByLabelText('Hora del día')).toHaveValue('840')
    expect(screen.getByTestId('map-selected')).toBeEmptyDOMElement()
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

  it('mirrors the chosen time and venue into the URL', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()
    expect(window.location.search).toBe('')

    fireEvent.change(screen.getByLabelText('Hora del día'), {
      target: { value: '1080' },
    })
    expect(window.location.search).toBe('?t=18:00')

    fireEvent.click(
      screen.getByRole('button', { name: /Terraza de ejemplo · Plaza Alta/ }),
    )
    expect(window.location.search).toBe('?t=18:00&v=sample:plaza-alta')

    // Back to now: the time follows the clock again and leaves the URL.
    fireEvent.click(screen.getByRole('button', { name: /Volver a ahora/ }))
    expect(window.location.search).toBe('?v=sample:plaza-alta')
  })

  it('opens a shared link at its time with its venue selected', async () => {
    window.history.replaceState(null, '', '/?t=18:00&v=sample:plaza-alta')
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()

    expect(screen.getByLabelText('Hora del día')).toHaveValue('1080')
    expect(screen.getByTestId('map-selected')).toHaveTextContent(
      'sample:plaza-alta',
    )
    expect(window.location.search).toBe('?t=18:00&v=sample:plaza-alta')
  })

  it('ignores bad values and unknown venues in the URL', async () => {
    window.history.replaceState(null, '', '/?t=27:00&v=sample:gone&utm=x')
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedNames()

    expect(screen.getByLabelText('Hora del día')).toHaveValue('840')
    await waitFor(() =>
      expect(screen.getByTestId('map-selected')).toBeEmptyDOMElement(),
    )
    expect(window.location.search).toBe('?utm=x')
  })

  it('shows a linked venue without a terrace', async () => {
    const noTerrace = { ...plazaAlta, id: 'sample:bar', terrace: null }
    window.history.replaceState(null, '', '/?v=sample:bar')
    stubFetch(
      Response.json({
        ...sampleFile,
        terraces: [...sampleFile.terraces, noTerrace],
      }),
    )
    render(<App />)
    await listedNames()

    expect(
      screen.getByRole('switch', { name: 'Solo con terraza' }),
    ).not.toBeChecked()
    expect(screen.getByTestId('map-selected')).toHaveTextContent('sample:bar')
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

  it('marks sunrise, sunset and now on the time bar', async () => {
    stubFetch(Response.json(sampleFile))
    const { container } = render(<App />)
    await listedNames()

    expect(
      screen.getByText(/Amanecer a las 08:\d\d, atardecer a las 18:\d\d/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Volver a ahora/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('Hora del día'), {
      target: { value: '1080' },
    })
    const now = screen.getByRole('button', { name: 'Volver a ahora (14:00)' })
    fireEvent.click(now)
    expect(screen.getByLabelText('Hora del día')).toHaveValue('840')
    expect(screen.queryByRole('button', { name: /Volver a ahora/ })).toBeNull()
    expect(container.querySelector('.time-marker--sunrise')).not.toBeNull()
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
    vi.setSystemTime(new Date('2026-12-21T21:00:00Z'))
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
