# Contributing Buildings

## Create A Building

```bash
node bin/buildinghub.mjs init my-service --name "My Service"
```

Then edit:

```text
buildings/my-service/building.json
buildings/my-service/README.md
```

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
