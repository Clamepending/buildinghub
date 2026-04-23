# BuildingHub Security Model

BuildingHub's default package type is manifest-only. A community manifest can help a user understand what to connect, but it cannot make Vibe Research run code.

## Enforced By The CLI

`buildinghub validate` rejects:

- missing `id`, `name`, `version`, `category`, `description`, or onboarding steps
- ids that do not match `^[a-z0-9][a-z0-9-]*$`
- non-semver-like versions
- unsupported trust levels
- unsupported capability types
- unsupported tool or endpoint types
- environment variable names that do not look like env vars
- helper commands that are shell snippets instead of command names
- repo/media paths that are absolute or escape the package folder
- thumbnails without alt text
- invalid footprint dimensions, snap modes, or entrance sides
- endpoint methods, auth modes, or URLs outside the allowed declarative shape
- top-level `install`, `ui`, `setupSelector`, or `specialTownPlace`
- `visual.specialTownPlace`
- `onboarding.setupSelector`
- suspicious shell text such as `curl | sh`, `wget | bash`, `rm -rf`, `sudo`, `eval(...)`, `base64 -d`, or `chmod +x`

## Enforced By Vibe Research

The app loader normalizes community manifests again before showing them:

- forces `source: "buildinghub"`
- strips `install.enabledSetting`
- disables `install.system`
- clears setup selectors and workspace routes
- prevents special town places
- rejects ids that collide with core buildings

## Future Hosted Registry

A hosted BuildingHub should add:

- GitHub account auth
- repo ownership verification
- immutable version records
- pinned source commits for repo-first package submissions
- package scans before publication
- report/appeal flows
- moderator roles
- package hide/unhide
- publisher bans and token revocation
- install warnings for higher-trust packages
