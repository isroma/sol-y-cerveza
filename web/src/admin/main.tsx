import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Admin } from './Admin.tsx'
import { pageToken, TOKEN_PARAM, withAdminToken } from './lanToken.ts'
import './admin.css'

// LAN mode (`npm run admin:lan`): every /__admin/ request carries the token
// from the printed URL, whichever component makes it. The token leaves the
// address bar so it isn't shared by accident; sessionStorage keeps it for reloads.
function sessionStore(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.sessionStorage
  } catch {
    return { getItem: () => null, setItem: () => undefined }
  }
}
const token = pageToken(window.location.search, sessionStore())
if (token) {
  window.fetch = withAdminToken(
    window.fetch.bind(window),
    token,
    window.location.origin,
  )
  const url = new URL(window.location.href)
  if (url.searchParams.has(TOKEN_PARAM)) {
    url.searchParams.delete(TOKEN_PARAM)
    window.history.replaceState(null, '', url)
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <Admin />
  </StrictMode>,
)
