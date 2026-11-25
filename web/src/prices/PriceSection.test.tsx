import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { PriceSection } from './PriceSection.tsx'

// No visitor prices and no owner session: only the curated prices count.
vi.mock('./crowd.ts', async (importActual) => ({
  ...(await importActual<typeof import('./crowd.ts')>()),
  useCrowdPrices: () => [],
}))

const venue: Terrace = {
  id: 'curated:x',
  name: 'Café La Plaza',
  kind: 'cafe',
  venue: { lat: 38.88, lon: -6.97 },
  terrace: { lat: 38.88, lon: -6.97 },
  sources: ['curated'],
  verified: null,
  horizon: null,
}

describe('PriceSection', () => {
  it('shows nothing while a bar has no price', () => {
    const { container } = render(<PriceSection venue={venue} />)
    expect(container).toBeEmptyDOMElement()
  })

  const priced = (prices: Terrace['prices']) => ({ ...venue, prices })

  it('shows a pill per drink, with a hint to tap them', () => {
    render(
      <PriceSection
        venue={priced([
          { item: 'cana', brand: null, cents: 140, seen: '2026-11-25' },
          {
            item: 'tercio',
            brand: 'cruzcampo',
            cents: 200,
            seen: '2026-11-25',
          },
        ])}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Caña 1,40 €' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Tercio 2,00 €' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Toca caña o tercio para ver los detalles'),
    ).toBeInTheDocument()
  })

  it('opens the details of the tapped drink, and closes them again', () => {
    render(
      <PriceSection
        venue={priced([
          {
            item: 'tercio',
            brand: 'cruzcampo',
            cents: 200,
            seen: '2026-11-25',
          },
        ])}
      />,
    )
    expect(
      screen.getByText('Toca el tercio para ver los detalles'),
    ).toBeInTheDocument()
    const tercio = screen.getByRole('button', { name: 'Tercio 2,00 €' })
    fireEvent.click(tercio)
    expect(tercio).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Tercio de Cruzcampo')).toBeInTheDocument()
    expect(
      screen.getByText('Actualizado en Sol y Cerveza el 25 nov'),
    ).toBeInTheDocument()
    fireEvent.click(tercio)
    expect(tercio).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows "~" and the middle price when tercio brands differ, exact ones inside', () => {
    render(
      <PriceSection
        venue={priced([
          {
            item: 'tercio',
            brand: 'cruzcampo',
            cents: 200,
            seen: '2026-11-20',
          },
          {
            item: 'tercio',
            brand: 'mahou-5-estrellas',
            cents: 220,
            seen: '2026-11-25',
          },
          {
            item: 'tercio',
            brand: 'alhambra-especial',
            cents: 250,
            seen: '2026-11-22',
          },
        ])}
      />,
    )
    const tercio = screen.getByRole('button', { name: 'Tercio ~2,20 €' })
    fireEvent.click(tercio)
    expect(screen.getByText('Tercios')).toBeInTheDocument()
    expect(screen.getByText('Mahou 5 Estrellas')).toBeInTheDocument()
    expect(screen.getByText('2,50 €')).toBeInTheDocument()
    expect(
      screen.getByText('Actualizado en Sol y Cerveza el 25 nov'),
    ).toBeInTheDocument()
  })
})
