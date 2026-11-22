import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { sampleFile } from './test/fixtures.ts'

// MapLibre needs WebGL, which jsdom does not provide.
vi.mock('./map/TerraceMap.tsx', () => ({
  TerraceMap: () => <div data-testid="terrace-map" />,
}))

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function listedTerraces() {
  const list = await screen.findByRole('list', { name: /Terrazas/ })
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent)
}

describe('App', () => {
  beforeEach(() => {
    // 14:00 in Madrid on the winter solstice. Only Date is faked, so
    // promises and testing-library's polling keep working.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-21T13:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders the title and the map', () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Sol y Cerveza' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('terrace-map')).toBeInTheDocument()
  })

  it('loads the terraces from a relative URL', () => {
    const fetchMock = stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(fetchMock).toHaveBeenCalledWith('./data/terraces.json')
  })

  it('defaults to now in Madrid and lists sunny terraces first', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-12-21')
    expect(screen.getByLabelText('Hora')).toHaveValue('14:00')
    expect(await listedTerraces()).toEqual([
      'Terraza de ejemplo · Plaza AltaSol · Quedan 3 h 15 min de sol hoy',
      'Terraza de ejemplo · Calle MenachoSol · Quedan 45 min de sol hoy',
      'Terraza de ejemplo · Paseo de San FranciscoSombra · Sin más sol hoy',
      'Terraza de ejemplo · Sin horizonteSin datos · Horizonte sin calcular',
    ])
  })

  it('recomputes the states when the time changes', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)
    await listedTerraces()

    fireEvent.change(screen.getByLabelText('Hora'), {
      target: { value: '20:00' },
    })

    const items = await listedTerraces()
    expect(items.every((text) => text?.includes('Noche'))).toBe(true)
  })

  it('shows the sample notice and the attribution from the file', async () => {
    stubFetch(Response.json(sampleFile))
    render(<App />)

    expect(await screen.findByRole('note')).toHaveTextContent(
      'Datos de ejemplo',
    )
    expect(
      screen.getByText('Datos de ejemplo: terrazas y horizontes ficticios'),
    ).toBeInTheDocument()
  })

  it('hides the sample notice for real data', async () => {
    stubFetch(Response.json({ ...sampleFile, sample: false }))
    render(<App />)

    await listedTerraces()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows an error when the file is malformed', async () => {
    stubFetch(Response.json({ ...sampleFile, version: 2 }))
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se han podido cargar las terrazas.',
    )
  })
})
