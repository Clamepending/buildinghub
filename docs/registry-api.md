# BuildingHub Registry And API Reference

BuildingHub is a static registry today. The public interface is the generated `registry.json`, the GitHub Pages gallery, and the contributor CLI. Community building packages are manifest-only snapshots; installing or browsing a building does not execute package code.

## Public URLs

| surface | URL | purpose |
| --- | --- | --- |
| Gallery | `https://clamepending.github.io/buildinghub/` | Searchable BuildingHub website. |
| Registry JSON | `https://clamepending.github.io/buildinghub/registry.json` | Machine-readable catalog consumed by Vibe Research and future package UIs. |
| Layout previews | `https://clamepending.github.io/buildinghub/assets/layouts/<layout-id>.svg` | Generated static layout preview assets. |
| Source repo | `https://github.com/Clamepending/buildinghub` | Central registry, validation, docs, and Pages deployment. |

The registry URL is static JSON. Consumers can use normal HTTP caching and append a cache-busting query string during verification, for example `registry.json?verify=<commit>`.

## Registry Shape

Top-level `registry.json` fields:

| field | type | purpose |
| --- | --- | --- |
| `registryVersion` | number | Version of the aggregate registry format. |
| `manifestVersion` | number | Version of supported building/layout manifest contracts. |
| `generatedBy` | string | BuildingHub generator version. |
| `generatedAt` | string | ISO timestamp for the generated file. |
| `name` | string | Human-readable registry name. |
| `packageCount` | number | Number of building packages. |
| `layoutCount` | number | Number of layout packages. |
| `recipeCount` | number | Number of scaffold recipe packages. |
| `packages[]` | array | Package index for buildings. |
| `layoutPackages[]` | array | Package index for layouts. |
| `recipePackages[]` | array | Package index for scaffold recipes. |
| `buildings[]` | array | Full building manifests and Vibe Research compatibility layer. |
| `layouts[]` | array | Full layout manifests. |
| `recipes[]` | array | Full scaffold recipes. |

## Compatibility Contract

`buildings[]` is the stable Vibe Research loader contract. It contains the full manifest for each building, including:

- Listing fields such as `id`, `name`, `category`, `description`, `status`, `trust`, `keywords`, `homepageUrl`, and `docsUrl`.
- Setup fields such as `access`, `capabilities`, `onboarding`, and `agentGuide`.
- Package fields such as `repo`, `media`, `footprint`, `tools`, and `endpoints`.

Consumers that only need the current in-app BuildingHub window can keep reading `buildings[]`. Richer package pages should use `packages[]` for package metadata and then join by `id` into `buildings[]` for the full manifest.

## Package Index

Each `packages[]` entry is the fast search/index lane:

```json
{
  "id": "modal",
  "name": "Modal",
  "category": "Compute",
  "trust": "helper-command",
  "latestVersion": "0.1.0",
  "manifestSha256": "<sha256>",
  "source": {
    "manifestPath": "buildings/modal/building.json",
    "readmePath": "buildings/modal/README.md",
    "repositoryUrl": "https://github.com/example/modal-building",
    "upstreamManifestPath": "buildinghub/building.json"
  },
  "thumbnail": {
    "path": "assets/thumbnail.png",
    "url": "https://example.com/thumbnail.png",
    "alt": "Modal Building thumbnail"
  },
  "footprint": {
    "width": 3,
    "height": 2,
    "shape": "factory",
    "snap": "grid"
  },
  "versions": [
    {
      "version": "0.1.0",
      "manifestSha256": "<sha256>",
      "manifestPath": "buildings/modal/building.json",
      "repositoryUrl": "https://github.com/example/modal-building"
    }
  ]
}
```

Rules:

- `id` is stable and matches `buildings/<id>/building.json`.
- `manifestSha256` is computed from a stable JSON serialization of the manifest.
- `source.manifestPath` and `source.readmePath` are paths in the central registry repo.
- `source.repositoryUrl` points to the package repo when a building has already moved to repo-first ownership.
- `thumbnail` and `footprint` are copied from the manifest for fast listing UI.

## Building Manifest

The full building manifest contract is documented in `docs/manifest-reference.md`.

Use these fields for package-page UI:

- `repo`: canonical source repo and manifest paths.
- `media.thumbnail` and `media.screenshots`: listing images.
- `footprint`: Agent Town lot size and placement hints.
- `tools`: concrete agent-facing tools, helper commands, MCP tools, API tools, webhook surfaces, OAuth scopes, or environment variables.
- `endpoints`: API, webhook, OAuth, MCP, docs, or local surfaces the user configures outside BuildingHub.
- `onboarding`: setup variables and setup steps.
- `agentGuide`: agent-readable usage notes.

## Layouts

`layouts[]` is the full layout gallery. Each layout has:

- `id`, `name`, `version`, `description`, and optional `category`.
- `requiredBuildings[]` for functional dependencies.
- `layout.decorations[]` for cosmetic map items.
- `layout.functional` for building coordinates.

`layoutPackages[]` mirrors the building package lane for layout metadata and checksums.

## Scaffold Recipes

`recipes[]` is the full scaffold recipe gallery. Each recipe uses the Vibe Research recipe schema `vibe-research.scaffold.recipe.v1` and can include:

- `buildings[]` for required and optional capabilities.
- `settings.portable` for portable settings only.
- `communication` for agent DM/body/visibility/group inbox policy.
- `sandbox`, `agents`, `library`, `occupation`, and `permissions` metadata.
- `layout` for an optional Agent Town arrangement.
- `localBindingsRequired[]` for local paths, personal values, and secrets that the receiving machine must supply.

Recipes must not include secret values, local file paths, private remotes, transcripts, or executable commands. `recipePackages[]` mirrors the building package lane for recipe metadata and checksums.

## CLI Interface

The contributor CLI lives at `bin/buildinghub.mjs`.

```bash
npm test
npm run build
npm run site
npm run list
npm run pack
npm run doctor

node bin/buildinghub.mjs validate
node bin/buildinghub.mjs build
node bin/buildinghub.mjs site
node bin/buildinghub.mjs list
node bin/buildinghub.mjs pack --all
node bin/buildinghub.mjs pack <building-id>
node bin/buildinghub.mjs publish <building-id>
node bin/buildinghub.mjs init <building-id> --name "Display Name"
node bin/buildinghub.mjs doctor
```

Command behavior:

- `validate`: validates every building and layout manifest.
- `build`: regenerates root `registry.json`.
- `site`: regenerates `registry.json`, layout SVG previews, and `site/registry.json`.
- `list`: prints id, version, type/trust, and name for buildings, layouts, and scaffolds.
- `pack`: emits deterministic ignored bundles under `dist/<id>/<version>/`.
- `publish`: local PR-prep flow; validates, builds, bundles, and prints the bundle checksum.
- `init`: creates a manifest from the basic building template.
- `doctor`: prints local registry health.

## Hosted API Path

The future hosted API should keep this static contract as its read model:

- `GET /registry.json` remains the compatibility feed.
- `GET /packages` can expose the `packages[]` lane with pagination and search.
- `GET /packages/:id` can expose one manifest, package metadata, versions, screenshots, reports, stars, and install counts.
- `GET /recipes` can expose the `recipePackages[]` lane with pagination and search.
- `POST /submissions` can accept a GitHub repo URL, fetch `buildinghub/building.json` at a pinned commit, validate it, and queue moderator review.

The safety boundary stays the same: BuildingHub describes packages and external interfaces, but Vibe Research does not execute code from the registry.
