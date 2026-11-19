#!/usr/bin/env node
// Checks that this repository is a valid, publishable plugin. Run as
// `node scripts/validate.mjs [--base <git ref>]`; exits 1 and lists what is
// wrong. With --base it also requires a new version whenever the skills or a
// manifest changed since that ref.
import { execFileSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSIONED_MANIFESTS, readVersions } from './lib/manifests.mjs'
import { SKILLS } from './sync-skills.mjs'

const PLUGIN_NAME = 'serverless'
const AGENT_PLUGINS_SCHEMA =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const AGENT_PLUGINS_KEYS = [
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]
const AGENT_PLUGINS_NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const MARKETPLACES = [
  '.claude-plugin/marketplace.json',
  '.agents/plugins/marketplace.json',
]
const SKILL_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]
const IMAGE = /\.(png|jpe?g|gif|webp)$/i
const MAX_TEXT_FILE_BYTES = 256 * 1024
const MAX_FILES = 512
// Paths a skills-only plugin must not hold: package installs, hooks, MCP
// servers, app references, commands, sub-agents, rules, executables and
// submodules.
const FORBIDDEN = [
  /^(commands|agents|rules|monitors)\//,
  /^\.gitmodules$/,
  /^\.lsp\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/,
  /(^|\/)node_modules\//,
  /^hooks\//,
  /^hooks\.json$/,
  /^\.?mcp\.json$/,
  /^\.app\.json$/,
  /^bin\//,
]

// Manifest keys that would add a component other than skills.
const COMPONENT_KEYS = [
  'hooks',
  'mcpServers',
  'apps',
  'commands',
  'agents',
  'lspServers',
  'outputStyles',
]

const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

const readJson = async (root, file, errors) => {
  let text
  try {
    text = await readFile(path.join(root, file), 'utf8')
  } catch {
    errors.push(`${file}: missing`)
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    errors.push(`${file}: not valid JSON`)
    return undefined
  }
}

/**
 * The top-level keys of a SKILL.md frontmatter and its `name` and
 * `description`. Covers the YAML the skills use: plain, quoted, folded (`>`)
 * and literal (`|`) scalars, and nested maps under a key.
 */
export const parseFrontmatter = (text) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text)
  if (!match) return undefined
  const keys = []
  const values = {}
  let current
  for (const line of match[1].split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line)
    if (top) {
      current = top[1]
      keys.push(current)
      const inline = (top[2] ?? '').trim()
      values[current] = /^[>|][+-]?$/.test(inline)
        ? []
        : [inline.replace(/^(['"])(.*)\1$/, '$2')]
    } else if (current && /^\s+\S/.test(line)) {
      values[current].push(line.trim())
    }
  }
  const scalar = (key) => values[key]?.filter(Boolean).join(' ')
  return { keys, name: scalar('name'), description: scalar('description') }
}

/** Words in a Markdown text, not counting fenced code blocks. */
const wordsOutsideCode = (markdown) =>
  markdown
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length

/** Files git tracks or would add, without the ones deleted from disk. */
const repoFiles = async (root) => {
  const listed = git(
    root,
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  )
    .split('\0')
    .filter(Boolean)
  const present = []
  for (const file of listed) {
    try {
      await lstat(path.join(root, file))
      present.push(file)
    } catch {
      /* deleted in the working tree */
    }
  }
  return present
}

const checkManifests = async (root, errors) => {
  const plugin = await readJson(root, 'plugin.json', errors)
  if (plugin) {
    if (plugin.$schema !== AGENT_PLUGINS_SCHEMA)
      errors.push(`plugin.json: "$schema" must be ${AGENT_PLUGINS_SCHEMA}`)
    for (const key of Object.keys(plugin))
      if (!AGENT_PLUGINS_KEYS.includes(key))
        errors.push(
          `plugin.json: "${key}" is not an Agent Plugins manifest key`,
        )
    if (typeof plugin.name !== 'string' || !AGENT_PLUGINS_NAME.test(plugin.name))
      errors.push('plugin.json: "name" is not a valid Agent Plugins name')
    for (const key of ['version', 'description', 'keywords'])
      if (!plugin[key] || plugin[key].length === 0)
        errors.push(`plugin.json: "${key}" is required`)
    if (!plugin.author?.name) errors.push('plugin.json: "author.name" is required')
  }

  for (const file of VERSIONED_MANIFESTS) {
    const manifest =
      file === 'plugin.json' ? plugin : await readJson(root, file, errors)
    if (!manifest) continue
    if (manifest.name !== PLUGIN_NAME)
      errors.push(`${file}: "name" must be "${PLUGIN_NAME}"`)
    for (const key of COMPONENT_KEYS)
      if (key in manifest)
        errors.push(`${file}: "${key}" is not allowed in a skills-only plugin`)
  }
  for (const file of MARKETPLACES) {
    const marketplace = await readJson(root, file, errors)
    if (!marketplace) continue
    if (marketplace.name !== PLUGIN_NAME)
      errors.push(`${file}: the marketplace "name" must be "${PLUGIN_NAME}"`)
    if (
      marketplace.plugins?.length !== 1 ||
      marketplace.plugins[0].name !== PLUGIN_NAME
    )
      errors.push(`${file}: must list one plugin named "${PLUGIN_NAME}"`)
  }

  const versions = await readVersions(root)
  const reference = versions[VERSIONED_MANIFESTS[0]]
  if (reference !== undefined && !/^\d+\.\d+\.\d+$/.test(reference))
    errors.push(`plugin.json: version "${reference}" is not three numbers`)
  for (const [file, version] of Object.entries(versions))
    if (version !== reference)
      errors.push(
        `${file}: version "${version}" differs from "${reference}" in ${VERSIONED_MANIFESTS[0]}`,
      )

  const codex = await readJson(root, '.codex-plugin/plugin.json', [])
  const ui = codex?.interface
  if (codex && !ui) errors.push('.codex-plugin/plugin.json: "interface" is required')
  if (ui) {
    for (const key of ['displayName', 'shortDescription'])
      if (typeof ui[key] !== 'string' || !ui[key] || ui[key].length > 30)
        errors.push(
          `.codex-plugin/plugin.json: "interface.${key}" must have 1 to 30 characters`,
        )
    for (const key of ['composerIcon', 'logo']) {
      try {
        await lstat(path.join(root, String(ui[key])))
      } catch {
        errors.push(
          `.codex-plugin/plugin.json: "interface.${key}" points at ${ui[key]}, which does not exist`,
        )
      }
    }
  }
}

const checkSkills = async (root, files, errors) => {
  // skills/ is generated: it holds the plugin's skill folders and nothing else.
  for (const file of files) {
    if (!file.startsWith('skills/')) continue
    if (!SKILLS.some((skill) => file.startsWith(`skills/${skill}/`)))
      errors.push(
        `${file}: skills/ may hold only ${SKILLS.map((skill) => `skills/${skill}/`).join(', ')}`,
      )
  }
  for (const skill of SKILLS) {
    const file = `skills/${skill}/SKILL.md`
    if (!files.includes(file)) {
      errors.push(`${file}: missing`)
      continue
    }
    const folder = file.split('/')[1]
    const frontmatter = parseFrontmatter(
      await readFile(path.join(root, file), 'utf8'),
    )
    if (!frontmatter) {
      errors.push(`${file}: no frontmatter`)
      continue
    }
    if (frontmatter.name !== folder)
      errors.push(
        `${file}: "name" is "${frontmatter.name}" but the folder is "${folder}"`,
      )
    const length = frontmatter.description?.length ?? 0
    if (length < 1 || length > 1024)
      errors.push(
        `${file}: "description" has ${length} characters; it needs 1 to 1024`,
      )
    for (const key of frontmatter.keys)
      if (!SKILL_KEYS.includes(key))
        errors.push(`${file}: "${key}" is not an Agent Skills frontmatter key`)
  }
}

const checkFiles = async (root, files, errors) => {
  if (files.length > MAX_FILES)
    errors.push(`The repository has ${files.length} files; the limit is ${MAX_FILES}`)
  for (const file of files) {
    if (FORBIDDEN.some((pattern) => pattern.test(file))) {
      errors.push(`${file}: not allowed in a skills-only plugin`)
      continue
    }
    const stats = await lstat(path.join(root, file))
    if (stats.isSymbolicLink()) {
      errors.push(`${file}: symlinks are not allowed`)
      continue
    }
    if (IMAGE.test(file)) continue
    if (stats.size > MAX_TEXT_FILE_BYTES)
      errors.push(`${file}: ${stats.size} bytes; the limit is ${MAX_TEXT_FILE_BYTES}`)
    else if ((await readFile(path.join(root, file))).includes(0))
      errors.push(`${file}: binary files other than images are not allowed`)
  }
  if (!files.includes('LICENSE')) errors.push('LICENSE: missing')
  if (!files.includes('README.md')) errors.push('README.md: missing')
  else {
    const words = wordsOutsideCode(
      await readFile(path.join(root, 'README.md'), 'utf8'),
    )
    if (words < 40)
      errors.push(
        `README.md: ${words} words outside code blocks; it needs at least 40`,
      )
  }
}

const isHigher = (version, than) => {
  const [a, b] = [version, than].map((value) => String(value).split('.').map(Number))
  for (let index = 0; index < 3; index += 1)
    if (a[index] !== b[index]) return a[index] > b[index]
  return false
}

/** A change to the skills or a manifest since `base` needs a higher version. */
const checkVersionBump = async (root, base, errors) => {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    errors.push(`--base ${base}: no such commit`)
    return
  }
  const changed = git(
    root,
    'diff',
    '--name-only',
    base,
    '--',
    'skills',
    ...VERSIONED_MANIFESTS,
    ...MARKETPLACES,
  )
    .split('\n')
    .filter(Boolean)
  if (!changed.length) return
  let baseVersion
  try {
    baseVersion = JSON.parse(git(root, 'show', `${base}:plugin.json`)).version
  } catch {
    return // no plugin at that commit yet: nothing to compare with
  }
  const version = (await readVersions(root))['plugin.json']
  if (!isHigher(version, baseVersion))
    errors.push(
      `The version is ${version}, which is not above ${baseVersion} at ${base}, but these changed since then: ${changed.join(', ')}. Raise the version in every manifest.`,
    )
}

export const validate = async (root, { base } = {}) => {
  const errors = []
  const files = await repoFiles(root)
  await checkManifests(root, errors)
  await checkSkills(root, files, errors)
  await checkFiles(root, files, errors)
  if (base) await checkVersionBump(root, base, errors)
  return errors
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseIndex = process.argv.indexOf('--base')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const errors = await validate(root, {
    base: baseIndex === -1 ? undefined : process.argv[baseIndex + 1],
  })
  for (const error of errors) console.error(`✖ ${error}`)
  if (errors.length) process.exit(1)
  console.log('The plugin is valid.')
}
