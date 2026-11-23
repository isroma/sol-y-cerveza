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

type OpenPr = { number: number; url: string; headRefName: string }

async function openPublishPr(): Promise<OpenPr | null> {
  const json = await sh(ROOT, 'gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number,url,headRefName',
  ])
  const prs: unknown = JSON.parse(json)
  if (!Array.isArray(prs)) return null
  for (const pr of prs) {
    if (
      typeof pr === 'object' &&
      pr !== null &&
      typeof pr.number === 'number' &&
      typeof pr.url === 'string' &&
      typeof pr.headRefName === 'string' &&
      pr.headRefName.startsWith(BRANCH_PREFIX)
    )
      return { number: pr.number, url: pr.url, headRefName: pr.headRefName }
  }
  return null
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
 * origin/main (the checkout you work in is never touched), commits both
 * files, pushes and opens a PR with auto-merge, so GitHub Pages deploys it
 * once CI passes. A publish PR that is still open gets a new commit instead.
 */
export async function publishReview(): Promise<PublishResult> {
  const reviews = parseReviewCsv(await readFile(join(ROOT, REVIEW), 'utf-8'))
  await sh(ROOT, 'git', ['fetch', '--quiet', 'origin', 'main'])
  const open = await openPublishPr()
  const branch = open?.headRefName ?? `${BRANCH_PREFIX}${stamp()}`
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
    if (!changed.split('\n').includes(REVIEW)) {
      return { message: 'Nothing new to publish.', url: open?.url ?? null }
    }
    await sh(dir, 'git', [
      'commit',
      '--quiet',
      '-m',
      `feat(data): apply venue review (${reviews.length} decisions)`,
    ])
    await sh(dir, 'git', ['push', '--quiet', '-u', 'origin', branch])
    if (open) {
      return {
        message: `Added to PR #${open.number}; it deploys when CI passes.`,
        url: open.url,
      }
    }
    const url = await sh(dir, 'gh', [
      'pr',
      'create',
      '--title',
      `feat(data): apply venue review (${reviews.length} decisions)`,
      '--body',
      [
        '## Summary',
        '',
        'Published from the local admin view (`npm run admin`): `venue_review.csv` and the rebuilt `terraces.json`.',
        '',
        summary(reviews),
        '',
        'Merges itself when CI passes, which deploys the site.',
      ].join('\n'),
    ])
    await sh(dir, 'gh', ['pr', 'merge', url, '--auto', '--squash'])
    return { message: 'PR opened; it deploys when CI passes.', url }
  } finally {
    await sh(ROOT, 'git', ['worktree', 'remove', '--force', dir]).catch(() =>
      rm(dir, { recursive: true, force: true }),
    )
    await sh(ROOT, 'git', ['branch', '-D', branch]).catch(() => '')
  }
}
