import { useEffect } from 'react'
import { refreshCrowdPrices } from './crowd.ts'
import {
  dismissMessage,
  exitOwner,
  unlockFromLocation,
  useOwner,
} from './owner.ts'
import './prices.css'

/**
 * Owner mode in the header: turns it on from the private link and says when
 * it is on, with a way out. Owner mode itself is the visitor's forms, whose
 * sends become changes (owner.ts).
 */
export function OwnerBadge() {
  const { token, message } = useOwner()

  useEffect(() => {
    void unlockFromLocation()
  }, [])

  // The owner sees what they saved, not the 5-minute browser cache.
  useEffect(() => {
    if (token) void refreshCrowdPrices()
  }, [token])

  if (token)
    return (
      <span className="owner-badge" role="status">
        Modo dueño
        <button
          type="button"
          aria-label="Salir del modo dueño"
          title="Salir del modo dueño"
          onClick={exitOwner}
        >
          ×
        </button>
      </span>
    )
  if (message)
    return (
      <span className="owner-badge owner-badge--notice" role="alert">
        {message}
        <button
          type="button"
          aria-label="Cerrar aviso"
          title="Cerrar aviso"
          onClick={dismissMessage}
        >
          ×
        </button>
      </span>
    )
  return null
}
