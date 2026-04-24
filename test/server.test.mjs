import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { createBuildingHubServer } from "../server/buildinghub-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function createGitHubFetch(profile = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://github.com/login/oauth/access_token") {
      return new Response(JSON.stringify({
        access_token: "github-access-token-test",
        token_type: "bearer",
        scope: "read:user",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (String(url) === "https://api.github.com/user") {
      return new Response(JSON.stringify({
        id: 42,
        login: "octobuilder",
        name: "Octo Builder",
        html_url: "https://github.com/octobuilder",
        avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
        ...profile,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ message: `Unexpected URL: ${url}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("BuildingHub server owns GitHub auth, exchanges grants, and records publications", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "buildinghub-server-"));
  const fetchImpl = createGitHubFetch();
  const server = await createBuildingHubServer({
    root: rootDir,
    siteDir: path.join(rootDir, "site"),
    dataDir,
    host: "127.0.0.1",
    port: 0,
    env: {
      BUILDINGHUB_GITHUB_OAUTH_CLIENT_ID: "buildinghub-client-id",
      BUILDINGHUB_GITHUB_OAUTH_CLIENT_SECRET: "buildinghub-client-secret",
    },
    fetchImpl,
  });

  try {
    const returnTo = "http://127.0.0.1:4826/buildinghub/auth/complete";

    const startResponse = await fetch(
      `${server.baseUrl}/auth/github/start?return_to=${encodeURIComponent(returnTo)}&token_label=${encodeURIComponent("Vibe Research")}`,
      { redirect: "manual" },
    );
    assert.equal(startResponse.status, 302);

    const githubUrl = new URL(startResponse.headers.get("location") || "");
    assert.equal(githubUrl.origin, "https://github.com");
    assert.equal(githubUrl.searchParams.get("client_id"), "buildinghub-client-id");
    assert.equal(githubUrl.searchParams.get("redirect_uri"), `${server.baseUrl}/auth/github/callback`);
    assert.equal(githubUrl.searchParams.get("scope"), "read:user");
    const stateToken = githubUrl.searchParams.get("state");
    assert.ok(stateToken);

    const callbackResponse = await fetch(
      `${server.baseUrl}/auth/github/callback?state=${encodeURIComponent(stateToken)}&code=test-code`,
      { redirect: "manual" },
    );
    assert.equal(callbackResponse.status, 302);
    assert.match(callbackResponse.headers.get("set-cookie") || "", /buildinghub_session=/);

    const completionUrl = new URL(callbackResponse.headers.get("location") || "");
    assert.equal(completionUrl.origin, "http://127.0.0.1:4826");
    const grant = completionUrl.searchParams.get("buildinghub_grant");
    assert.ok(grant);

    const exchangeResponse = await fetch(`${server.baseUrl}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant,
        redirectUri: returnTo,
      }),
    });
    assert.equal(exchangeResponse.status, 200);
    const exchangePayload = await exchangeResponse.json();
    assert.equal(exchangePayload.ok, true);
    assert.match(exchangePayload.accessToken || "", /^bhp_/);
    assert.equal(exchangePayload.account.login, "octobuilder");
    assert.equal(exchangePayload.account.githubLogin, "octobuilder");
    assert.equal(exchangePayload.account.profileUrl, `${server.baseUrl}/u/octobuilder`);

    const accountResponse = await fetch(`${server.baseUrl}/api/account`, {
      headers: { Authorization: `Bearer ${exchangePayload.accessToken}` },
    });
    assert.equal(accountResponse.status, 200);
    const accountPayload = await accountResponse.json();
    assert.equal(accountPayload.account.login, "octobuilder");

    const layoutResponse = await fetch(`${server.baseUrl}/api/layouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exchangePayload.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        layout: {
          id: "builder-lane",
          name: "Builder Lane",
          version: "0.1.0",
          description: "Hosted BuildingHub layout publish.",
          layout: {
            themeId: "default",
            decorations: [{ id: "planter-1", itemId: "planter", x: 32, y: 48 }],
            functional: { buildinghub: { x: 128, y: 224 } },
          },
        },
        previewDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnRk1QAAAAASUVORK5CYII=",
      }),
    });
    assert.equal(layoutResponse.status, 201);
    const layoutPayload = await layoutResponse.json();
    assert.equal(layoutPayload.layoutId, "builder-lane");
    assert.equal(layoutPayload.layoutUrl, `${server.baseUrl}/layouts/builder-lane/`);
    assert.equal(layoutPayload.previewUrl, `${server.baseUrl}/assets/layouts/builder-lane.png`);
    assert.equal(layoutPayload.publisher.login, "octobuilder");
    assert.equal(layoutPayload.recordedByBuildingHub, true);

    const layoutAssetResponse = await fetch(`${server.baseUrl}/assets/layouts/builder-lane.svg`);
    assert.equal(layoutAssetResponse.status, 200);
    assert.equal(layoutAssetResponse.headers.get("content-type"), "image/svg+xml");
    assert.match(await layoutAssetResponse.text(), /Builder Lane/);

    const layoutPageResponse = await fetch(`${server.baseUrl}/layouts/builder-lane/`);
    assert.equal(layoutPageResponse.status, 200);
    assert.match(await layoutPageResponse.text(), /Builder Lane/);

    const recipeResponse = await fetch(`${server.baseUrl}/api/recipes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exchangePayload.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipe: {
          schema: "vibe-research.scaffold.recipe.v1",
          id: "builder-bench",
          name: "Builder Bench",
          version: "0.1.0",
          description: "Hosted BuildingHub recipe publish.",
          buildings: [],
          settings: { portable: {} },
          communication: {
            dm: {
              enabled: false,
              body: "freeform",
              visibility: "workspace",
            },
          },
          localBindingsRequired: [],
        },
      }),
    });
    assert.equal(recipeResponse.status, 201);
    const recipePayload = await recipeResponse.json();
    assert.equal(recipePayload.recipeId, "builder-bench");
    assert.equal(recipePayload.recipeUrl, `${server.baseUrl}/recipes/builder-bench/`);
    assert.equal(recipePayload.publisher.login, "octobuilder");

    const recipeJsonResponse = await fetch(`${server.baseUrl}/recipes/builder-bench/recipe.json`);
    assert.equal(recipeJsonResponse.status, 200);
    const recipeJson = await recipeJsonResponse.json();
    assert.equal(recipeJson.source.recipeUrl, `${server.baseUrl}/recipes/builder-bench/`);

    const recipePageResponse = await fetch(`${server.baseUrl}/recipes/builder-bench/`);
    assert.equal(recipePageResponse.status, 200);
    assert.match(await recipePageResponse.text(), /Builder Bench/);

    const registryResponse = await fetch(`${server.baseUrl}/registry.json`);
    assert.equal(registryResponse.status, 200);
    const registryPayload = await registryResponse.json();
    assert.ok(registryPayload.layouts.some((entry) => entry.id === "builder-lane"));
    assert.ok(registryPayload.recipes.some((entry) => entry.id === "builder-bench"));

    const publicationResponse = await fetch(`${server.baseUrl}/api/publications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${exchangePayload.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "layout",
        id: "main-street",
        name: "Main Street",
        url: "https://buildinghub.example/layouts/main-street/",
        sourceUrl: "https://github.com/example/buildinghub/tree/main/layouts/main-street",
      }),
    });
    assert.equal(publicationResponse.status, 201);

    const profileResponse = await fetch(`${server.baseUrl}/api/users/octobuilder`);
    assert.equal(profileResponse.status, 200);
    const profilePayload = await profileResponse.json();
    assert.equal(profilePayload.profile.publications.length, 3);
    assert.ok(profilePayload.profile.publications.some((entry) => entry.itemId === "builder-lane"));
    assert.ok(profilePayload.profile.publications.some((entry) => entry.itemId === "builder-bench"));
    assert.ok(profilePayload.profile.publications.some((entry) => entry.itemId === "main-street"));

    const profilePageResponse = await fetch(`${server.baseUrl}/u/octobuilder`);
    assert.equal(profilePageResponse.status, 200);
    const profilePageText = await profilePageResponse.text();
    assert.match(profilePageText, /Main Street/);
    assert.match(profilePageText, /Builder Lane/);

    assert.equal(fetchImpl.calls.length, 2);
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("BuildingHub server exposes a health endpoint for hosted deploys", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "buildinghub-health-"));
  const server = await createBuildingHubServer({
    root: rootDir,
    siteDir: path.join(rootDir, "site"),
    dataDir,
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://buildinghub.example.onrender.com",
  });

  try {
    const address = server.server.address();
    const localPort = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${localPort}/healthz`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "buildinghub");
    assert.equal(payload.baseUrl, "https://buildinghub.example.onrender.com");
    assert.equal(payload.dataDir, dataDir);
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
