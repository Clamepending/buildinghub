# Building Structure Migration Status

Updated: 2026-04-23

This page answers the practical question: are the buildings organized well enough for users, agents, and community contributors?

Short answer: the central BuildingHub registry is organized into the new manifest/package structure, but the full app-store migration is only partially complete. Every building has a package record and town footprint. Only the first repo-first building snapshot has a source repo and thumbnail wired into the manifest.

## Current Catalog

| area | status |
| --- | --- |
| Buildings | 36 central building manifests. |
| Package records | 36 of 36 are emitted into `packages[]`. |
| Town footprints | 36 of 36 define `footprint`. |
| Tool surfaces | 29 of 36 define `tools`. |
| Endpoint surfaces | 14 of 36 define `endpoints`. |
| Repo-first package metadata | 1 of 36 defines `repo.url`. |
| Thumbnail metadata | 1 of 36 defines `media.thumbnail`. |
| Layouts | 4 shared layout manifests with generated preview SVGs. |

## What Is Migrated

All current buildings are in the central manifest structure:

- `buildings/<id>/building.json`
- `buildings/<id>/README.md`
- Generated aggregate record in `registry.json`
- Generated package index record in `packages[]`
- Searchable listing on GitHub Pages
- Declarative setup via `access`, `capabilities`, `onboarding`, and `agentGuide`
- Agent Town placement metadata through `footprint`

This is enough for Vibe Research to load the BuildingHub catalog and for users to search by name, category, setup terms, footprint, tools, and endpoints.

## Repo-First Progress

Repo-first means a building has its own GitHub package repo and the central registry stores a reviewed snapshot of that repo's `buildinghub/building.json`.

Completed repo-first snapshot:

| building | repo | media | tools | endpoints |
| --- | --- | --- | --- | --- |
| `twilio` | `https://github.com/Clamepending/twilio-building` | thumbnail URL set | 6 tools | 6 endpoints |

Not yet completed:

- 35 buildings still need package repos or canonical repo metadata.
- 35 buildings still need thumbnail or screenshot metadata.
- Hosted repo submission, ownership verification, moderation queue, reports, stars, installs, and immutable hosted package pages are not implemented yet.

## Tools Status

`tools` is intended for concrete surfaces that an agent or setup flow can reason about: MCP tools, helper commands, APIs, webhooks, OAuth scopes, and environment variables.

29 buildings have tools today. The 7 buildings without tools are:

- `agentmall`
- `automations`
- `doghouse`
- `github`
- `home-automation`
- `knowledge-base`
- `telegram`

Some of these can legitimately remain without tools if they are internal places, conceptual buildings, or unfinished entries. They should gain tools when there is a clear external interface to document.

## Endpoints Status

`endpoints` is narrower than `tools`. It should describe actual service surfaces such as REST APIs, webhooks, OAuth flows, MCP endpoints, docs surfaces, or local callback URLs.

14 buildings have endpoints today. Buildings without endpoints are not necessarily broken; many are local, internal, or setup-only entries. Add endpoints only when the building has a concrete surface the user configures outside BuildingHub.

## What Still Needs Work

To make BuildingHub feel like an app store for base-builder style buildings, the next migration should focus on listing quality and ownership:

1. Create or link package repos for high-value external buildings first: `modal`, `runpod`, `supabase`, `linear`, `instacart`, `discord`, and `google-drive`.
2. Add `repo.url`, `repo.manifestPath`, `repo.readmePath`, and `repo.assetsPath` for each migrated building.
3. Add a real thumbnail and optional screenshots through `media.thumbnail` and `media.screenshots`.
4. Pin `repo.commit` after review so the central snapshot can prove exactly what was accepted.
5. Add missing `tools` and `endpoints` only where they describe real, documented surfaces.
6. Later, build the hosted submission flow that ingests a GitHub repo URL and validates `buildinghub/building.json` automatically.

## Quality Bar

A building should count as fully migrated when it has:

- A canonical package repo.
- `buildinghub/building.json` in that repo.
- A central reviewed snapshot under `buildings/<id>/`.
- `repo.url`, `repo.manifestPath`, and `repo.readmePath`.
- `media.thumbnail` with useful alt text.
- `footprint` for Agent Town placement.
- `tools` for agent-facing interfaces when any exist.
- `endpoints` for service/webhook/OAuth/MCP/API surfaces when any exist.
- Setup variables and steps under `onboarding`.
- Agent-facing usage notes under `agentGuide`.

By that stricter app-store definition, the migration is started, not finished. By the central registry definition, the buildings are already consistently organized.
