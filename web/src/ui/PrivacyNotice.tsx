/**
 * The privacy notice (issue #495), opened from "Privacidad" in the legend's
 * "Sobre los datos" panel. Static text in the bundle, so it reads offline too.
 *
 * Keep every sentence true: when what the app stores on the device, sends,
 * or what the API keeps changes, update this text and README.md ("Privacy")
 * in the same PR. Opening it is never counted (no `track`).
 */

export const ISSUES_URL = 'https://github.com/isroma/sol-y-cerveza/issues'
export const AUTHOR_URL = 'https://github.com/isroma'

export function PrivacyNotice() {
  return (
    <div className="privacy-notice">
      <p>
        <strong>Responsable.</strong> Sol y Cerveza es un proyecto personal, sin
        ánimo de lucro, de su autor en GitHub,{' '}
        <a href={AUTHOR_URL} target="_blank" rel="noreferrer">
          isroma
        </a>
        . Para cualquier pregunta o petición, abre una incidencia en el{' '}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          repositorio
        </a>
        .
      </p>
      <p>
        <strong>Sin cookies ni rastreo.</strong> No usamos cookies, no hay
        cuentas para visitantes ni publicidad. Tu navegador guarda una copia de
        la app y del mapa para abrir rápido y sin conexión; nada que te
        identifique.
      </p>
      <p>
        <strong>Tu ubicación.</strong> «Mi ubicación» solo centra el mapa en tu
        dispositivo: tu posición no se envía a nadie. Como en cualquier mapa, se
        descargan las teselas de la zona que tienes en pantalla.
      </p>
      <p>
        <strong>Estadísticas anónimas.</strong> Contamos cuántas veces al día se
        usa cada función (abrir la app, la ficha de un bar, activar un filtro…),
        sin nada sobre ti. Si tu navegador pide no ser rastreado (Global Privacy
        Control o Do Not Track), no contamos nada.
      </p>
      <p>
        <strong>Si nos envías algo.</strong> Al sugerir un precio, avisar de un
        cambio o decir que da el sol, guardamos lo que envías, la fecha y dos
        códigos calculados con una clave secreta, uno a partir de tu dirección
        IP y otro de tu red; nunca la dirección en sí. Sirven para evitar abusos
        y que una misma persona cuente más de una vez (interés legítimo). Los
        guardamos mientras sirven para eso y para calcular el consenso, y los
        borramos si nos lo pides. Los precios y el sol en que coinciden varias
        personas se muestran en la app, y lo que aceptamos (un precio, un cambio
        de sitio, un bar nuevo) se publica en la app y en el repositorio público
        de GitHub, sin nada sobre quién lo envió.
      </p>
      <p>
        <strong>Proveedores.</strong> GitHub Pages (la web), OpenFreeMap (el
        mapa) y Cloudflare (nuestro servidor) reciben tu dirección IP al atender
        cada petición y mantienen sus propios registros técnicos. La
        comprobación anti-bots es un servicio de Cloudflare que solo se carga al
        abrir un formulario. GitHub y Cloudflare son empresas de EE. UU. y
        pueden tratar datos fuera de la UE, con las garantías que describen sus
        políticas de privacidad.
      </p>
      <p>
        <strong>Tus derechos.</strong> Puedes pedir acceso, rectificación,
        borrado, limitación u oposición, y la portabilidad de tus datos, por la
        misma vía; dinos qué enviaste y cuándo para encontrarlo. También puedes
        reclamar ante la AEPD (
        <a href="https://www.aepd.es" target="_blank" rel="noreferrer">
          www.aepd.es
        </a>
        ).
      </p>
    </div>
  )
}
