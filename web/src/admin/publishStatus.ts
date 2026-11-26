import { z } from 'zod'

/** Where a Publish is: shared by the dev-server endpoint and the admin page. */
export const PUBLISH_STEPS = [
  'idle',
  'building',
  'pushing',
  'opening',
  'checks',
  'live',
  'nothing',
  'failed',
] as const

export const publishStatusSchema = z.object({
  step: z.enum(PUBLISH_STEPS),
  decisions: z.number().int().nullable(),
  /** Phone prices copied in (#263); null when the API wasn't reached. */
  phonePrices: z.number().int().nullable(),
  pr: z.number().int().nullable(),
  url: z.string().nullable(),
  error: z.string().nullable(),
})

export type PublishStatus = z.infer<typeof publishStatusSchema>

export const IDLE: PublishStatus = {
  step: 'idle',
  decisions: null,
  phonePrices: null,
  pr: null,
  url: null,
  error: null,
}

/** Steps during which this checkout is still building or pushing. */
export function isBusy(status: PublishStatus): boolean {
  return status.step === 'building' || status.step === 'pushing'
}

/** Steps worth polling for: something is still happening. */
export function isActive(status: PublishStatus): boolean {
  return isBusy(status) || status.step === 'opening' || status.step === 'checks'
}

/** One line on what is happening, for the admin page. */
export function describe(status: PublishStatus): string {
  const phone = status.phonePrices
    ? `, ${status.phonePrices} phone price${status.phonePrices === 1 ? '' : 's'}`
    : ''
  const decisions =
    status.decisions === null ? '' : ` (${status.decisions} decisions${phone})`
  switch (status.step) {
    case 'idle':
      return 'Rebuilds the data and opens a PR that deploys itself when CI passes.'
    case 'building':
      return `1/4 Building the data${decisions}, about 30 s…`
    case 'pushing':
      return '2/4 Pushing to GitHub…'
    case 'opening':
      return '3/4 Waiting for GitHub to open the PR…'
    case 'checks':
      return `4/4 PR #${status.pr ?? '?'} is open: CI is running and it merges itself when green, a few minutes…`
    case 'live':
      return `Merged${status.pr ? ` (PR #${status.pr})` : ''}. The site updates within a couple of minutes.`
    case 'nothing':
      return 'Nothing new to publish: everything is already live.'
    case 'failed':
      return `Failed: ${status.error ?? 'unknown error'}`
  }
}
