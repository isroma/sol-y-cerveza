import { fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MapControls } from './MapControls.tsx'
import { ISSUES_URL } from '../ui/PrivacyNotice.tsx'

// MapLibre needs WebGL; the controls only use its Marker for the user's dot.
vi.mock('maplibre-gl', () => ({ Marker: class {} }))

// The usage counters: opening the privacy notice must never count.
const telemetry = vi.hoisted(() => ({ track: vi.fn() }))
vi.mock('../telemetry.ts', () => telemetry)

function renderControls() {
  render(
    <MapControls
      mapRef={createRef()}
      ready={false}
      attribution={['© OpenStreetMap contributors (ODbL)']}
      leafOffTrees={false}
    />,
  )
  return screen.getByRole('button', { name: 'Información sobre los datos' })
}

describe('the privacy notice', () => {
  it('opens from "Sobre los datos", goes back, and closes with the info button', () => {
    const info = renderControls()
    fireEvent.click(info)
    const about = screen.getByRole('dialog', { name: 'Sobre los datos' })
    fireEvent.click(within(about).getByRole('button', { name: 'Privacidad' }))

    const notice = screen.getByRole('dialog', { name: 'Privacidad' })
    expect(
      within(notice).getByRole('heading', { name: 'Privacidad' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Sobre los datos' })).toBeNull()

    fireEvent.click(
      within(notice).getByRole('button', {
        name: 'Volver a Sobre los datos',
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Sobre los datos' }),
    ).toBeInTheDocument()

    // The info button closes it, and reopens on "Sobre los datos".
    fireEvent.click(screen.getByRole('button', { name: 'Privacidad' }))
    fireEvent.click(info)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(info)
    expect(
      screen.getByRole('dialog', { name: 'Sobre los datos' }),
    ).toBeInTheDocument()
    expect(telemetry.track).not.toHaveBeenCalled()
  })

  it('names the contact, the rights and the providers', () => {
    fireEvent.click(renderControls())
    fireEvent.click(screen.getByRole('button', { name: 'Privacidad' }))
    const notice = screen.getByRole('dialog', { name: 'Privacidad' })
    expect(
      within(notice).getByRole('link', { name: 'GitHub' }),
    ).toHaveAttribute('href', ISSUES_URL)
    expect(
      within(notice).getByRole('link', { name: 'www.aepd.es' }),
    ).toHaveAttribute('href', 'https://www.aepd.es')
    const text = notice.textContent ?? ''
    for (const phrase of [
      'No hay cuentas, publicidad ni cookies',
      'tu posición no se envía a nadie',
      'Global Privacy Control o Do Not Track',
      'nunca la dirección en sí',
      'interés legítimo',
      'No hay un plazo fijo de borrado',
      'GitHub Pages',
      'OpenFreeMap',
      'Cloudflare',
    ])
      expect(text).toContain(phrase)
  })
})
