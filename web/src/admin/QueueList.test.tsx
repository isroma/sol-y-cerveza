import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueueList } from './QueueList.tsx'
import { scoreVenues } from './queueScore.ts'
import { calleMenacho, plazaAlta } from '../test/fixtures.ts'

const CENTRE = { lat: 38.878, lon: -6.97 }
const queue = scoreVenues(
  [plazaAlta, calleMenacho],
  new Map(),
  new Map(),
  CENTRE,
)

describe('QueueList', () => {
  it('ranks the queue, marks skipped and selected venues, and selects', () => {
    const onSelect = vi.fn()
    render(
      <QueueList
        queue={queue}
        skipped={[calleMenacho.id]}
        selectedId={plazaAlta.id}
        onSelect={onSelect}
      />,
    )
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveTextContent(`1${plazaAlta.name}`)
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(first).not.toHaveTextContent('Skipped')
    expect(second).toHaveTextContent(`2${calleMenacho.name}Skipped · `)
    expect(second).not.toHaveAttribute('aria-current')
    fireEvent.click(second!)
    expect(onSelect).toHaveBeenCalledWith(calleMenacho.id)
  })
})
