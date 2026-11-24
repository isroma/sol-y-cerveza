import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { BatchDismiss } from './BatchDismiss.tsx'
import type { JunkItem } from './junk.ts'

function venue(id: string, name: string): Terrace {
  return {
    id,
    name,
    kind: 'bar',
    venue: { lat: 38.88, lon: -6.97 },
    terrace: null,
    sources: ['overture'],
    verified: null,
    horizon: null,
  }
}

const items: JunkItem[] = [
  { venue: venue('overture:1', 'Estanco 30'), signals: ['name'] },
  { venue: venue('overture:2', 'Telepizza'), signals: ['takeaway'] },
  { venue: venue('overture:3', 'Venta'), signals: ['far', 'isolated'] },
]

describe('BatchDismiss', () => {
  it('ticks strong signals and marks the ticked ones', () => {
    const onMark = vi.fn()
    render(
      <BatchDismiss items={items} onSelect={() => undefined} onMark={onMark} />,
    )
    expect(screen.getByText(/more than 4 km from the centre/)).toBeVisible()
    const [, telepizza, venta] = screen.getAllByRole('checkbox')
    if (!telepizza || !venta) throw new Error('missing checkboxes')
    fireEvent.click(telepizza)
    fireEvent.click(venta)
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark 2 as not a venue' }),
    )
    expect(onMark).toHaveBeenCalledWith(['overture:1', 'overture:3'])
  })

  it('selects all or none', () => {
    render(
      <BatchDismiss
        items={items}
        onSelect={() => undefined}
        onMark={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(
      screen.getByRole('button', { name: 'Mark 0 as not a venue' }),
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(
      screen.getByRole('button', { name: 'Mark 3 as not a venue' }),
    ).toBeEnabled()
  })
})
