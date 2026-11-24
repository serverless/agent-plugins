import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { VERSIONED_MANIFESTS, readVersions } from '../lib/manifests.mjs'
import { listFiles } from '../lib/tree.mjs'
import {
  SKILLS,
  SOURCE_REPO,
  fetchSource,
  isReleaseTag,
  pickLatestReleaseTag,
  sync,
} from '../sync-skills.mjs'
import {
  FEATURE_SKILLS,
  SKILL_MD,
  git,
  makeRepo,
  readJson,
  write,
  writeSkills,
} from './helpers.mjs'

const TAG = 'sf-core@4.47.0'
const COMMIT = 'a'.repeat(40)

let root, sourceDir, source
beforeEach(async () => {
  root = await makeRepo()
  sourceDir = await mkdtemp(path.join(tmpdir(), 'source-'))
  // The same skills the fixture repo holds.
  await writeSkills(sourceDir)
  source = { dir: sourceDir, tag: TAG, commit: COMMIT }
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(sourceDir, { recursive: true, force: true })
})

const repoState = async () =>
  (await listFiles(root)).filter((file) => !file.path.startsWith('.git/'))

test('the plugin carries every skill the Framework CLI bundles, from serverless/serverless', () => {
  assert.deepEqual(SKILLS, ['serverless-framework', ...FEATURE_SKILLS])
  assert.equal(SOURCE_REPO, 'serverless/serverless')
})

test('an identical source changes nothing', async () => {
  const before = await repoState()
  assert.deepEqual(await sync(root, source), { changed: false, files: [] })
  assert.deepEqual(await repoState(), before)
})

test('a changed skill is copied, versioned and recorded', async () => {
  const changedSkill = SKILL_MD.replace("version: '5'", "version: '6'")
  await write(sourceDir, 'skills/serverless-framework/SKILL.md', changedSkill)
  await write(sourceDir, 'skills/serverless-framework/references/b.md', '# B\n')

  const result = await sync(root, source)

  assert.deepEqual(result, {
    changed: true,
    files: [
      'skills/serverless-framework/SKILL.md',
      'skills/serverless-framework/references/b.md',
    ],
    version: '1.1.0',
  })
  assert.deepEqual(
    await listFiles(path.join(root, 'skills')),
    await listFiles(path.join(sourceDir, 'skills')),
  )
  assert.deepEqual(
    await readVersions(root),
    Object.fromEntries(VERSIONED_MANIFESTS.map((file) => [file, '1.1.0'])),
  )
  assert.deepEqual(await readJson(root, 'skills.source.json'), {
    repository: 'serverless/serverless',
    tag: TAG,
    commit: COMMIT,
  })
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')
  assert.ok(
    changelog.startsWith(
      '# Changelog\n\n## 1.1.0\n\nSkills from Serverless Framework 4.47.0 (`sf-core@4.47.0`).\n\n## 1.0.0\n',
    ),
    changelog,
  )
})

test('a file removed upstream is removed here', async () => {
  await rm(path.join(sourceDir, 'skills/serverless-framework/references/a.md'))
  const result = await sync(root, source)
  assert.deepEqual(result.files, ['skills/serverless-framework/references/a.md'])
  assert.deepEqual(
    (await listFiles(path.join(root, 'skills'))).map((file) => file.path),
    [
      'serverless-framework/SKILL.md',
      ...FEATURE_SKILLS.map((name) => `${name}/SKILL.md`),
    ].sort(),
  )
})

test('a release without the skill stops the sync and leaves the repo alone', async () => {
  await rm(path.join(sourceDir, 'skills'), { recursive: true })
  const before = await repoState()
  await assert.rejects(sync(root, source), /sf-core@4\.47\.0.*serverless-framework/)
  assert.deepEqual(await repoState(), before)
})

test('leaves nothing behind in skills/ besides the skill folders', async () => {
  await write(sourceDir, 'skills/serverless-framework/SKILL.md', `${SKILL_MD}more\n`)
  await sync(root, source)
  assert.equal(git(root, 'status', '--short', '--', 'skills').includes('??'), false)
})

test('check passes when the skill equals the source', async () => {
  const before = await repoState()
  assert.deepEqual(await sync(root, source, { check: true }), {
    changed: false,
    files: [],
  })
  assert.deepEqual(await repoState(), before)
})

test('check names a hand-edited file and writes nothing', async () => {
  await write(root, 'skills/serverless-framework/SKILL.md', `${SKILL_MD}edited\n`)
  const before = await repoState()
  await assert.rejects(
    sync(root, source, { check: true }),
    /skills\/serverless-framework\/SKILL\.md/,
  )
  assert.deepEqual(await repoState(), before)
})

test('only Framework release tags are synced from', () => {
  assert.equal(isReleaseTag('sf-core@4.46.0'), true)
  assert.equal(isReleaseTag('main'), false)
  assert.equal(isReleaseTag('sf-core-installer@4.46.0'), false)
  assert.equal(isReleaseTag('sf-core@4.46.0-canary.1'), false)
  assert.equal(isReleaseTag('v4.46.0'), false)
})

test('the latest release is the newest published Framework release', () => {
  assert.equal(
    pickLatestReleaseTag([
      { tag_name: 'installer@1.0.0' },
      { tag_name: 'sf-core@4.48.0', draft: true },
      { tag_name: 'sf-core@4.47.0', prerelease: true },
      { tag_name: 'sf-core@4.46.0' },
      { tag_name: 'sf-core@4.45.0' },
    ]),
    'sf-core@4.46.0',
  )
  assert.throws(() => pickLatestReleaseTag([{ tag_name: 'other' }]), /release/)
})

test('a tag that is not a Framework release is refused before any fetch', async () => {
  await assert.rejects(fetchSource({ tag: 'main' }), /main/)
})

test('the command reports a refused tag in one line and exits 1', () => {
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../sync-skills.mjs', import.meta.url)), '--tag', 'main'],
    { encoding: 'utf8' },
  )
  assert.equal(run.status, 1)
  assert.match(run.stderr, /^✖ "main" is not a Framework release tag/)
  assert.equal(run.stderr.trim().split('\n').length, 1, run.stderr)
})
