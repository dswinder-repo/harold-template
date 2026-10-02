import { randomBytes } from "node:crypto";

// Fictional owner and repository: no real account, id or deployment appears in the tests.
export const OWNER = { login: "example-owner", id: 10000001 };
export const STRANGER = { login: "someone-else", id: 1234567 };
export const REPO = "example/harold";

export function setTestEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    TOKEN_KEY: randomBytes(32).toString("hex"),
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret-value",
    ALLOWED_GITHUB_LOGIN: OWNER.login,
    ALLOWED_GITHUB_ID: String(OWNER.id),
    ALLOWED_REDIRECT_HOSTS: "claude.ai,claude.com",
    HAROLD_REPO: REPO,
    HAROLD_BRANCH: "main",
    HAROLD_TZ: "",
    HAROLD_NO_LOG_TYPES: "",
    HAROLD_COMMIT_EMAIL: "",
    PUBLIC_BASE_URL: "https://harold-connector.example.com",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    ...extra,
  });
}
