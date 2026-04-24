# BuildingHub

Community building catalog for Vibe Research. The shape intentionally follows the useful parts of ClawHub: a repo contributors can PR into, a CLI for validate/build/pack, versioned registry metadata, and a hosted registry/account service.

BuildingHub packages **manifest-only** buildings, shared Agent Town layouts, and Vibe Research scaffold recipes: setup guides, visual town lots, access requirements, agent-facing capability notes, declarative base blueprints, and portable operating setups. Installing a BuildingHub entry, applying a layout, or applying a scaffold in Vibe Research does not execute code from this repository.

Public catalog: `https://buildinghub.vibe-research.net/`

## Layout

```text
buildings/<building-id>/building.json  # one manifest per building
buildings/<building-id>/README.md      # builder notes and setup context
layouts/<layout-id>/layout.json        # one shareable Agent Town layout
layouts/<layout-id>/README.md          # layout notes and remix context
recipes/<recipe-id>/recipe.json        # one shareable Vibe Research scaffold recipe
recipes/<recipe-id>/README.md          # scaffold notes and local binding context
schemas/building.schema.json           # JSON schema for manifests
schemas/layout.schema.json             # JSON schema for layouts
schemas/scaffold-recipe.schema.json    # JSON schema for scaffold recipes
docs/package-repos.md                  # repo-first package/app-store contract
docs/manifest-reference.md             # building.json field contract
docs/registry-api.md                   # public registry, Pages, and CLI interfaces
docs/migration-status.md               # structure migration audit
scripts/validate-buildings.mjs         # local validation
scripts/build-registry.mjs             # emits registry.json
site/                                 # static BuildingHub gallery
bin/buildinghub.mjs                    # contributor CLI
registry.json                          # generated aggregate catalog
```

## Docs

- `docs/architecture.md` explains the registry, compatibility, package, and hosted API path.
- `docs/package-repos.md` explains the repo-first community package model.
- `docs/manifest-reference.md` documents the building manifest fields, validation rules, tools, endpoints, media, and footprints.
- `docs/registry-api.md` documents the public GitHub Pages registry, JSON shape, and CLI interface.
- `docs/migration-status.md` tracks which parts of the catalog are fully migrated and which still need package repos, thumbnails, or endpoint polish.
- `docs/contributing.md` and `docs/security.md` cover PR and safety expectations.

## CLI

```bash
npm test                  # buildinghub validate
npm run build             # buildinghub build
npm run site              # copy registry into site/ for local static serving
npm run list              # show id/version/type/name
npm run pack              # emit dist/<id>/<version>/*.buildinghub.json
npm run doctor            # print local repo + registry health

node bin/buildinghub.mjs init notion --name "Notion"
node bin/buildinghub.mjs publish notion
npm run sync:vibe-research -- --source /path/to/remote-vibes
```

`npm run site` also regenerates screenshot-style layout preview assets under `site/assets/layouts/`. GitHub Pages deploys the `site/` folder from `.github/workflows/pages.yml`.

`npm run sync:vibe-research` mirrors Vibe Research's first-party building catalog into declarative BuildingHub manifests and adds curated companion entries such as Modal. The generated entries are still manifest-only: they can be searched, copied, reviewed, and loaded as catalog metadata, but they do not grant credentials or install executable code.

`publish` is still the local review-prep path for repo-first building submissions. Hosted BuildingHub now also supports authenticated layout and scaffold publishes over HTTP using the same manifest format, so production Vibe Research installs do not need a checked-out BuildingHub repo to publish account-owned content.

## Hosted Server

Run the hosted/server mode with:

```bash
npm run serve
```

The server:

- serves the `site/` web UI
- owns GitHub login and callback at `/auth/github/start` and `/auth/github/callback`
- creates persistent BuildingHub user accounts tied to GitHub identities
- issues short-lived grants and long-lived API tokens so Vibe Research can connect a BuildingHub account without storing a GitHub token
- stores hosted layout and scaffold publishes through `/api/layouts` and `/api/recipes`
- merges hosted entries into `/registry.json` and serves hosted pages like `/layouts/<id>/` and `/recipes/<id>/`
- records account-linked publications through `/api/publications`

Key environment variables:

- `BUILDINGHUB_GITHUB_OAUTH_CLIENT_ID`
- `BUILDINGHUB_GITHUB_OAUTH_CLIENT_SECRET`
- `BUILDINGHUB_PORT`
- `BUILDINGHUB_HOST`
- `BUILDINGHUB_PUBLIC_BASE_URL`
- `BUILDINGHUB_ALLOWED_RETURN_ORIGINS`

## Add A Building

The preferred community model is repo-first: create a GitHub repo for the building, keep `buildinghub/building.json` there as the source of truth, then submit a reviewed snapshot into this central registry. See `docs/package-repos.md`.

1. Create a package repo such as `github.com/you/my-service` with `buildinghub/building.json`, `README.md`, and optional `assets/thumbnail.png`.
2. In this registry repo, copy `templates/basic-building/building.json` into `buildings/<your-id>/building.json`.
3. Set `repo.url`, `repo.manifestPath`, `media.thumbnail`, `footprint`, `tools`, `endpoints`, and a semver-like `version` such as `0.1.0`.
4. Add a short `buildings/<your-id>/README.md` that links to the package repo.
5. Run `npm test`.
6. Run `npm run build`.
7. Run `node bin/buildinghub.mjs publish <your-id>` and include the output in the PR.

Keep manifests declarative. Put setup variables under `capabilities`, agent-facing tool surfaces under `tools`, service/webhook/OAuth surfaces under `endpoints`, and repo/media/footprint data in their named fields. Do not include secrets or executable code.

## Add A Layout

1. Copy `templates/basic-layout/layout.json` into `layouts/<your-id>/layout.json`.
2. Add a short `layouts/<your-id>/README.md`.
3. Set a semver-like `version` such as `0.1.0`.
4. Keep `layout` declarative: cosmetic decorations, optional functional building coordinates, theme id, and required building ids.
5. Run `npm test`.
6. Run `npm run build` and include the generated `registry.json` changes in the PR.

Layouts are blueprints. They should not contain prompts, secrets, tokens, user transcripts, local file paths, or executable commands.

## Add A Scaffold

1. Export from Vibe Research with `vr-scaffold-recipe export --pretty`, or copy `templates/basic-scaffold/recipe.json` into `recipes/<your-id>/recipe.json`.
2. Add a short `recipes/<your-id>/README.md`.
3. Keep the recipe portable: include buildings, layout, communication policy, sandbox assumptions, occupation/Library metadata, and local binding requirements.
4. Do not include secrets, tokens, private remotes, personal chat IDs, local file paths, transcripts, or executable commands.
5. Run `npm test`.
6. Run `npm run site` and include the generated `registry.json` and `site/registry.json` changes in the PR.

Scaffolds are reproducible setup recipes. They can include a layout, but they also carry operational policy and local binding requirements so another Vibe Research install can preview the impact before applying it.

## Trust Levels

- `manifest-only`: default. Safe metadata and setup instructions only.
- `helper-command`: requires the user to install or provide a separate local command.
- `mcp`: requires an MCP/provider connector outside Vibe Research.

Executable integrations belong in separate, reviewed packages. BuildingHub should describe how to connect them, not hide code inside catalog entries.

## Registry Shape

`registry.json` keeps app compatibility and package metadata side by side:

- `buildings[]` is the compatibility list Vibe Research loads today.
- `layouts[]` is the shared Agent Town base-layout gallery Vibe Research can import.
- `recipes[]` is the scaffold recipe gallery Vibe Research can preview/apply.
- `packages[]` is the ClawHub-style building package index: id, latest version, trust level, manifest path, README path, and manifest SHA-256.
- `layoutPackages[]` is the same package metadata lane for shared layouts.
- `recipePackages[]` is the same package metadata lane for scaffold recipes.
- `dist/<id>/<version>/<id>-<version>.buildinghub.json` is the review/upload bundle generated by `npm run pack` or `buildinghub publish`.

The package lane is metadata-only. It gives us version history, checksums, review artifacts, and hosted-registry readiness without giving community manifests permission to execute code.

Repo-first package metadata gives hosted BuildingHub the app-store path: package pages, maintainer repos, thumbnails, footprints, tools/endpoints, immutable versions, reports, stars, installs, and review queues can be added without changing Vibe Research's manifest-only safety boundary.
