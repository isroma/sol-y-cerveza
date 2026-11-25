import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, EyeIcon, EyeOffIcon } from '../ui/icons.tsx'
import { refreshCrowdPrices } from './crowd.ts'
import { logIn, logOut, useOwner, type LoginResult } from './owner.ts'
import './prices.css'

const LOGIN_TEXT: Record<Exclude<LoginResult, 'ok'>, string> = {
  wrong: 'Usuario o contraseña incorrectos.',
  'too-many': 'Demasiados intentos. Prueba dentro de 15 minutos.',
  error: 'No se ha podido entrar. Inténtalo de nuevo.',
}

/** The app opened from /admin (public/admin/index.html sends it to #admin). */
const wantsLogin = () => window.location.hash === '#admin'

/**
 * Owner mode in the header: "Admin" while logged in, and the login that
 * /admin opens. The pill opens the same panel, to log out. Owner mode itself
 * is the visitor's forms, whose sends become changes (owner.ts).
 */
export function AdminButton() {
  const { token } = useOwner()
  const [open, setOpen] = useState(wantsLogin)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // /admin while the app is open, and the hash cleared once seen.
  useEffect(() => {
    const onHash = () => {
      if (wantsLogin()) setOpen(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!open || !wantsLogin()) return
    const { pathname, search } = window.location
    history.replaceState(null, '', pathname + search)
  }, [open])

  // The owner sees what they saved, not the 5-minute browser cache.
  useEffect(() => {
    if (token) void refreshCrowdPrices()
  }, [token])

  useEffect(() => {
    if (!open) return
    panelRef.current
      ?.querySelector<HTMLElement>('input, button.admin-panel-main')
      ?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, token])

  const submit = async () => {
    setBusy(true)
    setError(null)
    const result = await logIn(username.trim(), password)
    setBusy(false)
    if (result !== 'ok') return setError(LOGIN_TEXT[result])
    setPassword('')
    setShowPassword(false)
    setOpen(false)
  }

  return (
    <>
      {token && (
        <button
          type="button"
          className="admin-pill"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Admin
        </button>
      )}
      {open &&
        // On the body: the header is its own stacking layer, under the sidebar.
        createPortal(
          <div
            ref={panelRef}
            className="admin-panel"
            role="dialog"
            aria-label="Admin"
          >
            <button
              type="button"
              className="admin-panel-close"
              aria-label="Cerrar"
              title="Cerrar"
              onClick={() => setOpen(false)}
            >
              <CloseIcon size={20} />
            </button>
            {token ? (
              <>
                <strong>Admin</strong>
                <p>
                  Sesión iniciada. Tus cambios se guardan directamente: los
                  precios se ven al momento y las ubicaciones al publicar.
                </p>
                <div className="admin-panel-actions">
                  <button
                    type="button"
                    className="admin-panel-main"
                    onClick={() => {
                      logOut()
                      setOpen(false)
                    }}
                  >
                    Cerrar sesión
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void submit()
                }}
              >
                <strong>Admin</strong>
                <input
                  aria-label="Usuario"
                  placeholder="Usuario"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <span className="admin-password">
                  <input
                    aria-label="Contraseña"
                    placeholder="Contraseña"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                    }
                    title={
                      showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </span>
                {error && <p role="alert">{error}</p>}
                <div className="admin-panel-actions">
                  <button
                    type="submit"
                    className="admin-panel-main"
                    disabled={busy || !username.trim() || !password}
                  >
                    {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
                  </button>
                </div>
              </form>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
