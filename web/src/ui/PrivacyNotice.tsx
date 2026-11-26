/**
 * The privacy notice (issue #495), opened from "Privacidad" in the legend's
 * "Sobre los datos" panel. Static text in the bundle, so it reads offline too.
 *
 * Keep every sentence true: when what the app stores on the device, sends,
 * or what the API keeps changes, update this text and README.md ("Privacy")
 * in the same PR. Opening it is never counted (no `track`).
 */

export const ISSUES_URL = 'https://github.com/isroma/sol-y-cerveza/issues'

export function PrivacyNotice() {
  return (
    <div className="privacy-notice">
      <p>
        <strong>Quién.</strong> Sol y Cerveza es un proyecto personal, sin ánimo
        de lucro. Para cualquier pregunta o petición, abre una incidencia en{' '}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
      <p>
        <strong>Sin cookies ni rastreo.</strong> No hay cuentas, publicidad ni
        cookies. Tu navegador guarda una copia de la app y del mapa para abrir
        rápido y sin conexión; nada que te identifique.
      </p>
      <p>
        <strong>Tu ubicación.</strong> «Mi ubicación» solo centra el mapa en tu
        dispositivo: tu posición no se envía a nadie.
      </p>
      <p>
        <strong>Estadísticas anónimas.</strong> Contamos cuántas veces al día se
        usa cada función (abrir la app, un bar, un filtro…), sin nada sobre ti.
        Si tu navegador pide no ser rastreado (Global Privacy Control o Do Not
        Track), no contamos nada.
      </p>
      <p>
        <strong>Si nos envías algo.</strong> Al sugerir un precio, avisar de un
        cambio o decir que da el sol, guardamos lo que envías, la fecha y un
        código calculado con una clave secreta a partir de tu dirección IP y de
        tu red, nunca la dirección en sí. Sirve para frenar abusos y que nadie
        cuente varias veces (interés legítimo). No hay un plazo fijo de borrado.
      </p>
      <p>
        <strong>Proveedores.</strong> GitHub Pages (la web), OpenFreeMap (el
        mapa) y Cloudflare (nuestro servidor y, al abrir un formulario, su
        comprobación anti-bots) reciben tu dirección IP al atender cada petición
        y llevan sus propios registros técnicos.
      </p>
      <p>
        <strong>Tus derechos.</strong> Puedes pedir acceso a tus datos, que los
        borremos u oponerte a su uso por la misma vía; dinos qué enviaste y
        cuándo para encontrarlo. También puedes reclamar ante la AEPD (
        <a href="https://www.aepd.es" target="_blank" rel="noreferrer">
          www.aepd.es
        </a>
        ).
      </p>
    </div>
  )
}
