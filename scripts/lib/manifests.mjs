// The manifests that carry the plugin version. Every one of them holds the
// same version string; scripts/validate.mjs fails when they differ.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const VERSIONED_MANIFESTS = [
  'plugin.json',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'gemini-extension.json',
]

const PARTS = ['major', 'minor', 'patch']

/** `1.2.3` + `minor` → `1.3.0`. */
export const bump = (version, part) => {
  if (!/^\d+\.\d+\.\d+$/.test(String(version)))
    throw new Error(`Not a version of three numbers: "${version}"`)
  const index = PARTS.indexOf(part)
  if (index === -1) throw new Error(`Unknown version part: "${part}"`)
  const numbers = version.split('.').map(Number)
  numbers[index] += 1
  for (let lower = index + 1; lower < numbers.length; lower += 1)
    numbers[lower] = 0
  return numbers.join('.')
}

/** Manifest path → its version, `undefined` for a file that is missing or unreadable. */
export const readVersions = async (root) => {
  const versions = {}
  for (const file of VERSIONED_MANIFESTS) {
    try {
      versions[file] = JSON.parse(
        await readFile(path.join(root, file), 'utf8'),
      ).version
    } catch {
      versions[file] = undefined
    }
  }
  return versions
}

/** Write `version` into every manifest, leaving its other keys and their order alone. */
export const setVersion = async (root, version) => {
  for (const file of VERSIONED_MANIFESTS) {
    const filePath = path.join(root, file)
    const manifest = JSON.parse(await readFile(filePath, 'utf8'))
    manifest.version = version
    await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}
