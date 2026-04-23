# Contributing Buildings

## Create A Building

For community packages, start in your own GitHub repo first:

```text
my-service/
  README.md
  buildinghub/building.json
  assets/thumbnail.png
```

Then submit a reviewed snapshot to this central registry. The snapshot keeps BuildingHub searchable and moderated while your package repo remains the source users can inspect, star, fork, and contribute to.

```bash
node bin/buildinghub.mjs init my-service --name "My Service"
```

Then edit:

```text
buildings/my-service/building.json
buildings/my-service/README.md
```

Fill in:

- `repo.url`, `repo.manifestPath`, and optional `repo.assetsPath`
- `media.thumbnail` and optional `media.screenshots`
- `footprint.width`, `footprint.height`, `footprint.shape`, and entrances when known
- `tools[]` for MCP tools, helper commands, API actions, webhook actions, OAuth scopes, or env surfaces agents can use
- `endpoints[]` for API, webhook, OAuth, MCP, docs, or local callback surfaces the user configures outside BuildingHub
- `capabilities[]` for the compatibility layer Vibe Research already loads

## Validate And Package

```bash
npm test
npm run build
node bin/buildinghub.mjs publish my-service
```

Include the `publish` output in your PR description so reviewers can compare the package id, version, bundle path, and checksum.

## Review Rules

BuildingHub manifests must be declarative.

Allowed:

- setup steps
- required environment variable names
- MCP or helper command names
- API/webhook/OAuth endpoint templates
- tool names and details
- thumbnails, screenshots, and footprint metadata
- docs/repository links
- access and safety notes
- visual metadata

Not allowed:

- secrets or tokens
- shell pipelines such as `curl | sh`
- arbitrary installation scripts
- executable code
- `install.enabledSetting`
- custom `ui` routes
- `onboarding.setupSelector`
- `visual.specialTownPlace`

If a building needs executable behavior, describe the external helper/MCP clearly in `capabilities` and keep that executable project reviewed separately.
