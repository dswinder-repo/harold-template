// Shared set-up for the local end-to-end runs (not part of `npm test`). They need a real Harold
// repository and a GitHub token, and skip cleanly (exit 0) when those are not configured:
//
//   HAROLD_REPO      owner/name of your Harold repository (required)
//   GITHUB_TOKEN     a token that can read (and, for the write run, write) it; if unset, the token of the
//                    GitHub CLI (`gh auth token`) is used when gh is installed and signed in
//
// The token is held in this process's memory only: it is never printed, logged or written to a file.
// The signed-in GitHub account is looked up from the token, so no login or id is configured here.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ClientV2, StreamableHTTPClientTransport as TransportV2 } from "@modelcontextprotocol/client";
import { fetchGithubUser, type GithubUser } from "../../src/identity.js";

export function skip(reason: string): never {
  console.log(`skipped: ${reason}`);
  process.exit(0);
}

function ghCliToken(): string {
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

/** Repo, branch, token and the token's GitHub user, or a clean skip when they are not available. */
export async function e2eSetup(): Promise<{ repo: string; branch: string; token: string; user: GithubUser }> {
  const repo = (process.env.HAROLD_REPO || "").trim();
  if (!repo) skip("set HAROLD_REPO=owner/name (your Harold repository) and GITHUB_TOKEN (or sign in with the gh CLI) to run the end-to-end tests");
  const token = (process.env.GITHUB_TOKEN || "").trim() || ghCliToken();
  if (!token) skip("set GITHUB_TOKEN (or sign in with the gh CLI: gh auth login) to run the end-to-end tests");
  const user = await fetchGithubUser(token);
  if (!user) skip("the GitHub token was refused by GitHub (GET /user failed)");
  return { repo, branch: (process.env.HAROLD_BRANCH || "main").trim() || "main", token, user };
}

export function crmConfigured(): boolean {
  return !!((process.env.SUPABASE_URL || "").trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
}

let owner: GithubUser | null = null;

export async function startLocal(repo: string, branch: string, user: GithubUser, withCrm = false) {
  owner = user;
  process.env.TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.GITHUB_CLIENT_ID = "local-e2e-unused";
  process.env.GITHUB_CLIENT_SECRET = "local-e2e-unused";
  process.env.ALLOWED_GITHUB_LOGIN = user.login;
  process.env.ALLOWED_GITHUB_ID = String(user.id);
  process.env.HAROLD_REPO = repo;
  process.env.HAROLD_BRANCH = branch;
  if (!withCrm) { process.env.SUPABASE_URL = ""; process.env.SUPABASE_SERVICE_ROLE_KEY = ""; }
  // PUBLIC_BASE_URL must be known before the port is: bind first, then set it.
  process.env.PUBLIC_BASE_URL = "http://localhost:0";
  const { createApp } = await import("../../src/app.js");
  const app = createApp();
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise(r => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  process.env.PUBLIC_BASE_URL = `http://localhost:${port}`;
  return { base: `http://localhost:${port}`, close: () => new Promise<void>(r => server.close(() => r())) };
}

export async function mintAccessToken(ghToken: string): Promise<string> {
  if (!owner) throw new Error("startLocal first");
  const { issueTokens } = await import("../../src/oauth.js");
  const { config } = await import("../../src/config.js");
  return issueTokens(config(), { gh: ghToken, login: owner.login, uid: owner.id, client_id: "local-e2e" }).access_token;
}

export async function connect(base: string, accessToken: string, sdk: "v1" | "v2") {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (sdk === "v1") {
    const c = new ClientV1({ name: "harold-e2e-v1", version: "1.0.0" });
    await c.connect(new TransportV1(new URL(`${base}/mcp`), { requestInit: { headers } }));
    return { call: (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }), list: () => c.listTools(), close: () => c.close(), instructions: () => c.getInstructions() };
  }
  const c = new ClientV2({ name: "harold-e2e-v2", version: "1.0.0" });
  await c.connect(new TransportV2(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return { call: (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }), list: () => c.listTools(), close: () => c.close(), instructions: () => c.getInstructions() };
}

export const textOf = (r: unknown) => ((r as { content?: { text?: string }[] }).content?.[0]?.text ?? "");
export const isErr = (r: unknown) => !!(r as { isError?: boolean }).isError;

let failures = 0;
export function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}
export function done(): never {
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
export const oneLine = (s: string, n = 110) => s.replace(/\s+/g, " ").trim().slice(0, n);
