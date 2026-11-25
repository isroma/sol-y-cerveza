import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../paths.ts'
import { DATA, editsToShip, PRICES, REVIEW } from './publish.ts'

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

  it('commits files that exist', () => {
    for (const file of [REVIEW, PRICES, DATA])
      expect(existsSync(join(REPO_ROOT, file)), file).toBe(true)
  })
})
