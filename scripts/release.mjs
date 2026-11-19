#!/usr/bin/env node
// Makes sure the version on this commit is tagged and has a GitHub Release
// with the plugin as a ZIP file. Safe to run again: it creates only what is
// missing, so a run that stopped halfway is completed by the next one.
//
//   node scripts/release.mjs        (needs git push access and the gh CLI)
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVersions } from './lib/manifests.mjs'

// The plugin without this repository's scripts and workflows: the package
// for directories that take an upload.
const PACKAGE_FILES = [
  'plugin.json',
  '.codex-plugin',
  '.claude-plugin',
  'skills',
  'assets',
  'README.md',
  'LICENSE',
]

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

/** The text under `## <version>` in a changelog, without the heading. */
export const changelogEntry = (changelog, version) => {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/**
 * Tag the current commit `v<version>` and push the tag, unless the remote
 * already has that tag.
 * @returns {boolean} whether the tag was created
 */
export const ensureTag = (root, version) => {
  const tag = `v${version}`
  if (git(root, 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`))
    return false
  git(root, 'tag', '--force', tag)
  git(root, 'push', 'origin', `refs/tags/${tag}`)
  return true
}

const runGh = (root) => (...args) =>
  execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })

/**
 * @returns {Promise<{version: string, tag: string, created: boolean}>}
 *   `created` says whether a release was made by this call
 */
export const ensureRelease = async (root, { gh = runGh(root) } = {}) => {
  const version = (await readVersions(root))['plugin.json']
  const tag = `v${version}`
  ensureTag(root, version)
  try {
    gh('release', 'view', tag)
    return { version, tag, created: false }
  } catch {
    /* no release for this tag yet */
  }
  const zip = path.join(
    await mkdtemp(path.join(tmpdir(), 'plugin-zip-')),
    `serverless-agent-plugin-${version}.zip`,
  )
  git(root, 'fetch', '--quiet', 'origin', 'tag', tag)
  git(root, 'archive', '--format=zip', '--output', zip, tag, ...PACKAGE_FILES)
  const notes =
    changelogEntry(
      await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'),
      version,
    ) || `Version ${version}.`
  gh('release', 'create', tag, zip, '--title', tag, '--notes', notes)
  return { version, tag, created: true }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = await ensureRelease(root)
  console.log(
    result.created
      ? `Released ${result.tag}.`
      : `${result.tag} is already released.`,
  )
}
