# Serverless Framework agent plugin

This plugin gives AI coding agents the [Serverless Framework](https://www.serverless.com/framework/docs) skill: how to build, deploy and operate applications on AWS Lambda with `serverless.yml` and the `serverless` CLI. Install it once, and your agent loads the skill whenever a task involves the Framework.

Looking for plugins that extend the Framework itself, such as `serverless-offline`? Those are [Framework plugins](https://www.serverless.com/plugins), a different thing.

## Install

The skill works with the [Serverless Framework CLI](https://www.serverless.com/framework/docs/getting-started), version 4.

### Claude Code

Add this repository as a plugin marketplace:

```bash
claude plugin marketplace add serverless/agent-plugins
```

Then install the plugin from it:

```bash
claude plugin install serverless@serverless
```

Claude Code doesn't update plugins from this marketplace on its own. To get each new version of the skill when it's released, turn on auto-update: run `/plugin` in Claude Code, open the **Marketplaces** tab, select **serverless**, and turn auto-update on. To update by hand:

```bash
claude plugin update serverless@serverless
```

### Codex

Add this repository as a plugin marketplace:

```bash
codex plugin marketplace add serverless/agent-plugins
```

Then install the plugin from it:

```bash
codex plugin add serverless@serverless
```

### GitHub Copilot CLI

Add this repository as a plugin marketplace:

```bash
copilot plugin marketplace add serverless/agent-plugins
```

Then install the plugin from it:

```bash
copilot plugin install serverless@serverless
```

### Gemini CLI

```bash
gemini extensions install https://github.com/serverless/agent-plugins
```

### Other agents

For any agent that reads [Agent Skills](https://agentskills.io), this command copies the skill into the skill folders of the agents it finds on your machine:

```bash
npx skills add serverless/agent-plugins
```

## What the skill covers

The `serverless-framework` skill teaches an agent to:

- Write `serverless.yml`: functions, events, IAM, parameters, stages and other AWS resources.
- Use the CLI: deploy, package, invoke, logs, info and remove, and what each needs.
- Sort out sign-in and AWS credentials with you before the work that needs them.
- Develop a feature test-first on a personal stage, with `serverless dev` and tests against the deployed stage.
- Split an application into services that share outputs, and build web apps and Python services.
- Read the documentation that ships with your CLI version (`serverless agent docs`) instead of answering from memory.

## Feature skills come from the CLI

The Framework has four more skills, one per feature: Dev Mode, MCP servers on AWS Lambda, sandboxes, and upgrading to version 4. They belong to a project, not to your user account, so the CLI installs them:

```bash
serverless agent setup
```

Run it in a service directory, or let your agent do it: the `serverless-framework` skill tells the agent to. It adds the feature skills to the project for you to commit, so teammates' agents get them too, and reports whether sign-in and AWS credentials are ready. The [Agent Skills guide](https://www.serverless.com/framework/docs/guides/agent-skills) has the details.

## Versions

The skill in this repository is copied, unchanged, from releases of the Serverless Framework. [`skills.source.json`](./skills.source.json) names the release it comes from, and [`CHANGELOG.md`](./CHANGELOG.md) lists each plugin version with the Framework release it matches. A new plugin version is published when a Framework release changes the skill.

## Contributing

The files under `skills/` are generated, so changes to the skill itself go to [`skills/serverless-framework`](https://github.com/serverless/serverless/tree/main/skills/serverless-framework) in the Serverless Framework repository. Changes to the manifests, scripts and docs of this repository are welcome here: see [CONTRIBUTING.md](./CONTRIBUTING.md).

To report a security issue, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)

The Serverless name and logo are trademarks of Serverless, Inc. and are not covered by this license.
