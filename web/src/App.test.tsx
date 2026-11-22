import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'

// MapLibre needs WebGL, which jsdom does not provide.
vi.mock('./map/TerraceMap.tsx', () => ({
  TerraceMap: () => <div data-testid="terrace-map" />,
}))

describe('App', () => {
  it('renders the title and the map', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Sol y Cerveza' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('terrace-map')).toBeInTheDocument()
  })
})
