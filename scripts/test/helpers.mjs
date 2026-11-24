// Test utilities: a minimal valid plugin repo in a temp dir.
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })

export const write = async (root, file, content) => {
  const filePath = path.join(root, file)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    typeof content === 'string'
      ? content
      : `${JSON.stringify(content, null, 2)}\n`,
  )
}

export const readJson = async (root, file) =>
  JSON.parse(await readFile(path.join(root, file), 'utf8'))

/** Rewrite a JSON file through `change(json)`. */
export const editJson = async (root, file, change) => {
  const json = await readJson(root, file)
  change(json)
  await write(root, file, json)
}

export const SKILL_MD = `---
name: serverless-framework
description: >-
  Builds, deploys, and operates applications on AWS with the Serverless
  Framework. Use whenever serverless.yml is present.
metadata:
  managed-by: serverless-framework
  version: '5'
  scope: user
---

# Serverless Framework
`

/** A minimal SKILL.md for one of the feature skills the plugin carries. */
export const featureSkillMd = (name) => `---
name: ${name}
description: The ${name} skill, for tests.
metadata:
  managed-by: serverless-framework
  version: '1'
---

# ${name}
`

export const FEATURE_SKILLS = [
  'serverless-dev-mode',
  'serverless-mcp',
  'serverless-sandboxes',
  'serverless-upgrade',
]

/** Write every skill the plugin carries into `root`, as a release has them. */
export const writeSkills = async (root) => {
  await write(root, 'skills/serverless-framework/SKILL.md', SKILL_MD)
  await write(root, 'skills/serverless-framework/references/a.md', '# A\n')
  for (const name of FEATURE_SKILLS)
    await write(root, `skills/${name}/SKILL.md`, featureSkillMd(name))
}

const common = {
  name: 'serverless',
  version: '1.0.0',
  description: 'Skills for the Serverless Framework.',
  author: { name: 'Serverless, Inc.' },
}

export const README = `# Serverless Framework agent plugin

${'This plugin gives an AI coding agent the Serverless Framework skill. '.repeat(5)}
`

/** A temp dir holding a valid plugin repo with one commit. */
export const makeRepo = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-repo-'))
  await write(root, 'plugin.json', {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...common,
    keywords: ['serverless'],
  })
  await write(root, '.claude-plugin/plugin.json', { ...common })
  await write(root, '.claude-plugin/marketplace.json', {
    name: 'serverless',
    owner: { name: 'Serverless, Inc.' },
    plugins: [{ name: 'serverless', source: './' }],
  })
  await write(root, '.codex-plugin/plugin.json', {
    ...common,
    skills: './skills/',
    interface: {
      displayName: 'Serverless Framework',
      shortDescription: 'Deploy serverless apps on AWS',
      composerIcon: './assets/icon.png',
      logo: './assets/icon.png',
    },
  })
  await write(root, '.agents/plugins/marketplace.json', {
    name: 'serverless',
    plugins: [{ name: 'serverless', source: { source: 'url', url: 'x' } }],
  })
  await write(root, 'gemini-extension.json', {
    name: 'serverless',
    version: '1.0.0',
    description: common.description,
  })
  await write(root, 'skills.source.json', {
    repository: 'serverless/serverless',
    tag: 'sf-core@4.46.0',
    commit: '0'.repeat(40),
  })
  await writeSkills(root)
  await write(root, 'assets/icon.png', 'png')
  await write(root, 'README.md', README)
  await write(root, 'LICENSE', 'MIT License\n')
  await write(root, 'CHANGELOG.md', '# Changelog\n\n## 1.0.0\n\nFirst.\n')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  return root
}
