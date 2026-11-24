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
      /** 'execute': the widget loads, and its check waits for execute(). */
      execution?: 'render' | 'execute'
      language: string
    },
  ) => string
  execute: (widgetId: string) => void
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
  /** The API checks it per endpoint: 'suggest' for prices, 'report' for venue reports, 'change' for the card back. */
  action?: string
  /**
   * Run the check now (default) or once this turns true: the widget loads at
   * once either way, so a deferred check starts without the script's delay.
   */
  run?: boolean
}

/** Cloudflare's bot check; invisible unless Cloudflare wants an interaction. */
export function Turnstile({
  siteKey,
  onToken,
  action = 'suggest',
  run = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Once Cloudflare is happy, its "success" box adds nothing: fold it away.
  const [passed, setPassed] = useState(false)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

  // Whether the check was asked for at render time; later, `run` executes it.
  const deferred = useRef(!run)
  const widgetRef = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const executed = useRef(false)
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
    const widget = widgetRef.current
    if (run && deferred.current && widget && !executed.current) {
      executed.current = true
      widget.api.execute(widget.id)
    }
  }, [run])

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
            // A deferred check runs again when `run` next turns true.
            executed.current = false
            setPassed(false)
            onTokenRef.current(null)
          },
          appearance: 'interaction-only',
          execution: deferred.current ? 'execute' : 'render',
          language: 'es',
        })
        widgetRef.current = { api: loaded, id: widget }
        // `run` turned true while the script was loading.
        if (deferred.current && runRef.current && !executed.current) {
          executed.current = true
          loaded.execute(widget)
        }
      })
      .catch(() => onTokenRef.current(null))
    return () => {
      cancelled = true
      widgetRef.current = null
      executed.current = false
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
