import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const STORE_FILENAME = "accounts.json";
const STORE_VERSION = 1;
const FILE_MODE = 0o600;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const GRANT_TTL_MS = 5 * 60 * 1000;
const PUBLICATION_KINDS = new Set(["layout", "recipe", "building"]);

function nowIso(now = Date.now()) {
  return new Date(now()).toISOString();
}

function clampText(value, limit = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, limit));
}

function normalizeUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeLogin(value, fallback = "builder") {
  const normalized = String(value || fallback || "builder")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
  return normalized || fallback;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function createOpaqueToken(prefix) {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeGitHubProfile(profile = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  const id = clampText(profile.id, 120);
  const login = normalizeLogin(profile.login || profile.username, "");
  const name = clampText(profile.name || profile.displayName, 160);
  const profileUrl = normalizeUrl(profile.profileUrl || profile.html_url || profile.url);
  const avatarUrl = normalizeUrl(profile.avatarUrl || profile.avatar_url);

  if (!id && !login && !name && !profileUrl) {
    return null;
  }

  return {
    id,
    login,
    name,
    profileUrl,
    avatarUrl,
  };
}

function normalizePublication(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const kind = clampText(record.kind, 40).toLowerCase();
  const itemId = normalizeLogin(record.itemId || record.id, "");
  const name = clampText(record.name || record.title, 160);
  const url = normalizeUrl(record.url || record.layoutUrl || record.recipeUrl);
  const sourceUrl = normalizeUrl(record.sourceUrl || record.repositoryUrl);
  const commitUrl = normalizeUrl(record.commitUrl);

  if (!PUBLICATION_KINDS.has(kind) || !itemId || !name || !url) {
    return null;
  }

  return {
    kind,
    itemId,
    name,
    url,
    sourceUrl,
    commitUrl,
  };
}

function clonePublication(publication) {
  return publication
    ? {
        kind: publication.kind,
        itemId: publication.itemId,
        name: publication.name,
        url: publication.url,
        sourceUrl: publication.sourceUrl,
        commitUrl: publication.commitUrl,
        createdAt: publication.createdAt,
        updatedAt: publication.updatedAt,
      }
    : null;
}

export class BuildingHubAccountStore {
  constructor({ dataDir, now = Date.now } = {}) {
    this.dataDir = dataDir || "";
    this.filePath = this.dataDir ? path.join(this.dataDir, STORE_FILENAME) : "";
    this.now = typeof now === "function" ? now : Date.now;
    this.payload = {
      users: [],
      sessions: [],
      tokens: [],
      grants: [],
      publications: [],
    };
  }

  async load() {
    if (!this.filePath) {
      return;
    }

    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version === STORE_VERSION && parsed.payload && typeof parsed.payload === "object") {
        this.payload = {
          users: Array.isArray(parsed.payload.users) ? parsed.payload.users : [],
          sessions: Array.isArray(parsed.payload.sessions) ? parsed.payload.sessions : [],
          tokens: Array.isArray(parsed.payload.tokens) ? parsed.payload.tokens : [],
          grants: Array.isArray(parsed.payload.grants) ? parsed.payload.grants : [],
          publications: Array.isArray(parsed.payload.publications) ? parsed.payload.publications : [],
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    await this.pruneExpired();
  }

  async save() {
    if (!this.filePath) {
      return;
    }

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      tempPath,
      `${JSON.stringify({
        version: STORE_VERSION,
        savedAt: nowIso(this.now),
        payload: this.payload,
      }, null, 2)}\n`,
      { encoding: "utf8", mode: FILE_MODE },
    );
    await rename(tempPath, this.filePath);
  }

  async pruneExpired() {
    const now = this.now();
    const nextSessions = this.payload.sessions.filter((entry) => parseTimestamp(entry.expiresAt) > now);
    const nextTokens = this.payload.tokens.filter(
      (entry) => !entry.revokedAt && parseTimestamp(entry.expiresAt) > now,
    );
    const nextGrants = this.payload.grants.filter(
      (entry) => !entry.usedAt && parseTimestamp(entry.expiresAt) > now,
    );

    if (
      nextSessions.length === this.payload.sessions.length &&
      nextTokens.length === this.payload.tokens.length &&
      nextGrants.length === this.payload.grants.length
    ) {
      return false;
    }

    this.payload = {
      ...this.payload,
      sessions: nextSessions,
      tokens: nextTokens,
      grants: nextGrants,
    };
    await this.save();
    return true;
  }

  ensureUniqueLogin(login, userId = "") {
    const desired = normalizeLogin(login, "builder");
    let candidate = desired;
    let suffix = 2;

    while (
      this.payload.users.some((entry) => entry.id !== userId && normalizeLogin(entry.login, "") === candidate)
    ) {
      candidate = `${desired}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  getUserById(userId) {
    return this.payload.users.find((entry) => entry.id === userId) || null;
  }

  getUserByLogin(login) {
    const normalizedLogin = normalizeLogin(login, "");
    if (!normalizedLogin) {
      return null;
    }
    return this.payload.users.find((entry) => normalizeLogin(entry.login, "") === normalizedLogin) || null;
  }

  buildPublicAccount(user, baseUrl = "") {
    if (!user) {
      return null;
    }

    const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
    const profileUrl = normalizedBaseUrl && user.login ? `${normalizedBaseUrl}/u/${encodeURIComponent(user.login)}` : "";

    return {
      provider: "buildinghub",
      id: user.id,
      login: user.login,
      name: user.name || user.githubName || user.githubLogin,
      avatarUrl: user.avatarUrl || user.githubAvatarUrl || "",
      profileUrl,
      githubLogin: user.githubLogin || "",
      githubProfileUrl: user.githubProfileUrl || "",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async upsertGitHubUser(profile = {}) {
    const normalized = normalizeGitHubProfile(profile);
    if (!normalized?.id && !normalized?.login) {
      throw new Error("GitHub profile is required to create a BuildingHub account.");
    }

    const nowAt = nowIso(this.now);
    const existing = this.payload.users.find(
      (entry) => (normalized.id && entry.githubId === normalized.id) || (normalized.login && entry.githubLogin === normalized.login),
    );
    const desiredLogin = this.ensureUniqueLogin(normalized.login || existing?.login || normalized.id || "builder", existing?.id || "");
    const nextUser = {
      id: existing?.id || `bhusr_${randomUUID()}`,
      login: desiredLogin,
      name: normalized.name || existing?.name || normalized.login || "BuildingHub user",
      avatarUrl: normalized.avatarUrl || existing?.avatarUrl || "",
      githubId: normalized.id || existing?.githubId || "",
      githubLogin: normalized.login || existing?.githubLogin || "",
      githubName: normalized.name || existing?.githubName || "",
      githubProfileUrl: normalized.profileUrl || existing?.githubProfileUrl || "",
      githubAvatarUrl: normalized.avatarUrl || existing?.githubAvatarUrl || "",
      createdAt: existing?.createdAt || nowAt,
      updatedAt: nowAt,
    };

    if (existing) {
      this.payload.users = this.payload.users.map((entry) => (entry.id === existing.id ? nextUser : entry));
    } else {
      this.payload.users.push(nextUser);
    }

    await this.save();
    return nextUser;
  }

  async createSession(userId) {
    const now = this.now();
    const session = {
      id: `bhsess_${randomUUID()}`,
      userId,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    this.payload.sessions.push(session);
    await this.save();
    return { ...session };
  }

  async deleteSession(sessionId) {
    const nextSessions = this.payload.sessions.filter((entry) => entry.id !== sessionId);
    if (nextSessions.length === this.payload.sessions.length) {
      return false;
    }

    this.payload.sessions = nextSessions;
    await this.save();
    return true;
  }

  async authenticateSession(sessionId) {
    await this.pruneExpired();
    const session = this.payload.sessions.find((entry) => entry.id === String(sessionId || "").trim());
    if (!session) {
      return null;
    }

    session.lastSeenAt = nowIso(this.now);
    await this.save();
    return this.getUserById(session.userId);
  }

  async issueApiToken(userId, { label = "Vibe Research" } = {}) {
    const now = this.now();
    const rawToken = createOpaqueToken("bhp_");
    const token = {
      id: `bhtok_${randomUUID()}`,
      userId,
      label: clampText(label, 120) || "Vibe Research",
      tokenHash: hashSecret(rawToken),
      createdAt: new Date(now).toISOString(),
      lastUsedAt: "",
      expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
      revokedAt: "",
    };
    this.payload.tokens.push(token);
    await this.save();
    return { ...token, accessToken: rawToken };
  }

  async authenticateApiToken(rawToken) {
    await this.pruneExpired();
    const tokenHash = hashSecret(rawToken);
    const token = this.payload.tokens.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
    if (!token) {
      return null;
    }

    token.lastUsedAt = nowIso(this.now);
    await this.save();
    return this.getUserById(token.userId);
  }

  async revokeApiToken(rawToken) {
    const tokenHash = hashSecret(rawToken);
    const token = this.payload.tokens.find((entry) => entry.tokenHash === tokenHash && !entry.revokedAt);
    if (!token) {
      return false;
    }

    token.revokedAt = nowIso(this.now);
    await this.save();
    return true;
  }

  async createGrant(userId, { redirectUri = "", label = "Vibe Research" } = {}) {
    const normalizedRedirectUri = normalizeUrl(redirectUri);
    if (!normalizedRedirectUri) {
      throw new Error("Grant redirect URI is required.");
    }

    const now = this.now();
    const rawGrant = createOpaqueToken("bhg_");
    this.payload.grants.push({
      id: `bhgrant_${randomUUID()}`,
      userId,
      grantHash: hashSecret(rawGrant),
      redirectUri: normalizedRedirectUri,
      label: clampText(label, 120) || "Vibe Research",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
      usedAt: "",
    });
    await this.save();
    return rawGrant;
  }

  async consumeGrant(rawGrant, { redirectUri = "" } = {}) {
    await this.pruneExpired();
    const normalizedRedirectUri = normalizeUrl(redirectUri);
    const grantHash = hashSecret(rawGrant);
    const grant = this.payload.grants.find(
      (entry) => entry.grantHash === grantHash && !entry.usedAt,
    );
    if (!grant) {
      return null;
    }
    if (normalizedRedirectUri && grant.redirectUri !== normalizedRedirectUri) {
      return null;
    }

    grant.usedAt = nowIso(this.now);
    const issuedToken = await this.issueApiToken(grant.userId, { label: grant.label });
    await this.save();
    return {
      accessToken: issuedToken.accessToken,
      user: this.getUserById(grant.userId),
      redirectUri: grant.redirectUri,
    };
  }

  async upsertPublication(userId, payload = {}) {
    const normalized = normalizePublication(payload);
    if (!normalized) {
      throw new Error("A publication requires kind, id, name, and url.");
    }

    const nowAt = nowIso(this.now);
    const publicationKey = `${normalized.kind}:${normalized.itemId}`;
    const existing = this.payload.publications.find(
      (entry) => entry.userId === userId && `${entry.kind}:${entry.itemId}` === publicationKey,
    );
    const nextPublication = {
      userId,
      kind: normalized.kind,
      itemId: normalized.itemId,
      name: normalized.name,
      url: normalized.url,
      sourceUrl: normalized.sourceUrl,
      commitUrl: normalized.commitUrl,
      createdAt: existing?.createdAt || nowAt,
      updatedAt: nowAt,
    };

    if (existing) {
      this.payload.publications = this.payload.publications.map((entry) => (
        entry.userId === userId && `${entry.kind}:${entry.itemId}` === publicationKey
          ? nextPublication
          : entry
      ));
    } else {
      this.payload.publications.push(nextPublication);
    }

    await this.save();
    return clonePublication(nextPublication);
  }

  listPublicationsForUser(userId) {
    return this.payload.publications
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt))
      .map((entry) => clonePublication(entry));
  }
}
