import type { AppConfig } from "./config.ts";

export interface PortalProvisionResult {
  apiKey: string;
  createdApp: boolean;
}

function deriveNameParts(email: string): { firstName: string; lastName: string } {
  const local = (email.split("@")[0] ?? "developer").trim();
  const parts = local
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : "User");
  if (parts.length >= 2) {
    return { firstName: cap(parts[0]!), lastName: cap(parts[1]!) };
  }
  return { firstName: cap(parts[0] || "Developer"), lastName: "User" };
}

function extractClientIdFromApp(app: unknown): string | null {
  if (!app || typeof app !== "object") return null;
  const obj = app as Record<string, unknown>;

  if (typeof obj.clientId === "string" && obj.clientId.trim()) {
    return obj.clientId.trim();
  }
  if (typeof obj.consumerKey === "string" && obj.consumerKey.trim()) {
    return obj.consumerKey.trim();
  }
  if (Array.isArray(obj.credentials)) {
    for (const cred of obj.credentials) {
      if (cred && typeof cred === "object") {
        const c = cred as Record<string, unknown>;
        if (typeof c.clientId === "string" && c.clientId.trim()) return c.clientId.trim();
        if (typeof c.consumerKey === "string" && c.consumerKey.trim()) return c.consumerKey.trim();
      }
    }
  }
  if (obj.app && typeof obj.app === "object") {
    return extractClientIdFromApp(obj.app);
  }
  if (obj.data && typeof obj.data === "object") {
    return extractClientIdFromApp(obj.data);
  }
  return null;
}

function extractAppsList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"));
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["apps", "data", "items"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter(
          (x): x is Record<string, unknown> => Boolean(x && typeof x === "object")
        );
      }
    }
  }
  return [];
}

export function isPortalConfigured(config: Pick<AppConfig, "portalHost" | "portalAdminClientId" | "portalAdminClientSecret">): boolean {
  return Boolean(
    config.portalHost && config.portalAdminClientId && config.portalAdminClientSecret
  );
}

export function deriveDesktopAppName(email: string): string {
  const local = (email.split("@")[0] ?? "user").trim().toLowerCase();
  const safeName = local.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  return `${safeName}-desktop-app`;
}

/**
 * Ensures the user exists in the Apigee Developer Portal and has a `{Name}-desktop-app`
 * subscribed to `coding-agent-product`, returning its `clientId` API key.
 */
export async function ensurePortalCodingAgentKey(
  config: Pick<AppConfig, "portalHost" | "portalAdminClientId" | "portalAdminClientSecret">,
  userEmail: string,
  appName = deriveDesktopAppName(userEmail),
  apiProduct = "coding-agent-product"
): Promise<PortalProvisionResult | null> {
  if (!isPortalConfigured(config)) {
    return null;
  }

  const host = config.portalHost!.replace(/\/+$/, "");
  const encodedEmail = encodeURIComponent(userEmail);

  // 1. Obtain machine access token
  const tokenRes = await fetch(`${host}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.portalAdminClientId!,
      client_secret: config.portalAdminClientSecret!,
      scope: "portal:admin",
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Portal /token failed (${tokenRes.status})`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token?.trim();
  if (!accessToken) {
    throw new Error("Portal /token response missing access_token");
  }

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // 2. POST Login (creates/ensures developer exists in Apigee)
  const { firstName, lastName } = deriveNameParts(userEmail);
  const loginRes = await fetch(`${host}/api/portals/demo/users/${encodedEmail}/login`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email: userEmail,
      firstName,
      lastName,
      userName: userEmail,
    }),
  });
  if (!loginRes.ok) {
    throw new Error(`Portal login failed (${loginRes.status})`);
  }

  // 3. GET Apps (check if coding-agent-app already exists)
  const appsRes = await fetch(`${host}/api/portals/demo/users/${encodedEmail}/apps`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!appsRes.ok) {
    throw new Error(`Portal GET apps failed (${appsRes.status})`);
  }
  const appsPayload = await appsRes.json();
  const apps = extractAppsList(appsPayload);
  const existingApp = apps.find((a) => a.name === appName);
  if (existingApp) {
    const existingKey = extractClientIdFromApp(existingApp);
    if (!existingKey) {
      throw new Error(`Existing app '${appName}' has no clientId/consumerKey`);
    }
    return { apiKey: existingKey, createdApp: false };
  }

  // 4. POST App (create coding-agent-app subscribed to coding-agent-product)
  const createRes = await fetch(`${host}/api/portals/demo/users/${encodedEmail}/apps`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: appName,
      apiProducts: [apiProduct],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Portal POST app failed (${createRes.status})`);
  }
  const createdPayload = await createRes.json();
  const createdKey = extractClientIdFromApp(createdPayload);
  if (!createdKey) {
    throw new Error(`Created app '${appName}' response missing clientId/consumerKey`);
  }
  return { apiKey: createdKey, createdApp: true };
}

/**
 * Mints a user-scoped OIDC id_token via the Portal /token endpoint using portal:admin
 * client credentials and subject_email/subject_name impersonation claims.
 */
export async function mintPortalUserIdToken(
  config: Pick<AppConfig, "portalHost" | "portalAdminClientId" | "portalAdminClientSecret">,
  userEmail: string
): Promise<string | null> {
  if (!isPortalConfigured(config)) {
    return null;
  }

  const host = config.portalHost!.replace(/\/+$/, "");
  const { firstName, lastName } = deriveNameParts(userEmail);
  const res = await fetch(`${host}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.portalAdminClientId!,
      client_secret: config.portalAdminClientSecret!,
      scope: "portal:admin",
      subject_email: userEmail,
      subject_name: `${firstName} ${lastName}`,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Portal user /token failed (${res.status})`);
  }
  const json = (await res.json()) as { id_token?: string };
  return json.id_token?.trim() || null;
}
