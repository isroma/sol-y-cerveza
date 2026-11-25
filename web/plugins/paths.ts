import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The repository root, for the dev-server plugins that read or write outside
 * web/ (pipeline/data/, pipeline/.cache/) or run the pipeline. Named once here
 * (this file sits in web/plugins/), so no plugin counts `../` levels itself.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** A path relative to the repository root, e.g. `pipeline/data/x.csv`. */
export function repoPath(relative: string): string {
  return join(REPO_ROOT, relative)
}
