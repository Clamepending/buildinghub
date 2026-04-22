# BuildingHub

Community building catalog for Vibe Research.

BuildingHub packages **manifest-only** buildings: setup guides, visual town lots, access requirements, and agent-facing capability notes. Installing a BuildingHub entry in Vibe Research does not execute code from this repository.

## Layout

```text
buildings/<building-id>/building.json  # one manifest per building
buildings/<building-id>/README.md      # builder notes and setup context
schemas/building.schema.json           # JSON schema for manifests
scripts/validate-buildings.mjs         # local validation
scripts/build-registry.mjs             # emits registry.json
registry.json                          # generated aggregate catalog
```

## Add A Building

1. Copy `templates/basic-building/building.json` into `buildings/<your-id>/building.json`.
2. Add a short `buildings/<your-id>/README.md`.
3. Run `npm test`.
4. Run `npm run build`.

Keep manifests declarative. Put installation commands, MCP names, helper commands, and required environment variables under `capabilities`; do not include secrets or executable code.

## Trust Levels

- `manifest-only`: default. Safe metadata and setup instructions only.
- `helper-command`: requires the user to install or provide a separate local command.
- `mcp`: requires an MCP/provider connector outside Vibe Research.

Executable integrations belong in separate, reviewed packages. BuildingHub should describe how to connect them, not hide code inside catalog entries.
