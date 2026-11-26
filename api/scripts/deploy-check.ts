/**
 * The deploy guard's steps in .github/workflows/deploy-api.yml (rules in
 * deployCheck.ts). Run from api/ with Node (it strips the types):
 *
 *   node scripts/deploy-check.ts fingerprint <outdir>   build=<fingerprint>
 *   node scripts/deploy-check.ts decide                 deploy=true|false
 *   node scripts/deploy-check.ts verify                 fails unless live
 *
 * decide and verify read the API's base URL from API_URL (unset or empty: no
 * API to ask) and the fingerprint from BUILD. Outputs go to $GITHUB_OUTPUT
 * when it is set, else to stdout; annotations go to stdout.
 */
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decide, fingerprint, verify } from './deployCheck.ts'

const API_DIR = join(import.meta.dirname, '..')

async function output(name: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT
  if (file) await appendFile(file, `${name}=${value}\n`)
  else process.stdout.write(`${name}=${value}\n`)
}

const say = (line: string) => process.stdout.write(`${line}\n`)

async function main(): Promise<number> {
  const [command, outDir] = process.argv.slice(2)
  const url = process.env.API_URL
  const build = process.env.BUILD ?? ''
  if (command === 'fingerprint' && outDir) {
    const value = await fingerprint(API_DIR, outDir)
    say(`Build fingerprint: ${value}`)
    await output('build', value)
    return 0
  }
  if (command === 'decide') {
    const decision = await decide(url, build)
    say(decision.annotation)
    await output('deploy', String(decision.deploy))
    return 0
  }
  if (command === 'verify') {
    const result = await verify(url, build)
    say(result.annotation)
    return result.ok ? 0 : 1
  }
  console.error(
    'usage: deploy-check.ts fingerprint <outdir> | decide | verify (API_URL, BUILD)',
  )
  return 2
}

process.exitCode = await main()
