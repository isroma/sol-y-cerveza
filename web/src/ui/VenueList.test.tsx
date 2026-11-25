import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VenueList } from './VenueList.tsx'

describe('VenueList adding a missing bar', () => {
  it('offers it beside the count', () => {
    const onAdd = vi.fn()
    render(
      <VenueList
        statuses={[]}
        total={10}
        minutes={600}
        selectedId={null}
        onSelect={() => {}}
        onAdd={onAdd}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Añadir un bar que falta' }),
    )
    expect(onAdd).toHaveBeenCalledWith()
  })

  it('offers it, with the searched name, when no bar has that name', () => {
    const onAdd = vi.fn()
    render(
      <VenueList
        statuses={[]}
        total={10}
        minutes={600}
        selectedId={null}
        onSelect={() => {}}
        onAdd={onAdd}
        query="  Bar La Cueva "
        nameUnknown
      />,
    )
    expect(screen.getByText('No hay bares con ese nombre.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Añádelo/ }))
    expect(onAdd).toHaveBeenCalledWith('Bar La Cueva')
  })

  it('blames the filters when the name exists but is filtered out', () => {
    render(
      <VenueList
        statuses={[]}
        total={10}
        minutes={600}
        selectedId={null}
        onSelect={() => {}}
        onAdd={() => {}}
        query="Pilar"
      />,
    )
    expect(
      screen.getByText('Ningún bar cumple los filtros.'),
    ).toBeInTheDocument()
  })
})
