import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parseReviewCsv, type Review } from './src/admin/review.ts'

const run = promisify(execFile)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REVIEW = 'pipeline/data/venue_review.csv'
const DATA = 'web/public/data/terraces.json'
const BRANCH_PREFIX = 'data/venue-review-'

export type PublishResult = { message: string; url: string | null }

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

/** The GitHub pull request search for `branch`, from the origin URL. */
async function prSearchUrl(branch: string): Promise<string | null> {
  const origin = await sh(ROOT, 'git', ['remote', 'get-url', 'origin'])
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(origin)
  if (!match) return null
  return `https://github.com/${match[1]}/pulls?q=is%3Apr+head%3A${encodeURIComponent(branch)}`
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
 */
export async function publishReview(): Promise<PublishResult> {
  const reviews = parseReviewCsv(await readFile(join(ROOT, REVIEW), 'utf-8'))
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
    await copyFile(join(ROOT, REVIEW), join(dir, REVIEW))
    // Rasters and downloads are gitignored: reuse this checkout's cache.
    await symlink(join(ROOT, 'pipeline/.cache'), join(dir, 'pipeline/.cache'))
    await sh(join(dir, 'pipeline'), 'uv', [
      'run',
      '--quiet',
      'python',
      '-m',
      'solycerveza.build',
    ])
    await sh(dir, 'git', ['add', REVIEW, DATA])
    const changed = await sh(dir, 'git', ['diff', '--cached', '--name-only'])
    const url = await prSearchUrl(branch)
    if (!changed.split('\n').includes(REVIEW)) {
      return {
        message: 'Nothing new to publish.',
        url: open ? url : null,
      }
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
    await sh(dir, 'git', ['push', '--quiet', '-u', 'origin', branch])
    return {
      message: open
        ? 'Added to the open publish PR; it deploys when CI passes.'
        : 'Pushed. GitHub opens the PR in about a minute; it deploys when CI passes.',
      url,
    }
  } finally {
    await sh(ROOT, 'git', ['worktree', 'remove', '--force', dir]).catch(() =>
      rm(dir, { recursive: true, force: true }),
    )
    await sh(ROOT, 'git', ['branch', '-D', branch]).catch(() => '')
  }
}
