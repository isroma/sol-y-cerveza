import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Options = {
  callback: (token: string) => void
  'expired-callback': () => void
  'before-interactive-callback': () => void
  'error-callback': () => void
}

// One fake Cloudflare for the module's single script load.
let options: Options | null = null
window.turnstile = {
  render: (_element, rendered) => {
    options = rendered
    return 'widget'
  },
  remove: vi.fn(),
  execute: vi.fn(),
}
vi.spyOn(document.head, 'append').mockImplementation((script) => {
  if (script instanceof HTMLScriptElement)
    queueMicrotask(() => script.onload?.(new Event('load')))
})

const { Turnstile } = await import('./Turnstile.tsx')

const rendered = async () => {
  await waitFor(() => expect(options).not.toBeNull())
  if (!options) throw new Error('not rendered')
  return options
}

afterEach(() => {
  options = null
})

describe('Turnstile', () => {
  it('shows the spinner until the check passes', async () => {
    const onToken = vi.fn()
    render(<Turnstile siteKey="key" action="change" onToken={onToken} />)
    expect(
      screen.getByRole('status', { name: 'Verificando' }),
    ).toBeInTheDocument()
    const check = await rendered()
    act(() => check.callback('token'))
    expect(screen.queryByRole('status')).toBeNull()
    expect(onToken).toHaveBeenCalledWith('token')
  })

  it('leaves the spinner to the caller when told about the check', async () => {
    const onChecking = vi.fn()
    render(
      <Turnstile
        siteKey="key"
        action="change"
        onToken={vi.fn()}
        onChecking={onChecking}
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(onChecking).toHaveBeenLastCalledWith(true)
    const check = await rendered()
    act(() => check['before-interactive-callback']())
    expect(onChecking).toHaveBeenLastCalledWith(false)
  })

  it('hides it when Cloudflare shows its own box', async () => {
    render(<Turnstile siteKey="key" action="change" onToken={vi.fn()} />)
    const check = await rendered()
    act(() => check['before-interactive-callback']())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('hides it when the check fails', async () => {
    const onToken = vi.fn()
    render(<Turnstile siteKey="key" action="change" onToken={onToken} />)
    const check = await rendered()
    act(() => check['error-callback']())
    expect(screen.queryByRole('status')).toBeNull()
    expect(onToken).toHaveBeenCalledWith(null)
  })

  it('waits for `run` to show it: a deferred check has not started', async () => {
    const { rerender } = render(
      <Turnstile siteKey="key" action="change" onToken={vi.fn()} run={false} />,
    )
    await rendered()
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<Turnstile siteKey="key" action="change" onToken={vi.fn()} run />)
    expect(
      screen.getByRole('status', { name: 'Verificando' }),
    ).toBeInTheDocument()
  })

  it('shows it again while an expired token is renewed', async () => {
    render(<Turnstile siteKey="key" action="change" onToken={vi.fn()} />)
    const check = await rendered()
    act(() => check.callback('token'))
    act(() => check['expired-callback']())
    expect(
      screen.getByRole('status', { name: 'Verificando' }),
    ).toBeInTheDocument()
  })
})
