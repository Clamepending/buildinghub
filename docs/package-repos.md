# Building Package Repos

BuildingHub is moving toward an app-store model: every serious community building should have its own GitHub repository, while the central BuildingHub registry acts as discovery, moderation, search, and version index.

## Repo Shape

Recommended package repository:

```text
my-building/
  README.md                         # human-facing setup, screenshots, review notes
  buildinghub/building.json         # required manifest
  assets/thumbnail.png              # square or wide app-store thumbnail
  assets/screenshots/*.png          # optional gallery images
  docs/*.md                         # optional deeper docs
  tools/                            # optional external helper/MCP/API code, reviewed in this repo
```

The only file BuildingHub needs to ingest is `buildinghub/building.json`. The rest of the repository exists so reviewers and users can inspect the building like an app listing: what it does, how it looks, what it connects to, who maintains it, and what code or external services are involved.

## Manifest Fields

The core listing fields remain:

- `id`, `name`, `version`, `category`, `description`
- `status`, `trust`, `keywords`
- `access`, `capabilities`, `onboarding`, `agentGuide`

Repo-first packages should also define:

- `repo`: canonical GitHub repository and paths to the manifest, README, and assets.
- `media.thumbnail`: thumbnail metadata for catalog cards. Use `url` for hosted images or `path` for repo-relative assets.
- `media.screenshots`: optional app-store gallery images.
- `footprint`: suggested Agent Town grid size, shape, snapping behavior, and entrances.
- `tools`: concrete user/agent-facing tools the building exposes through an external MCP, helper command, API, webhook, OAuth scope, or environment variable.
- `endpoints`: declarative service endpoints, webhook URLs, OAuth surfaces, MCP servers, or local callback surfaces the user configures outside BuildingHub.

`capabilities` stays as the compatibility layer Vibe Research already understands. `tools` and `endpoints` are the richer package layer for the hosted app-store UI.

## Central Registry Submission

For now, BuildingHub stores reviewed snapshots under `buildings/<id>/`:

```text
buildings/<id>/building.json
buildings/<id>/README.md
```

That snapshot should match the package repo's `buildinghub/building.json` for the submitted version and include `repo.url` so users can click through to the package source. This gives us moderated discovery immediately, without requiring Vibe Research to clone arbitrary repos at install time.

Future hosted BuildingHub can replace manual snapshots with an ingest queue:

1. Maintainer submits a GitHub repo URL.
2. BuildingHub fetches `buildinghub/building.json` at a pinned commit.
3. CI validates the manifest, media paths, repo metadata, and safety rules.
4. Moderators approve the version into immutable package records.
5. The public registry exposes package pages, versions, stars, installs, reports, and search facets.

## Safety Boundary

BuildingHub manifests describe external code; they do not smuggle executable code into Vibe Research.

Allowed in manifests:

- helper command names such as `modal`
- MCP server or tool names
- API endpoint templates and auth style
- webhook callback surfaces
- environment variable names
- thumbnails, screenshots, docs, and setup notes

Not allowed in manifests:

- secrets or tokens
- shell pipelines or install scripts
- arbitrary executable snippets
- first-party Vibe Research UI routes
- hidden settings toggles
- special Agent Town placement privileges

Executable helper code belongs in the building's own repository and should be reviewed there. BuildingHub's registry remains declarative and searchable.
