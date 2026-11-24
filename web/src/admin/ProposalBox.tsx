import { PROPOSAL_LABELS, proposalKey, type Proposal } from './proposals.ts'

type Props = {
  /** Open proposals for one venue, best first. */
  proposals: readonly Proposal[]
  onAccept: (p: Proposal) => void
  onIgnore: (p: Proposal) => void
}

/**
 * Machine proposals for the selected venue (venue_proposals.csv): Accept
 * writes the usual review row, Ignore hides the proposal for good. The
 * keyboard shortcuts (A, I) act on the first one.
 */
export function ProposalBox({ proposals, onAccept, onIgnore }: Props) {
  if (proposals.length === 0) return null
  return (
    <section className="admin-proposals" aria-label="Machine proposals">
      {proposals.map((p, index) => (
        <div key={proposalKey(p)} className="admin-proposal">
          <p className="admin-proposal-head">
            <strong>Proposal: {PROPOSAL_LABELS[p.kind]}</strong>{' '}
            <span className="admin-proposal-confidence">
              {Math.round(p.confidence * 100)} %
            </span>
          </p>
          <p className="admin-proposal-evidence">{p.evidence}</p>
          <p className="admin-meta">
            {p.source} · {p.generated.slice(0, 10)}
            {p.at && ' · dashed pin on the map'}
          </p>
          <div className="admin-actions">
            <button type="button" onClick={() => onAccept(p)}>
              Accept {index === 0 && <kbd>A</kbd>}
            </button>
            <button type="button" onClick={() => onIgnore(p)}>
              Ignore {index === 0 && <kbd>I</kbd>}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
