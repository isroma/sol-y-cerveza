import { useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      /** Checked by the API, so a token from another page or site is refused. */
      action: string
      callback: (token: string) => void
      'expired-callback': () => void
      appearance: 'always' | 'execute' | 'interaction-only'
      language: string
    },
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not load'))
    script.onerror = () => reject(new Error('Turnstile did not load'))
    document.head.append(script)
  })
  return loading
}

type Props = {
  siteKey: string
  /** A fresh token, or null when it expired. */
  onToken: (token: string | null) => void
  /** The API checks it per endpoint: 'suggest' for prices, 'report' for venue reports. */
  action?: string
}

/** Cloudflare's bot check; invisible unless Cloudflare wants an interaction. */
export function Turnstile({ siteKey, onToken, action = 'suggest' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Once Cloudflare is happy, its "success" box adds nothing: fold it away.
  const [passed, setPassed] = useState(false)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let widget: string | null = null
    let api: TurnstileApi | null = null
    let cancelled = false
    loadTurnstile()
      .then((loaded) => {
        if (cancelled) return
        api = loaded
        widget = loaded.render(element, {
          sitekey: siteKey,
          action,
          callback: (token) => {
            setPassed(true)
            onTokenRef.current(token)
          },
          'expired-callback': () => {
            setPassed(false)
            onTokenRef.current(null)
          },
          appearance: 'interaction-only',
          language: 'es',
        })
      })
      .catch(() => onTokenRef.current(null))
    return () => {
      cancelled = true
      if (api && widget) api.remove(widget)
    }
  }, [siteKey, action])

  return (
    <div
      ref={ref}
      className={passed ? 'price-turnstile is-passed' : 'price-turnstile'}
    />
  )
}
