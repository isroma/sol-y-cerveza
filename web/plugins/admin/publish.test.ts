import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../paths.ts'
import { DATA, editsToShip, PRICES, PUBLISHED, REVIEW, SUN } from './publish.ts'

describe('editsToShip', () => {
  let dir = ''
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        ...['-c', 'user.name=t', '-c', 'user.email=t@t'],
        ...['-c', 'commit.gpgsign=false'],
        ...args,
      ],
      { cwd: dir },
    )
  const put = (file: string, text: string) =>
    writeFileSync(join(dir, file), text, 'utf-8')

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sees an edited or new review or prices file, nothing else', async () => {
    dir = mkdtempSync(join(tmpdir(), 'publish-'))
    mkdirSync(join(dir, 'pipeline/data'), { recursive: true })
    mkdirSync(join(dir, 'web/public/data'), { recursive: true })
    git('init', '--quiet')
    put(REVIEW, 'venue_id\n')
    put(DATA, '{}')
    git('add', '.')
    git('commit', '--quiet', '-m', 'base')

    put(REVIEW, 'venue_id\n')
    put(DATA, '{"changed":true}')
    expect(await editsToShip(dir)).toBe(false)

    put(PRICES, 'venue_id\n')
    expect(await editsToShip(dir)).toBe(true)
    git('add', PRICES)
    git('commit', '--quiet', '-m', 'prices')
    expect(await editsToShip(dir)).toBe(false)

    put(REVIEW, 'venue_id\nosm:node/1\n')
    expect(await editsToShip(dir)).toBe(true)
    git('add', REVIEW)
    git('commit', '--quiet', '-m', 'review')
    expect(await editsToShip(dir)).toBe(false)

    // Accepted sun reports (issue #463): new, then edited.
    put(SUN, 'id,venue_id,leaf_off,azimuth,altitude,seen\n')
    expect(await editsToShip(dir)).toBe(true)
    git('add', SUN)
    git('commit', '--quiet', '-m', 'sun')
    expect(await editsToShip(dir)).toBe(false)
    put(
      SUN,
      'id,venue_id,leaf_off,azimuth,altitude,seen\n1,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z\n',
    )
    expect(await editsToShip(dir)).toBe(true)
  })
})

// The Publish review workflows refuse a branch that changes anything but
// these files; a file Publish commits that they don't list would never merge,
// and one they list that Publish doesn't commit widens what a push can change.
describe('the publish allow-list', () => {
  const allowed = (workflow: string) => {
    const text = readFileSync(
      join(REPO_ROOT, '.github/workflows', workflow),
      'utf-8',
    )
    const lines = text
      .split('\n')
      .filter((line) => /^\s*'' \|.*\) ;;\s*$/.test(line))
    expect(lines, workflow).toHaveLength(1)
    return (lines[0] ?? '')
      .replace(/\) ;;\s*$/, '')
      .split('|')
      .map((part) => part.trim())
      .filter((part) => part !== "''")
      .sort()
  }

  it('is the files Publish commits, in both workflows', () => {
    expect(PUBLISHED).toEqual([REVIEW, PRICES, SUN, DATA])
    for (const workflow of ['publish-review.yml', 'publish-review-pr.yml'])
      expect(allowed(workflow), workflow).toEqual([...PUBLISHED].sort())
  })
})

// Publish runs git and the pipeline from REPO_ROOT and commits these files;
// no other test runs it, so a wrong path would only show when the owner
// presses Publish.
describe('publish paths', () => {
  it('runs from the repository root', () => {
    expect(existsSync(join(REPO_ROOT, 'CLAUDE.md'))).toBe(true)
    expect(existsSync(join(REPO_ROOT, 'web', 'package.json'))).toBe(true)
    expect(existsSync(join(REPO_ROOT, 'pipeline', 'pyproject.toml'))).toBe(true)
  })

  // SUN is left out: Publish copes with it missing (it commits only files there).
  it('commits files that exist', () => {
    for (const file of [REVIEW, PRICES, DATA])
      expect(existsSync(join(REPO_ROOT, file)), file).toBe(true)
  })
})
