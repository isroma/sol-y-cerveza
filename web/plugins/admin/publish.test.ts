import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../paths.ts'
import { DATA, PRICES, REVIEW } from './publish.ts'

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
