import assert from 'node:assert/strict'
import { rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { validate } from '../validate.mjs'
import { README, SKILL_MD, editJson, git, makeRepo, write } from './helpers.mjs'

let root
beforeEach(async () => {
  root = await makeRepo()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Exactly one error, and it names `fragment`. */
const assertOneError = async (fragment, options) => {
  const errors = await validate(root, options)
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.ok(errors[0].includes(fragment), errors[0])
}

test('a valid repo has no errors', async () => {
  assert.deepEqual(await validate(root), [])
})

test('a manifest that is not JSON is reported', async () => {
  await write(root, 'gemini-extension.json', '{ not json')
  const errors = await validate(root)
  assert.ok(errors.some((error) => error.includes('gemini-extension.json')))
})

test('plugin.json must declare the Agent Plugins schema', async () => {
  await editJson(root, 'plugin.json', (json) => {
    json.$schema = 'https://example.com/schema.json'
  })
  await assertOneError('plugin.json')
})

test('plugin.json takes no key outside the Agent Plugins set', async () => {
  await editJson(root, 'plugin.json', (json) => {
    json.skills = './skills/'
  })
  await assertOneError('"skills"')
})

test('plugin.json needs the fields Kiro requires', async () => {
  await editJson(root, 'plugin.json', (json) => {
    delete json.keywords
  })
  await assertOneError('keywords')
})

test('every manifest names the plugin serverless', async () => {
  await editJson(root, 'gemini-extension.json', (json) => {
    json.name = 'sls'
  })
  await assertOneError('gemini-extension.json')
})

test('both marketplaces name the plugin serverless', async () => {
  await editJson(root, '.agents/plugins/marketplace.json', (json) => {
    json.plugins[0].name = 'sls'
  })
  await assertOneError('.agents/plugins/marketplace.json')
})

test('all manifests carry the same version', async () => {
  await editJson(root, '.codex-plugin/plugin.json', (json) => {
    json.version = '1.0.1'
  })
  await assertOneError('.codex-plugin/plugin.json')
})

test('a version is three numbers', async () => {
  for (const file of [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'gemini-extension.json',
  ])
    await editJson(root, file, (json) => {
      json.version = '1.0'
    })
  await assertOneError('1.0')
})

test('the Codex short description fits 30 characters', async () => {
  await editJson(root, '.codex-plugin/plugin.json', (json) => {
    json.interface.shortDescription = 'x'.repeat(31)
  })
  await assertOneError('shortDescription')
})

test('the Codex icons point at files that exist', async () => {
  await editJson(root, '.codex-plugin/plugin.json', (json) => {
    json.interface.logo = './assets/missing.png'
  })
  await assertOneError('./assets/missing.png')
})

test('a skill is named after its folder', async () => {
  await write(
    root,
    'skills/serverless-framework/SKILL.md',
    SKILL_MD.replace('name: serverless-framework', 'name: other'),
  )
  await assertOneError('skills/serverless-framework/SKILL.md')
})

test('a skill description has at most 1,024 characters', async () => {
  await write(
    root,
    'skills/serverless-framework/SKILL.md',
    `---\nname: serverless-framework\ndescription: ${'x'.repeat(1025)}\n---\n`,
  )
  await assertOneError('1025')
})

test('a skill uses only the Agent Skills frontmatter keys', async () => {
  await write(
    root,
    'skills/serverless-framework/SKILL.md',
    SKILL_MD.replace('metadata:', 'when_to_use: x\nmetadata:'),
  )
  await assertOneError('when_to_use')
})

test('symlinks are refused', async () => {
  await symlink('README.md', path.join(root, 'LINK.md'))
  await assertOneError('LINK.md')
})

test('a text file over 256 KiB is refused, an image is not', async () => {
  await write(root, 'assets/big.png', 'x'.repeat(262145))
  assert.deepEqual(await validate(root), [])
  await write(root, 'big.md', 'x'.repeat(262145))
  await assertOneError('big.md')
})

test('hooks are refused', async () => {
  await write(root, 'hooks/hooks.json', '{}')
  await assertOneError('hooks/hooks.json')
})

test('a package.json is refused', async () => {
  await write(root, 'package.json', '{}')
  await assertOneError('package.json')
})

test('an MCP config is refused', async () => {
  await write(root, '.mcp.json', '{}')
  await assertOneError('.mcp.json')
})

test('the README needs 40 words outside code blocks', async () => {
  await write(
    root,
    'README.md',
    `# Title\n\n${'word '.repeat(37)}\n\n\`\`\`bash\n${'code '.repeat(50)}\n\`\`\`\n`,
  )
  await assertOneError('README.md')
  await write(root, 'README.md', README)
  assert.deepEqual(await validate(root), [])
})

test('a LICENSE file is required', async () => {
  await rm(path.join(root, 'LICENSE'))
  await assertOneError('LICENSE')
})

test('a changed skill needs a new version', async () => {
  await write(root, 'skills/serverless-framework/references/a.md', '# B\n')
  git(root, 'commit', '-q', '-am', 'change skill')
  await assertOneError('version', { base: 'HEAD~1' })
})

test('a changed skill with a new version passes', async () => {
  await write(root, 'skills/serverless-framework/references/a.md', '# B\n')
  for (const file of [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'gemini-extension.json',
  ])
    await editJson(root, file, (json) => {
      json.version = '1.1.0'
    })
  git(root, 'commit', '-q', '-am', 'change skill and version')
  assert.deepEqual(await validate(root, { base: 'HEAD~1' }), [])
})

test('a README change needs no new version', async () => {
  await write(root, 'README.md', `${README}\nMore.\n`)
  git(root, 'commit', '-q', '-am', 'docs')
  assert.deepEqual(await validate(root, { base: 'HEAD~1' }), [])
})

test('skills/ holds the plugin skill folders and nothing else', async () => {
  await write(root, 'skills/extra/SKILL.md', SKILL_MD.replace('name: serverless-framework', 'name: extra'))
  await assertOneError('skills/extra/SKILL.md')
  await rm(path.join(root, 'skills/extra'), { recursive: true })
  await write(root, 'skills/NOTES.md', 'notes\n')
  await assertOneError('skills/NOTES.md')
})

test('a binary file that is not an image is refused', async () => {
  await write(root, 'skills/serverless-framework/tool', 'ELF\0\0\0binary')
  await assertOneError('skills/serverless-framework/tool')
})

test('a manifest must not declare hooks, MCP servers or other components', async () => {
  await editJson(root, '.claude-plugin/plugin.json', (json) => {
    json.hooks = {}
  })
  await assertOneError('"hooks"')
  await editJson(root, '.claude-plugin/plugin.json', (json) => {
    delete json.hooks
  })
  await editJson(root, 'gemini-extension.json', (json) => {
    json.mcpServers = {}
  })
  await assertOneError('"mcpServers"')
})

test('commands, sub-agents and git submodules are refused', async () => {
  await write(root, 'commands/deploy.md', '# deploy\n')
  await assertOneError('commands/deploy.md')
  await rm(path.join(root, 'commands'), { recursive: true })
  await write(root, 'agents/helper.md', '# helper\n')
  await assertOneError('agents/helper.md')
  await rm(path.join(root, 'agents'), { recursive: true })
  await write(root, '.gitmodules', '')
  await assertOneError('.gitmodules')
})

test('a changed skill with a lower version is refused', async () => {
  await write(root, 'skills/serverless-framework/references/a.md', '# B\n')
  for (const file of [
    'plugin.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'gemini-extension.json',
  ])
    await editJson(root, file, (json) => {
      json.version = '0.9.9'
    })
  git(root, 'commit', '-q', '-am', 'change skill, lower version')
  await assertOneError('0.9.9', { base: 'HEAD~1' })
})

test('a base that does not exist is an error', async () => {
  await assertOneError('no-such-ref', { base: 'no-such-ref' })
})
