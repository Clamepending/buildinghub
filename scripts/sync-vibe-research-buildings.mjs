#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SOURCE = path.resolve(DEFAULT_ROOT, "..", "remote-vibes");
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SIMPLE_COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/;
const HELPER_COMMAND_ALLOWLIST = new Set([
  "gh",
  "harbor",
  "modal",
  "npx",
  "tailscale",
  "vr-agent-canvas",
  "vr-browser-use",
  "vr-ottoauth",
  "vr-playwright",
  "vr-videomemory",
]);

const EXTRA_MANIFESTS = [
  {
    id: "modal",
    name: "Modal",
    version: "0.1.0",
    category: "Compute",
    description: "Run Python functions, jobs, web endpoints, and sandboxes on Modal cloud infrastructure.",
    status: "setup available",
    trust: "helper-command",
    icon: "compute",
    docsUrl: "https://modal.com/docs",
    homepageUrl: "https://modal.com/",
    keywords: [
      "modal",
      "compute",
      "gpu",
      "sandbox",
      "python",
      "serverless",
      "jobs",
      "functions",
      "web endpoints",
      "cloud",
    ],
    visual: {
      shape: "factory",
    },
    access: {
      label: "Modal CLI/Python SDK",
      detail: "Requires a Modal account plus token credentials where the agent runs. BuildingHub records setup metadata only and does not run Modal code.",
    },
    capabilities: [
      {
        type: "helper-command",
        name: "modal",
        command: "modal",
        detail: "Modal CLI for token inspection, app runs, deployments, and sandbox workflows.",
        required: true,
      },
      {
        type: "env",
        name: "MODAL_TOKEN_ID",
        detail: "Modal account token id for automated CLI or SDK access.",
        required: true,
      },
      {
        type: "env",
        name: "MODAL_TOKEN_SECRET",
        detail: "Modal account token secret for automated CLI or SDK access.",
        required: true,
      },
      {
        type: "env",
        name: "MODAL_ENVIRONMENT",
        detail: "Optional Modal Environment name when agents should target dev, prod, or another workspace environment.",
        required: false,
      },
    ],
    onboarding: {
      variables: [
        {
          label: "Modal token id",
          value: "MODAL_TOKEN_ID in agent environment or modal token set profile",
          required: true,
          secret: true,
        },
        {
          label: "Modal token secret",
          value: "MODAL_TOKEN_SECRET in agent environment or modal token set profile",
          required: true,
          secret: true,
        },
        {
          label: "Modal environment",
          value: "MODAL_ENVIRONMENT or default Modal profile environment",
          required: false,
        },
        {
          label: "Budget guardrail",
          value: "allowed GPU classes, runtime, deployment scope, and teardown expectations",
          required: true,
        },
      ],
      steps: [
        {
          title: "Install Modal tooling",
          detail: "Make the Modal Python package and modal CLI available in the agent runtime.",
        },
        {
          title: "Configure credentials",
          detail: "Use modal token set or MODAL_TOKEN_ID and MODAL_TOKEN_SECRET in the environment that will run Modal work.",
        },
        {
          title: "Choose environment and budget",
          detail: "Pin the target Modal Environment and write cost, GPU, runtime, and deployment guardrails before agents launch jobs.",
        },
        {
          title: "Install the building",
          detail: "Add Modal to Agent Town after credentials and budget rules are documented.",
          completeWhen: {
            type: "installed",
          },
        },
      ],
    },
    agentGuide: {
      summary: "Use Modal when an agent needs to run Python functions, jobs, web endpoints, or sandbox workloads on Modal after credentials and cost guardrails are approved.",
      useCases: [
        "Run remote Python jobs that need GPUs or serverless scaling.",
        "Deploy or inspect Modal Apps, Functions, web endpoints, Volumes, Secrets, and Sandboxes.",
        "Check whether Modal token credentials or Environment selection are blocking a cloud run.",
      ],
      setup: [
        "Read the generated BuildingHub manifest and Modal docs before launching paid cloud workloads.",
        "Run modal token info or modal config show to confirm authentication without printing secrets.",
        "Ask for approval before deploying persistent services, broad parallel jobs, expensive GPUs, or long-running work.",
        "Record Modal app name, environment, command, commit, output paths, and cost-relevant settings in result docs when they matter.",
      ],
      commands: [
        {
          label: "Check Modal CLI",
          command: "modal --help",
          detail: "Confirms the Modal CLI is installed.",
        },
        {
          label: "Check token profile",
          command: "modal token info",
          detail: "Shows the active Modal token profile without exposing the token secret.",
        },
        {
          label: "Show redacted config",
          command: "modal config show",
          detail: "Inspects the active Modal configuration with secret redaction enabled by default.",
        },
      ],
      docs: [
        {
          label: "Modal docs",
          url: "https://modal.com/docs",
        },
        {
          label: "Modal token CLI",
          url: "https://modal.com/docs/reference/cli/token",
        },
        {
          label: "Modal configuration",
          url: "https://modal.com/docs/reference/modal.config",
        },
        {
          label: "Modal Environments",
          url: "https://modal.com/docs/guide/environments",
        },
        {
          label: "Modal Secrets",
          url: "https://modal.com/docs/guide/secrets",
        },
      ],
      env: [
        {
          name: "MODAL_TOKEN_ID",
          detail: "Modal token id for automated CLI or SDK access; keep paired with the secret.",
          required: true,
        },
        {
          name: "MODAL_TOKEN_SECRET",
          detail: "Modal token secret for automated CLI or SDK access; never print it.",
          required: true,
        },
        {
          name: "MODAL_ENVIRONMENT",
          detail: "Optional target Modal Environment for CLI and SDK operations.",
          required: false,
        },
      ],
    },
  },
];

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    source: DEFAULT_SOURCE,
  };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--root") {
      options.root = path.resolve(args.shift() || "");
    } else if (arg === "--source") {
      options.source = path.resolve(args.shift() || "");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return `Usage: node scripts/sync-vibe-research-buildings.mjs [--source <remote-vibes>] [--root <buildinghub>]\n`;
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values.map(cleanString).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return output;
}

function normalizeId(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getNestedStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => getNestedStrings(entry, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => getNestedStrings(entry, output));
  }
  return output;
}

function extractUppercaseEnvNames(value) {
  return uniqueStrings(getNestedStrings(value).flatMap((text) => text.match(/[A-Z][A-Z0-9_]{2,}/g) || []))
    .filter((name) => ENV_NAME_PATTERN.test(name));
}

function expandEnvNames(name) {
  return cleanString(name)
    .split(/[/,]/)
    .map(cleanString)
    .filter((part) => ENV_NAME_PATTERN.test(part));
}

function getCommandName(command) {
  const token = cleanString(command).split(/\s+/)[0] || "";
  return SIMPLE_COMMAND_PATTERN.test(token) ? token : "";
}

function sanitizeOnboarding(onboarding = {}) {
  const variables = Array.isArray(onboarding.variables)
    ? onboarding.variables.map((variable) => {
      const value = cleanString(variable.value)
        || (variable.setting ? `Vibe Research setting: ${variable.setting}` : "")
        || (variable.configuredSetting ? `Vibe Research configured setting: ${variable.configuredSetting}` : "");
      return {
        label: cleanString(variable.label),
        ...(value ? { value } : {}),
        ...(variable.required !== undefined ? { required: Boolean(variable.required) } : {}),
        ...(variable.secret !== undefined ? { secret: Boolean(variable.secret) } : {}),
      };
    }).filter((variable) => variable.label)
    : [];

  const steps = Array.isArray(onboarding.steps)
    ? onboarding.steps.map((step) => ({
      title: cleanString(step.title),
      detail: cleanString(step.detail),
      ...(step.completeWhen && typeof step.completeWhen === "object" && !Array.isArray(step.completeWhen)
        ? { completeWhen: step.completeWhen }
        : {}),
    })).filter((step) => step.title && step.detail)
    : [];

  return {
    ...(variables.length ? { variables } : {}),
    steps: steps.length
      ? steps
      : [
        {
          title: "Review setup",
          detail: "Read this manifest, confirm the required access path, and install the building only when the setup notes match the current project.",
        },
      ],
  };
}

function sanitizeAgentGuide(agentGuide = {}) {
  const guide = {};
  if (cleanString(agentGuide.summary)) {
    guide.summary = cleanString(agentGuide.summary);
  }
  for (const key of ["useCases", "setup"]) {
    const values = Array.isArray(agentGuide[key])
      ? agentGuide[key].map(cleanString).filter(Boolean)
      : [];
    if (values.length) {
      guide[key] = values;
    }
  }
  for (const key of ["commands", "docs", "env"]) {
    const values = Array.isArray(agentGuide[key])
      ? agentGuide[key].filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      : [];
    if (values.length) {
      guide[key] = values;
    }
  }
  return guide;
}

function inferCapabilities(building, agentGuide) {
  const capabilities = [];
  const add = (capability) => {
    const name = cleanString(capability.name);
    if (!name) {
      return;
    }
    const key = `${capability.type}:${name.toLowerCase()}`;
    if (capabilities.some((entry) => `${entry.type}:${entry.name.toLowerCase()}` === key)) {
      return;
    }
    capabilities.push(capability);
  };

  for (const env of Array.isArray(agentGuide.env) ? agentGuide.env : []) {
    for (const name of expandEnvNames(env.name)) {
      add({
        type: "env",
        name,
        detail: cleanString(env.detail) || `Environment variable used by ${building.name}.`,
        required: Boolean(env.required),
      });
    }
  }

  for (const name of extractUppercaseEnvNames([building.onboarding, building.access]).slice(0, 12)) {
    add({
      type: "env",
      name,
      detail: `Environment variable referenced by ${building.name} setup notes.`,
      required: false,
    });
  }

  for (const command of Array.isArray(agentGuide.commands) ? agentGuide.commands : []) {
    const commandName = getCommandName(command.command);
    if (!HELPER_COMMAND_ALLOWLIST.has(commandName)) {
      continue;
    }
    add({
      type: "helper-command",
      name: commandName,
      command: commandName,
      detail: cleanString(command.detail) || cleanString(command.label) || `Helper command for ${building.name}.`,
      required: false,
    });
  }

  const mcpText = [
    building.source,
    building.status,
    building.access?.label,
    building.access?.detail,
    building.description,
  ].join(" ");
  if (/\bmcp\b/i.test(mcpText)) {
    add({
      type: "mcp",
      name: `${building.name} MCP`,
      detail: building.access?.detail || `${building.name} can be connected through an MCP-capable provider.`,
      required: false,
    });
  }

  return capabilities;
}

function inferTrust(building, capabilities) {
  if (capabilities.some((capability) => capability.type === "mcp")) {
    return "mcp";
  }
  if (capabilities.some((capability) => capability.type === "helper-command")) {
    return "helper-command";
  }
  return cleanString(building.trust) || "manifest-only";
}

function sanitizeCoreBuilding(building) {
  const agentGuide = sanitizeAgentGuide(building.agentGuide || {});
  const capabilities = inferCapabilities(building, agentGuide);
  const visual = building.visual && typeof building.visual === "object" && !Array.isArray(building.visual)
    ? {
      ...(cleanString(building.visual.logo) ? { logo: normalizeId(building.visual.logo) } : {}),
      shape: normalizeId(building.visual.shape || "plugin") || "plugin",
    }
    : { shape: "plugin" };

  const manifest = {
    id: normalizeId(building.id || building.name),
    name: cleanString(building.name),
    version: cleanString(building.version) || "0.1.0",
    category: cleanString(building.category) || "Vibe Research",
    description: cleanString(building.description),
    status: cleanString(building.status) || "catalog",
    trust: inferTrust(building, capabilities),
    icon: normalizeId(building.visual?.logo || building.visual?.shape || building.category || building.name) || "building",
    keywords: uniqueStrings([
      ...normalizeId(building.id || "").split("-"),
      building.source,
      building.status,
      building.category,
      visual.logo,
      visual.shape,
      ...capabilities.map((capability) => capability.name),
      ...getNestedStrings(building.onboarding).slice(0, 20),
    ]).slice(0, 24),
    visual,
    access: building.access && cleanString(building.access.label) && cleanString(building.access.detail)
      ? {
        label: cleanString(building.access.label),
        detail: cleanString(building.access.detail),
      }
      : {
        label: `${cleanString(building.source) || "Vibe Research"} catalog`,
        detail: `${cleanString(building.name)} is mirrored from the Vibe Research building catalog as manifest-only setup metadata.`,
      },
    ...(capabilities.length ? { capabilities } : {}),
    onboarding: sanitizeOnboarding(building.onboarding || {}),
  };

  if (Object.keys(agentGuide).length) {
    manifest.agentGuide = agentGuide;
  }

  return manifest;
}

function getReadme(manifest, sourceLabel) {
  return `# ${manifest.name} Building

Manifest-only BuildingHub entry for ${manifest.name}.

- Source: ${sourceLabel}
- Category: ${manifest.category}
- Trust lane: ${manifest.trust}

This entry is declarative metadata for search, setup guidance, and Agent Town placement. It does not grant credentials, install code, or run service actions by itself.
`;
}

async function writeManifest(root, manifest, sourceLabel) {
  const buildingDir = path.join(root, "buildings", manifest.id);
  await mkdir(buildingDir, { recursive: true });
  await writeFile(path.join(buildingDir, "building.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(buildingDir, "README.md"), getReadme(manifest, sourceLabel), "utf8");
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const registryModule = path.join(options.source, "src", "client", "building-registry.js");
  const { BUILDING_CATALOG } = await import(pathToFileURL(registryModule));
  const manifests = [
    ...BUILDING_CATALOG.map(sanitizeCoreBuilding),
    ...EXTRA_MANIFESTS,
  ].sort((left, right) => left.id.localeCompare(right.id));

  for (const manifest of manifests) {
    const sourceLabel = manifest.id === "modal"
      ? "curated BuildingHub compute entry, using official Modal docs"
      : `Vibe Research core catalog (${manifest.id})`;
    await writeManifest(options.root, manifest, sourceLabel);
  }

  process.stdout.write(`synced ${manifests.length} Vibe Research and curated buildings into ${path.join(options.root, "buildings")}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
