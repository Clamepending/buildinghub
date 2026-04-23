# Building Manifest Reference

This is the reference contract for `buildinghub/building.json` in a package repo and `buildings/<id>/building.json` in the central BuildingHub registry.

BuildingHub manifests are declarative. They describe a building, its setup, its town footprint, and the external tools or APIs a user can connect. They do not grant credentials, install code, or run commands inside Vibe Research.

## Required Fields

| field | type | purpose |
| --- | --- | --- |
| `id` | string | Stable package id. Lowercase letters, numbers, and dashes. Must match the registry folder name. |
| `name` | string | Display name. |
| `version` | string | Semver-like version, for example `0.1.0`. |
| `category` | string | Catalog grouping such as `Compute`, `Planning`, `Communication`, or `Vibe Research`. |
| `description` | string | One or two sentence catalog summary. |
| `onboarding.steps` | array | At least one setup step for users and agents. |

## Listing Metadata

| field | purpose |
| --- | --- |
| `status` | Human-readable state such as `community`, `setup available`, `MCP-ready`, or `built in`. |
| `trust` | One of `manifest-only`, `helper-command`, or `mcp`. |
| `icon` | Small symbolic id for display and future package pages. |
| `keywords` | Search facets. The site also searches nested manifest text. |
| `homepageUrl` | Product homepage. |
| `docsUrl` | Main docs URL. |
| `repositoryUrl` | Legacy repository link. Prefer `repo.url` for new packages. |

## Repo

`repo` describes the package's canonical GitHub source. New community packages should define it.

```json
{
  "repo": {
    "url": "https://github.com/you/my-building",
    "owner": "you",
    "name": "my-building",
    "branch": "main",
    "commit": "abc1234",
    "manifestPath": "buildinghub/building.json",
    "readmePath": "README.md",
    "assetsPath": "assets"
  }
}
```

Rules:

- `url` must be `http` or `https`.
- `manifestPath`, `readmePath`, `assetsPath`, and `packagePath` must be repo-relative paths.
- Paths cannot start with `/`, contain backslashes, or escape upward with `..`.
- `commit`, when present, must look like a git SHA.

## Media

`media` powers app-store listing visuals.

```json
{
  "media": {
    "thumbnail": {
      "path": "assets/thumbnail.png",
      "alt": "My Building thumbnail"
    },
    "screenshots": [
      {
        "path": "assets/screenshots/setup.png",
        "alt": "Setup screen",
        "caption": "Configuration checklist"
      }
    ]
  }
}
```

Rules:

- Every media asset needs `alt`.
- Each asset needs either `path` or `url`.
- `url` must be `http` or `https`.
- `path` must be repo-relative and safe.

## Footprint

`footprint` describes the suggested Agent Town lot.

```json
{
  "footprint": {
    "width": 3,
    "height": 2,
    "shape": "factory",
    "snap": "grid",
    "entrances": [
      { "side": "south", "offset": 1.5 }
    ]
  }
}
```

Rules:

- `width` and `height` are integers from 1 to 12.
- `snap` is `grid` or `free`.
- entrance `side` is one of `north`, `east`, `south`, or `west`.

## Access

`access` explains what must already exist outside BuildingHub.

```json
{
  "access": {
    "label": "Modal CLI/Python SDK",
    "detail": "Requires a Modal account plus token credentials where the agent runs."
  }
}
```

## Capabilities

`capabilities` is the compatibility layer Vibe Research already understands.

Supported `type` values:

- `mcp`
- `helper-command`
- `env`
- `webhook`
- `oauth`
- `api`

Example:

```json
{
  "capabilities": [
    {
      "type": "env",
      "name": "MODAL_TOKEN_SECRET",
      "detail": "Modal token secret for automated CLI or SDK access.",
      "required": true
    }
  ]
}
```

Validation:

- `env` capability names must look like environment variables.
- `helper-command.command` must be a command name, not a shell snippet.

## Tools

`tools` is the richer package layer for agent-facing interfaces.

Supported `type` values:

- `mcp-tool`
- `helper-command`
- `api`
- `webhook`
- `oauth-scope`
- `env`

Example:

```json
{
  "tools": [
    {
      "type": "helper-command",
      "name": "modal",
      "command": "modal",
      "detail": "Modal CLI for token inspection, app runs, deployments, and sandbox workflows.",
      "required": true
    }
  ]
}
```

Validation:

- Every tool needs `type`, `name`, and `detail`.
- `env` tool names must look like environment variables.
- `command`, when present, must be a command name, not a shell snippet.

## Endpoints

`endpoints` documents service surfaces the user configures outside BuildingHub.

Supported `type` values:

- `api`
- `webhook`
- `oauth`
- `mcp`
- `docs`
- `local`

Supported HTTP `method` values:

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

Supported `auth` values:

- `none`
- `api-key`
- `oauth`
- `mcp`
- `custom`

Example:

```json
{
  "endpoints": [
    {
      "type": "api",
      "name": "products-link",
      "method": "POST",
      "urlTemplate": "https://connect.dev.instacart.tools/idp/v1/products/products_link",
      "auth": "api-key",
      "detail": "Creates a Marketplace shopping-list page for human review.",
      "required": false
    }
  ]
}
```

Validation:

- Every endpoint needs `type`, `name`, and `detail`.
- `url` and `urlTemplate`, when present, must be `http` or `https`.
- `method` and `auth` must be one of the supported values above.

## Onboarding

`onboarding` is what the user sees during setup.

```json
{
  "onboarding": {
    "variables": [
      {
        "label": "Modal token secret",
        "value": "MODAL_TOKEN_SECRET in agent environment",
        "required": true,
        "secret": true
      }
    ],
    "steps": [
      {
        "title": "Configure credentials",
        "detail": "Use modal token set or environment variables in the runtime that will run Modal work."
      }
    ]
  }
}
```

Do not put real secrets, tokens, local private paths, or account-specific values in this section.

## Agent Guide

`agentGuide` is optional but useful for agents. It can include:

- `summary`
- `useCases[]`
- `setup[]`
- `commands[]`
- `docs[]`
- `env[]`

Commands must remain examples or helper names. They must not include suspicious install pipelines or destructive shell text.
