import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  IDLE,
  isBusy,
  type PublishStatus,
} from '../../src/admin/publishStatus.ts'
import { parseReviewCsv, type Review } from '../../src/admin/review.ts'
import { REPO_ROOT as ROOT } from '../paths.ts'

const run = promisify(execFile)

/** The files a Publish commits, relative to the repository root. */
export const REVIEW = 'pipeline/data/venue_review.csv'
export const PRICES = 'pipeline/data/venue_prices.csv'
export const DATA = 'web/public/data/terraces.json'
const BRANCH_PREFIX = 'data/venue-review-'

/** Polling GitHub (git only) for the PR and its merge: every 10 s, for up to 30 min. */
const WATCH_EVERY_MS = 10_000
const WATCH_FOR_MS = 30 * 60_000

let status: PublishStatus = IDLE
/** Bumped by every Publish, so an older watcher stops. */
let generation = 0

export function publishStatus(): PublishStatus {
  return status
}

function update(patch: Partial<PublishStatus>) {
  status = { ...status, ...patch }
}

async function sh(cwd: string, command: string, args: string[]) {
  const { stdout } = await run(command, args, {
    cwd,
    // The user's shell sets UV_ENV_FILE globally; the pipeline needs none.
    env: { ...process.env, UV_NO_ENV_FILE: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.trim()
}

function summary(reviews: readonly Review[]): string {
  const count = (status: Review['status']) =>
    reviews.filter((r) => r.status === status).length
  const added = reviews.filter((r) => r.venueId.startsWith('review:')).length
  const moved = reviews.filter(
    (r) => r.venue && !r.venueId.startsWith('review:'),
  ).length
  return [
    `- ${count('terrace')} terraces`,
    `- ${count('no_terrace')} without a terrace`,
    `- ${count('not_venue')} not a venue (dropped)`,
    `- ${moved} venues moved`,
    `- ${added} venues added`,
  ].join('\n')
}

/** The newest publish branch still on GitHub: its PR is open (merged ones are deleted). */
async function openPublishBranch(): Promise<string | null> {
  const refs = await sh(ROOT, 'git', [
    'ls-remote',
    '--heads',
    'origin',
    `refs/heads/${BRANCH_PREFIX}*`,
  ])
  const branches = refs
    .split('\n')
    .map((line) => line.split('refs/heads/')[1] ?? '')
    .filter((name) => name.startsWith(BRANCH_PREFIX))
    .sort()
  return branches.at(-1) ?? null
}

/** https://github.com/<owner>/<repo>, from the origin URL. */
async function repoUrl(): Promise<string | null> {
  const origin = await sh(ROOT, 'git', ['remote', 'get-url', 'origin'])
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(origin)
  return match ? `https://github.com/${match[1]}` : null
}

/** The PR whose head is `sha`, from GitHub's refs/pull/<n>/head refs. */
async function prFor(sha: string): Promise<number | null> {
  const refs = await sh(ROOT, 'git', [
    'ls-remote',
    'origin',
    'refs/pull/*/head',
  ])
  for (const line of refs.split('\n')) {
    const [head, ref] = line.split('\t')
    const number = /^refs\/pull\/(\d+)\/head$/.exec(ref ?? '')?.[1]
    if (head === sha && number) return Number(number)
  }
  return null
}

async function branchExists(branch: string): Promise<boolean> {
  const refs = await sh(ROOT, 'git', [
    'ls-remote',
    '--heads',
    'origin',
    `refs/heads/${branch}`,
  ])
  return refs !== ''
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Follows the pushed commit: the Publish review workflow opens its PR, then
 * auto-merge merges it and GitHub deletes the branch.
 */
async function watch(
  mine: number,
  branch: string,
  sha: string,
  repo: string | null,
) {
  const until = Date.now() + WATCH_FOR_MS
  while (Date.now() < until && generation === mine) {
    await sleep(WATCH_EVERY_MS)
    if (generation !== mine) return
    try {
      if (status.step === 'opening') {
        const pr = await prFor(sha)
        if (pr)
          update({ step: 'checks', pr, url: repo && `${repo}/pull/${pr}` })
      } else if (!(await branchExists(branch))) {
        return update({ step: 'live' })
      }
    } catch {
      // A failed poll is retried on the next tick.
    }
  }
  if (generation === mine && status.step !== 'live') {
    update({
      step: 'failed',
      error: 'still not merged after 30 minutes; check the PR on GitHub',
    })
  }
}

/** Starts a Publish in the background; false when one is still building. */
export function startPublish(): boolean {
  if (isBusy(status)) return false
  const mine = ++generation
  status = { ...IDLE, step: 'building' }
  void publishReview(mine).catch((error: unknown) => {
    if (generation === mine) {
      update({
        step: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  return true
}

function stamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
}

/**
 * Ships venue_review.csv: rebuilds terraces.json in a temporary worktree of
 * origin/main (the checkout you work in is never touched), commits both files
 * and pushes a data/venue-review-* branch. Only git is used, because the
 * admin's network cannot reach api.github.com: the Publish review workflow
 * opens the PR and enables auto-merge, and GitHub Pages deploys it once CI
 * passes. A publish branch whose PR is still open gets a new commit instead.
 * Progress goes to `status`; the review file is read once, at the start.
 */
async function publishReview(mine: number): Promise<void> {
  // A snapshot: edits made from here on go out with the next Publish.
  const csv = await readFile(join(ROOT, REVIEW), 'utf-8')
  const prices = await readFile(join(ROOT, PRICES), 'utf-8').catch(() => null)
  const reviews = parseReviewCsv(csv)
  update({ decisions: reviews.length })
  await sh(ROOT, 'git', ['fetch', '--quiet', 'origin', 'main'])
  const open = await openPublishBranch()
  const branch = open ?? `${BRANCH_PREFIX}${stamp()}`
  if (open) await sh(ROOT, 'git', ['fetch', '--quiet', 'origin', branch])
  const dir = await mkdtemp(join(tmpdir(), 'sol-y-cerveza-publish-'))
  try {
    await sh(ROOT, 'git', [
      'worktree',
      'add',
      '--quiet',
      '-B',
      branch,
      dir,
      open ? `origin/${branch}` : 'origin/main',
    ])
    await writeFile(join(dir, REVIEW), csv, 'utf-8')
    if (prices !== null) await writeFile(join(dir, PRICES), prices, 'utf-8')
    // Rasters and downloads are gitignored: reuse this checkout's cache.
    await symlink(join(ROOT, 'pipeline/.cache'), join(dir, 'pipeline/.cache'))
    await sh(join(dir, 'pipeline'), 'uv', [
      'run',
      '--quiet',
      'python',
      '-m',
      'solycerveza.build',
    ])
    await sh(dir, 'git', ['add', REVIEW, PRICES, DATA])
    const changed = await sh(dir, 'git', ['diff', '--cached', '--name-only'])
    const files = changed.split('\n')
    if (!files.includes(REVIEW) && !files.includes(PRICES)) {
      update({ step: 'nothing' })
      return
    }
    await sh(dir, 'git', [
      'commit',
      '--quiet',
      '-m',
      `feat(data): apply venue review (${reviews.length} decisions)`,
      '-m',
      [
        'Published from the local admin view (`npm run admin`): `venue_review.csv` and the rebuilt `terraces.json`.',
        summary(reviews),
        'Merges itself when CI passes, which deploys the site.',
      ].join('\n\n'),
    ])
    update({ step: 'pushing' })
    await sh(dir, 'git', ['push', '--quiet', '-u', 'origin', branch])
    const sha = await sh(dir, 'git', ['rev-parse', 'HEAD'])
    const repo = await repoUrl()
    update({
      step: 'opening',
      url: repo && `${repo}/actions/workflows/publish-review.yml`,
    })
    void watch(mine, branch, sha, repo)
  } finally {
    await sh(ROOT, 'git', ['worktree', 'remove', '--force', dir]).catch(() =>
      rm(dir, { recursive: true, force: true }),
    )
    await sh(ROOT, 'git', ['branch', '-D', branch]).catch(() => '')
  }
}
