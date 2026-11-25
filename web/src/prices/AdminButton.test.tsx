import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminButton } from './AdminButton.tsx'

afterEach(() => {
  window.location.hash = ''
})

describe('AdminButton', () => {
  it('opens the login at #admin and shows the password on request', () => {
    window.location.hash = '#admin'
    render(<AdminButton />)
    const password = screen.getByLabelText('Contraseña')
    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(password).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(password).toHaveAttribute('type', 'password')
    expect(
      screen.getByRole('button', { name: 'Iniciar sesión' }),
    ).toBeDisabled()
  })
})
