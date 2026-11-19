// File listings with content hashes, used to compare folders byte for byte.
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Every file under `dir`, with slash-separated paths relative to it, sorted.
 * A symlink is listed, never followed. A missing `dir` gives an empty list.
 */
export const listFiles = async (dir) => {
  const files = []
  const walk = async (current, prefix) => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        files.push({ path: relative, sha256: '', size: 0, symlink: true })
      } else if (entry.isDirectory()) {
        await walk(full, relative)
      } else if (entry.isFile()) {
        const content = await readFile(full)
        files.push({
          path: relative,
          sha256: createHash('sha256').update(content).digest('hex'),
          size: (await lstat(full)).size,
          symlink: false,
        })
      }
    }
  }
  await walk(dir, '')
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Paths that differ between two folders: changed, added or removed. */
export const diffFolders = async (expectedDir, actualDir) => {
  const [expected, actual] = await Promise.all(
    [expectedDir, actualDir].map(async (dir) =>
      new Map((await listFiles(dir)).map((file) => [file.path, file])),
    ),
  )
  const differing = []
  for (const [filePath, file] of expected) {
    const other = actual.get(filePath)
    if (!other || other.symlink || other.sha256 !== file.sha256)
      differing.push(filePath)
  }
  for (const filePath of actual.keys())
    if (!expected.has(filePath)) differing.push(filePath)
  return differing.sort()
}
