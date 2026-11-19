#!/usr/bin/env node
// Copies the plugin's skills from a release of serverless/serverless.
//
//   node scripts/sync-skills.mjs                  sync from the latest release
//   node scripts/sync-skills.mjs --tag <tag>      sync from that release tag
//   node scripts/sync-skills.mjs --check          verify skills/ equals the source
//                                                 at the tag in skills.source.json
//   --source-dir <dir>                            use a local checkout, not a clone
//
// A sync that changes a skill raises the minor version in every manifest,
// records the release in skills.source.json and adds a CHANGELOG.md entry.
// The skills are copied byte for byte: nothing in skills/ is edited here.
import { execFileSync } from 'node:child_process'
import { appendFile, cp, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bump, readVersions, setVersion } from './lib/manifests.mjs'
import { diffFolders } from './lib/tree.mjs'

export const SOURCE_REPO = 'serverless/serverless'
export const SKILLS = ['serverless-framework']
const SOURCE_FILE = 'skills.source.json'
const TAG_PREFIX = 'sf-core@'

const exists = async (filePath) => {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A Framework release tag, such as `sf-core@4.46.0`. */
export const isReleaseTag = (tag) => /^sf-core@\d+\.\d+\.\d+$/.test(String(tag))

/**
 * The newest published Framework release in a list from the GitHub releases
 * API (newest first). Drafts, prereleases and releases of anything else in
 * that repository are passed over.
 */
export const pickLatestReleaseTag = (releases) => {
  const release = releases.find(
    (candidate) =>
      !candidate.draft &&
      !candidate.prerelease &&
      isReleaseTag(candidate.tag_name),
  )
  if (!release)
    throw new Error(`No published Framework release found in ${SOURCE_REPO}`)
  return release.tag_name
}

const latestReleaseTag = async () => {
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(
    `https://api.github.com/repos/${SOURCE_REPO}/releases?per_page=30`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  )
  if (!response.ok)
    throw new Error(
      `Could not read the releases of ${SOURCE_REPO}: HTTP ${response.status}`,
    )
  return pickLatestReleaseTag(await response.json())
}

/**
 * The source tree to copy from: a local checkout when `sourceDir` is given,
 * else a shallow clone of `skills/` at `tag` (default: the latest release).
 * @returns {Promise<{dir: string, tag: string, commit: string, cleanup: () => Promise<void>}>}
 */
export const fetchSource = async ({ tag, sourceDir } = {}) => {
  if (sourceDir) {
    let commit = 'unknown'
    try {
      commit = git(sourceDir, 'rev-parse', 'HEAD')
    } catch {
      /* not a git checkout */
    }
    return { dir: sourceDir, tag: tag ?? 'local', commit, cleanup: async () => {} }
  }
  // Only a release may be published: a branch or another tag would ship
  // skill text for features no released CLI has.
  if (tag !== undefined && !isReleaseTag(tag))
    throw new Error(
      `"${tag}" is not a Framework release tag (expected the form sf-core@4.46.0)`,
    )
  const resolvedTag = tag ?? (await latestReleaseTag())
  const dir = await mkdtemp(path.join(tmpdir(), 'serverless-skills-'))
  try {
    git(
      dir,
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--filter=blob:none',
      '--sparse',
      '--branch',
      resolvedTag,
      `https://github.com/${SOURCE_REPO}.git`,
      '.',
    )
    git(dir, 'sparse-checkout', 'set', 'skills')
    return {
      dir,
      tag: resolvedTag,
      commit: git(dir, 'rev-parse', 'HEAD'),
      cleanup: () => rm(dir, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

const addChangelogEntry = async (root, version, tag) => {
  const title = '# Changelog'
  const changelogPath = path.join(root, 'CHANGELOG.md')
  let rest = ''
  try {
    rest = (await readFile(changelogPath, 'utf8'))
      .replace(/^# Changelog[^\n]*\n?/, '')
      .replace(/^\n+/, '')
  } catch {
    /* first entry */
  }
  const release = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag
  const entry = `## ${version}\n\nSkill from Serverless Framework ${release} (\`${tag}\`).\n`
  await writeFile(
    changelogPath,
    `${title}\n\n${entry}${rest ? `\n${rest}` : ''}`,
  )
}

/**
 * Bring `skills/` in `root` in line with `source`.
 * With `check`, only compare: reject when anything differs, write nothing.
 * @returns {Promise<{changed: boolean, files: string[], version?: string}>}
 *   `files` are the paths that differed, relative to `root`
 */
export const sync = async (root, source, { check = false } = {}) => {
  const files = []
  for (const skill of SKILLS) {
    const from = path.join(source.dir, 'skills', skill)
    if (!(await exists(path.join(from, 'SKILL.md'))))
      throw new Error(
        `${source.tag} of ${SOURCE_REPO} has no skills/${skill}/SKILL.md`,
      )
    for (const file of await diffFolders(from, path.join(root, 'skills', skill)))
      files.push(`skills/${skill}/${file}`)
  }
  if (check) {
    if (files.length)
      throw new Error(
        `skills/ differs from ${source.tag} of ${SOURCE_REPO}:\n  ${files.join('\n  ')}\nThe skills are generated; change them in ${SOURCE_REPO}.`,
      )
    return { changed: false, files: [] }
  }
  if (!files.length) return { changed: false, files: [] }

  // Copy everything next to the target first, then swap, so a failed copy
  // leaves the current skills in place.
  const staged = []
  try {
    for (const skill of SKILLS) {
      const stage = path.join(root, 'skills', `.${skill}.incoming`)
      await rm(stage, { recursive: true, force: true })
      await cp(path.join(source.dir, 'skills', skill), stage, { recursive: true })
      staged.push({ stage, target: path.join(root, 'skills', skill) })
    }
    for (const { stage, target } of staged) {
      await rm(target, { recursive: true, force: true })
      await rename(stage, target)
    }
  } finally {
    for (const { stage } of staged)
      await rm(stage, { recursive: true, force: true })
  }

  const version = bump((await readVersions(root))['plugin.json'], 'minor')
  await setVersion(root, version)
  await writeFile(
    path.join(root, SOURCE_FILE),
    `${JSON.stringify({ repository: SOURCE_REPO, tag: source.tag, commit: source.commit }, null, 2)}\n`,
  )
  await addChangelogEntry(root, version, source.tag)
  return { changed: true, files, version }
}

const option = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const check = process.argv.includes('--check')
  const sourceDir = option('--source-dir')
  let source
  try {
    let tag = option('--tag')
    if (check && !tag && !sourceDir)
      tag = JSON.parse(await readFile(path.join(root, SOURCE_FILE), 'utf8')).tag
    source = await fetchSource({ tag, sourceDir })
    const result = await sync(root, source, { check })
    const outputs = [
      `changed=${result.changed}`,
      `tag=${source.tag}`,
      ...(result.version ? [`version=${result.version}`] : []),
    ]
    for (const line of outputs) console.log(line)
    for (const file of result.files) console.log(`  ${file}`)
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`)
  } catch (error) {
    console.error(`✖ ${error.message}`)
    process.exitCode = 1
  } finally {
    await source?.cleanup()
  }
}
