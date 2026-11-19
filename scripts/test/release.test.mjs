import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { changelogEntry, ensureRelease, ensureTag } from '../release.mjs'
import { editJson, git, makeRepo } from './helpers.mjs'

const CHANGELOG = `# Changelog

## 1.1.0

Skill from Serverless Framework 4.47.0 (\`sf-core@4.47.0\`).

## 1.0.0

First.
`

let root, remote
beforeEach(async () => {
  root = await makeRepo()
  remote = await mkdtemp(path.join(tmpdir(), 'remote-'))
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'push', '-q', 'origin', 'main')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(remote, { recursive: true, force: true })
})

const remoteTags = () =>
  git(remote, 'tag', '--list').split('\n').filter(Boolean)

test('changelogEntry returns the text of one version', () => {
  assert.equal(
    changelogEntry(CHANGELOG, '1.1.0'),
    'Skill from Serverless Framework 4.47.0 (`sf-core@4.47.0`).',
  )
  assert.equal(changelogEntry(CHANGELOG, '1.0.0'), 'First.')
  assert.equal(changelogEntry(CHANGELOG, '9.9.9'), '')
})

test('ensureTag tags the current commit once and pushes the tag', () => {
  assert.equal(ensureTag(root, '1.0.0'), true)
  assert.deepEqual(remoteTags(), ['v1.0.0'])
  assert.equal(
    git(remote, 'rev-parse', 'v1.0.0').trim(),
    git(root, 'rev-parse', 'HEAD').trim(),
  )
  assert.equal(ensureTag(root, '1.0.0'), false)
})

test('ensureRelease creates the tag, the ZIP and the release when there is none', async () => {
  const calls = []
  const gh = (...args) => {
    calls.push(args)
    if (args[1] === 'view') throw new Error('release not found')
  }
  const result = await ensureRelease(root, { gh })

  assert.deepEqual(result, { version: '1.0.0', tag: 'v1.0.0', created: true })
  assert.deepEqual(remoteTags(), ['v1.0.0'])
  const create = calls.find((args) => args[1] === 'create')
  assert.deepEqual(create.slice(0, 3), ['release', 'create', 'v1.0.0'])
  assert.ok(create[3].endsWith('serverless-agent-plugin-1.0.0.zip'))
  assert.ok((await stat(create[3])).size > 0)
  assert.deepEqual(create.slice(4), ['--title', 'v1.0.0', '--notes', 'First.'])
  const zipped = git(root, 'archive', '--format=tar', 'v1.0.0', 'skills').length
  assert.ok(zipped > 0)
})

test('ensureRelease does nothing when the release exists', async () => {
  git(root, 'tag', 'v1.0.0')
  git(root, 'push', '-q', 'origin', 'v1.0.0')
  const calls = []
  const result = await ensureRelease(root, { gh: (...args) => calls.push(args) })
  assert.deepEqual(result, { version: '1.0.0', tag: 'v1.0.0', created: false })
  assert.deepEqual(calls, [['release', 'view', 'v1.0.0']])
})

test('ensureRelease releases a version raised by hand', async () => {
  for (const file of [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'gemini-extension.json',
  ])
    await editJson(root, file, (json) => {
      json.version = '1.0.1'
    })
  git(root, 'commit', '-q', '-am', 'fix: manifest')
  git(root, 'push', '-q', 'origin', 'main')
  const gh = (...args) => {
    if (args[1] === 'view') throw new Error('release not found')
  }
  assert.deepEqual(await ensureRelease(root, { gh }), {
    version: '1.0.1',
    tag: 'v1.0.1',
    created: true,
  })
  assert.deepEqual(remoteTags(), ['v1.0.1'])
})
