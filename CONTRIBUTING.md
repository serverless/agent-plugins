# Contributing

## The skills are generated

`skills/` is a copy of the skills in a release of the [Serverless Framework](https://github.com/serverless/serverless), made by `scripts/sync-skills.mjs`. A change made here is overwritten by the next sync, and the checks reject it before that. To change what a skill says, open a pull request against [`skills/`](https://github.com/serverless/serverless/tree/main/skills) in the Framework repository; the change reaches this plugin with the next Framework release.

## What lives here

- The manifests that make the skills installable: `plugin.json`, `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/` and `gemini-extension.json`.
- The scripts in `scripts/` and the workflows in `.github/workflows/`.
- This documentation.

## Checks

The scripts use only Node.js built-ins; the repository has no `package.json` on purpose, because agents install the whole repository as the plugin. With Node.js 24 or later:

```bash
node --test "scripts/test/*.test.mjs"
```

```bash
node scripts/validate.mjs
```

```bash
node scripts/sync-skills.mjs --check
```

## Versions

Every manifest carries the same version. A change to a manifest, a marketplace file or `assets/` (such as the icon) needs a higher patch version in all of them, and an entry in `CHANGELOG.md`. A sync that changes a skill raises the minor version by itself. Once a version reaches `main`, the "Sync and release" workflow tags it and creates its GitHub Release.

## Not accepted

The plugin stays skills-only: no hooks, MCP server configuration, executables or package dependencies.
