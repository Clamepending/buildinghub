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

## Bundle Layer

`buildinghub pack` writes ignored review/upload bundles to:

```text
dist/<id>/<version>/<id>-<version>.buildinghub.json
dist/<id>/<version>/<id>-<version>.buildinghub.json.sha256
```

The bundle contains the manifest, README text, source paths, manifest checksum, package id, and package version. It is intentionally JSON rather than executable code, and it is deterministic so repeated packaging of unchanged files gives the same checksum.

## Hosted Registry Path

The next hosted version can add:

- GitHub login
- contributor profiles
- package pages
- search, tags, stars, comments, downloads, and install stats
- moderation queues and report handling
- immutable package/version records backed by uploaded bundles

The app can keep loading `buildings[]` until it needs richer package UI.
