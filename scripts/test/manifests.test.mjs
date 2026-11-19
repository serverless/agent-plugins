import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import {
  VERSIONED_MANIFESTS,
  bump,
  readVersions,
  setVersion,
} from '../lib/manifests.mjs'

let root
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manifests-'))
  for (const file of VERSIONED_MANIFESTS) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(
      path.join(root, file),
      `${JSON.stringify({ name: 'serverless', version: '1.2.3', description: 'd' }, null, 2)}\n`,
    )
  }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('lists the four manifests that carry a version', () => {
  assert.deepEqual(VERSIONED_MANIFESTS, [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'gemini-extension.json',
  ])
})

test('bump raises one part and resets the lower ones', () => {
  assert.equal(bump('1.2.3', 'minor'), '1.3.0')
  assert.equal(bump('1.2.3', 'patch'), '1.2.4')
  assert.equal(bump('1.2.3', 'major'), '2.0.0')
})

test('bump rejects a version that is not three numbers', () => {
  assert.throws(() => bump('1.2', 'minor'), /1\.2/)
  assert.throws(() => bump('1.2.3', 'tiny'), /tiny/)
})

test('readVersions returns the version of every manifest', async () => {
  assert.deepEqual(
    await readVersions(root),
    Object.fromEntries(VERSIONED_MANIFESTS.map((file) => [file, '1.2.3'])),
  )
})

test('readVersions gives undefined for a missing manifest', async () => {
  await rm(path.join(root, 'gemini-extension.json'))
  const versions = await readVersions(root)
  assert.equal(versions['gemini-extension.json'], undefined)
  assert.equal(versions['plugin.json'], '1.2.3')
})

test('setVersion rewrites the version and keeps the rest of each file', async () => {
  await setVersion(root, '1.3.0')
  for (const file of VERSIONED_MANIFESTS) {
    const text = await readFile(path.join(root, file), 'utf8')
    assert.ok(text.endsWith('}\n'), `${file} ends with a newline`)
    assert.deepEqual(Object.keys(JSON.parse(text)), [
      'name',
      'version',
      'description',
    ])
    assert.equal(JSON.parse(text).version, '1.3.0')
    assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`)
  }
})
