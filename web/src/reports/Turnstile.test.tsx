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
  it('hands over the token when the check passes, and folds the box away', async () => {
    const onToken = vi.fn()
    const { container } = render(
      <Turnstile siteKey="key" action="change" onToken={onToken} />,
    )
    const check = await rendered()
    act(() => check.callback('token'))
    expect(onToken).toHaveBeenCalledWith('token')
    expect(container.querySelector('.price-turnstile.is-passed')).not.toBeNull()
  })

  it('shows nothing of its own while the check runs', async () => {
    render(<Turnstile siteKey="key" action="change" onToken={vi.fn()} />)
    await rendered()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a failed check as no token', async () => {
    const onToken = vi.fn()
    render(<Turnstile siteKey="key" action="change" onToken={onToken} />)
    const check = await rendered()
    act(() => check['error-callback']())
    expect(onToken).toHaveBeenCalledWith(null)
  })

  it('runs a deferred check once `run` turns true', async () => {
    const execute = vi.mocked(window.turnstile?.execute)
    execute?.mockClear()
    const { rerender } = render(
      <Turnstile siteKey="key" action="change" onToken={vi.fn()} run={false} />,
    )
    await rendered()
    expect(execute).not.toHaveBeenCalled()
    rerender(<Turnstile siteKey="key" action="change" onToken={vi.fn()} run />)
    expect(execute).toHaveBeenCalledWith('widget')
  })
})
