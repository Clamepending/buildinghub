# BuildingHub Architecture

BuildingHub borrows the registry pattern from ClawHub while keeping Vibe Research's abstraction barrier stricter.

```text
Contributor folder
  -> buildinghub validate
  -> buildinghub build
  -> buildinghub publish <id>
  -> PR / hosted review
  -> registry.json
  -> Vibe Research BuildingHub loader
```

## Compatibility Layer

Vibe Research currently reads `registry.json` through `src/buildinghub-service.js` and consumes the top-level `buildings[]` array. That array remains the stable compatibility contract.

## Package Layer

`packages[]` is the ClawHub-style package index. Each entry records:

- `id`
- `latestVersion`
- `trust`
- `manifestSha256`
- manifest and README source paths
- a `versions[]` list

The current repo has one version per building because the git history is the durable version store. A hosted BuildingHub can expand this into full historical package records.

## Repo-First Package Layer

Community buildings should be treated like small apps. The maintainer owns a separate GitHub repo with:

```text
README.md
buildinghub/building.json
assets/thumbnail.png
assets/screenshots/*.png
```

The central BuildingHub repo stores a reviewed manifest snapshot plus `repo.url` and source paths. That gives users and moderators a stable app listing today while keeping the future ingest path clean: fetch a repo at a pinned commit, validate `buildinghub/building.json`, store the immutable package record, and publish it into `packages[]`.

Repo-first fields are:

- `repo`: source repository and manifest/readme/assets paths
- `media`: thumbnail and screenshots
- `footprint`: suggested Agent Town size and placement behavior
- `tools`: concrete agent-facing tools from the package's MCP/helper/API layer
- `endpoints`: API, webhook, OAuth, MCP, docs, or local callback surfaces

These fields describe package boundaries; they do not grant executable privileges inside Vibe Research.

## Bundle Layer

`buildinghub pack` writes ignored review/upload bundles to:

```text
dist/<id>/<version>/<id>-<version>.buildinghub.json
dist/<id>/<version>/<id>-<version>.buildinghub.json.sha256
```

The bundle contains the manifest, README text, source paths, manifest checksum, package id, and package version. It is intentionally JSON rather than executable code, and it is deterministic so repeated packaging of unchanged files gives the same checksum.

## Hosted Registry Path

Hosted mode now lives in `server/buildinghub-server.mjs`.

Today it adds:

- GitHub login
- persistent contributor profiles
- account profile pages at `/u/:login`
- short-lived grant exchange for Vibe Research app-to-app login
- long-lived BuildingHub API tokens so Vibe Research stores a BuildingHub account token instead of a GitHub token
- hosted layout ingest through `/api/layouts`
- hosted scaffold recipe ingest through `/api/recipes`
- merged hosted entries in `/registry.json`
- publication registration through `/api/publications`

The current hosted path now owns account-linked layout and scaffold publishing, while building/package ingest remains repo-first and PR-reviewed. The app can keep loading `buildings[]` until it needs richer package UI, while the hosted account layer grows into:

- repo submission and ownership verification
- search, tags, stars, comments, downloads, and install stats
- moderation queues and report handling
- immutable package/version records backed by uploaded bundles
