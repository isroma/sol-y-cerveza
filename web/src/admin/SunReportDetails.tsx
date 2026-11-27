import type { Terrace } from '../data/terraces.ts'
import {
  seasonLabel,
  sightingRows,
  SHADE_SPREAD_DEGREES,
  SUN_SPREAD_DEGREES,
  SUN_THRESHOLD,
  type SightingRow,
  type SunReport,
} from './sunReports.ts'

const degrees = (n: number) => `${n.toFixed(1)}°`

function ModelCell({ row, shade }: { row: SightingRow; shade: boolean }) {
  if (row.model === null || row.below === null) return <>no horizon</>
  const pin =
    row.model.atPin === null ? '' : ` (pin ${degrees(row.model.atPin)})`
  return (
    <>
      {degrees(row.model.obstacle)}
      {pin}
      <span className="admin-reason">
        {shade
          ? row.below < 0
            ? `sun ${degrees(-row.below)} above it`
            : 'the model already says shade'
          : row.below > 0
            ? `sun ${degrees(row.below)} below it`
            : 'the model already says sun'}
      </span>
    </>
  )
}

/**
 * What the owner needs to judge a sun report: the season, how many networks,
 * whether visitors already see it, and each sighting next to the published
 * model in that direction.
 */
export function SunReportDetails({
  report,
  terrace,
  pinMoved,
  onMovePin,
}: {
  report: SunReport
  /** The venue's record in the published terraces.json, if it is there. */
  terrace: Terrace | undefined
  /** The terrace pin moved since the build: the horizon below is the old pin's. */
  pinMoved: boolean
  /** Opens the venue in To review, to move its terrace pin by hand. */
  onMovePin: (() => void) | null
}) {
  const rows = sightingRows(report, terrace)
  const season = seasonLabel(report.leafOff)
  const shade = report.kind === 'shade'
  const seen = shade
    ? 'Shade seen where the model says sun, with the sun out over Badajoz'
    : 'Sun seen where the model says shade'
  return (
    <section className="admin-sun" aria-label="Sun report">
      <p className="admin-sun-line">
        {report.leafOff
          ? `${seen}, leaf-off (1 Dec–15 Mar). `
          : `${seen}, leaf-on (16 Mar–30 Nov). `}
        {report.shown
          ? shade
            ? 'Visitors already see shade here.'
            : 'Visitors already see sun here, as approximate (~).'
          : `Visitors don’t see it until ${SUN_THRESHOLD} people agree.`}
      </p>
      <table className="admin-sightings">
        <thead>
          <tr>
            <th scope="col">Seen (Madrid)</th>
            <th scope="col">Sun az / alt</th>
            <th scope="col">Model there</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.when}</td>
              <td>
                {Math.round(row.azimuth)}° / {degrees(row.altitude)}
              </td>
              <td>
                <ModelCell row={row} shade={shade} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {terrace === undefined && (
        <p className="admin-warn-box">
          The venue is not in the published terraces.json.
        </p>
      )}
      {pinMoved && (
        <p className="admin-warn-box">
          The terrace pin moved since the build: the model above is the old
          pin&rsquo;s.
        </p>
      )}
      <p className="admin-help">
        <strong>Accept</strong> confirms it:{' '}
        {shade
          ? 'the app shows shade there for everyone.'
          : 'the app shows sun there without “~”.'}{' '}
        <strong>Reject</strong>: these stop counting, and the sky within{' '}
        {shade ? SHADE_SPREAD_DEGREES : SUN_SPREAD_DEGREES}° of each sighting is
        blocked for {shade ? 'shade reports at' : ''} this venue, {season}, for
        a year. Either is saved in the API at once. An accepted one is also
        recorded in pipeline/data/sun_corrections.csv, which ships with the next
        Publish.
      </p>
      <p className="admin-help">
        If the pin is wrong rather than the model (against a wall, under a
        crown), move it, Publish, and then reject this report or leave it.
        {onMovePin && (
          <>
            {' '}
            <button type="button" className="admin-link" onClick={onMovePin}>
              Move the pin
            </button>
          </>
        )}
      </p>
    </section>
  )
}
