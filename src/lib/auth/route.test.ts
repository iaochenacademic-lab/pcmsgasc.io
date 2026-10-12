import { Buffer } from "node:buffer";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as expireSession } from "@/app/auth/expired/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { nextLoginFailureState } from "@/lib/auth/lockout";
import type { Database } from "@/lib/supabase/database.types";
import type { UserDatabaseRow } from "@/lib/auth/user-repository";
import type { SessionPayload } from "@/lib/auth/types";
import { proxy } from "../../../proxy";

const adminMock = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: adminMock.createAdminClient,
}));

const TEST_SECRET = Buffer.alloc(32, 11).toString("base64url");
const CURRENT_PASSWORD = "correct horse battery staple";

function makeDatabaseClient(initialUser: UserDatabaseRow | null) {
  let storedUser = initialUser ? { ...initialUser } : null;

  const client = {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => ({
            data:
              storedUser && storedUser[column as keyof UserDatabaseRow] === value
                ? { ...storedUser }
                : null,
            error: null,
          }),
        }),
      }),
      update: (values: Partial<UserDatabaseRow>) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            maybeSingle: async () => {
              if (!storedUser || storedUser[column as keyof UserDatabaseRow] !== value) {
                return { data: null, error: null };
              }
              storedUser = { ...storedUser, ...values };
              return { data: { id: storedUser.id }, error: null };
            },
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: { p_user_id: string; p_password_hash?: string; p_expected_session_version?: number }) => {
      if (name === "reset_login_failures") {
        if (!storedUser || storedUser.id !== args.p_user_id || !storedUser.is_active ||
            (storedUser.locked_until && new Date(storedUser.locked_until) > new Date())) {
          return { data: false, error: null };
        }
        storedUser = { ...storedUser, failed_login_count: 0, locked_until: null };
        return { data: true, error: null };
      }
      if (name === "change_user_password") {
        if (!storedUser || storedUser.id !== args.p_user_id || !storedUser.is_active ||
            storedUser.session_version !== args.p_expected_session_version) {
          return { data: null, error: null };
        }
        storedUser = { ...storedUser, password_hash: args.p_password_hash!,
          must_change_password: false, session_version: storedUser.session_version + 1,
          failed_login_count: 0, locked_until: null };
        return { data: storedUser.session_version, error: null };
      }
      if (!storedUser || storedUser.id !== args.p_user_id) {
        return { data: [], error: null };
      }
      const state = nextLoginFailureState(
        {
          failedLoginCount: storedUser.failed_login_count,
          lockedUntil: storedUser.locked_until,
        },
        new Date(),
      );
      storedUser = {
        ...storedUser,
        failed_login_count: state.failedLoginCount,
        locked_until: state.lockedUntil,
      };
      return {
        data: [
          {
            failed_login_count: state.failedLoginCount,
            locked_until: state.lockedUntil,
          },
        ],
        error: null,
      };
    },
  };

  return {
    client: client as unknown as import("@supabase/supabase-js").SupabaseClient<Database>,
    get user() {
      return storedUser;
    },
  };
}

async function makeUser(overrides: Partial<UserDatabaseRow> = {}): Promise<UserDatabaseRow> {
  return {
    id: "2a24a37e-843e-470e-8d93-8bb171d91c44",
    username: "teacher-one",
    password_hash: await hashPassword(CURRENT_PASSWORD),
    role: "teacher",
    name: "Teacher One",
    must_change_password: true,
    failed_login_count: 0,
    locked_until: null,
    session_version: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function session(role: SessionPayload["role"], mustChangePassword = false): SessionPayload {
  return {
    userId: "2a24a37e-843e-470e-8d93-8bb171d91c44",
    username: "club-user",
    role,
    name: "Club User",
    mustChangePassword,
    sessionVersion: 1,
  };
}

function cookieRequest(path: string, token: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

describe("auth route handlers and proxy", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    adminMock.createAdminClient.mockReset();
  });

  it("sets an encrypted secure session cookie and routes the first login to password change", async () => {
    const memory = makeDatabaseClient(await makeUser());
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: " TEACHER-ONE ", password: CURRENT_PASSWORD }),
      }),
    );
    const body = await response.json();
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, redirectTo: "/change-password" });
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(2_592_000);
    await expect(readSessionToken(cookie!.value)).resolves.toMatchObject({
      username: "teacher-one",
      role: "teacher",
      mustChangePassword: true,
    });
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain(CURRENT_PASSWORD);
  });

  it("returns a generic login failure without issuing a cookie or exposing credentials", async () => {
    const memory = makeDatabaseClient(null);
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "missing-user", password: "incorrect-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain("incorrect-password");
    expect(body.error).toBeTruthy();
  });

  it("expires the session cookie on logout", async () => {
    const response = await logout();
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(response.status).toBe(200);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("verifies the current password, persists a new hash, and rotates the session", async () => {
    const memory = makeDatabaseClient(await makeUser());
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const originalToken = await createSessionToken(session("teacher", true));
    const response = await changePassword(
      new NextRequest("http://localhost/api/auth/change-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          cookie: `${SESSION_COOKIE_NAME}=${originalToken}`,
        },
        body: JSON.stringify({
          currentPassword: CURRENT_PASSWORD,
          newPassword: "a-new-strong-password",
        }),
      }),
    );
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    const changedSession = await readSessionToken(cookie!.value);

    expect(response.status).toBe(200);
    expect(changedSession).toMatchObject({ role: "teacher", mustChangePassword: false, sessionVersion: 2 });
    expect(memory.user?.must_change_password).toBe(false);
    expect(memory.user?.password_hash).not.toBe(await hashPassword(CURRENT_PASSWORD));
  });

  it("clears invalid session cookies and redirects protected pages to login", async () => {
    const response = await proxy(cookieRequest("/teacher", "not-a-valid-token"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("leaves protected-page role authorization to database-backed guards", async () => {
    const token = await createSessionToken(session("member"));
    const response = await proxy(cookieRequest("/teacher", token));

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.secure).toBe(true);
  });

  it("leaves password-change authorization to database-backed guards", async () => {
    const token = await createSessionToken(session("teacher", true));
    const response = await proxy(cookieRequest("/teacher", token));

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("refreshes a valid protected session cookie for another 30 days", async () => {
    const token = await createSessionToken(session("teacher"));
    const response = await proxy(cookieRequest("/teacher", token));
    const refreshedToken = response.cookies.get(SESSION_COOKIE_NAME)?.value;
    const refreshedSession = await readSessionToken(refreshedToken!);

    expect(response.status).toBe(200);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(2_592_000);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.secure).toBe(true);
    expect(refreshedSession).toMatchObject({ role: "teacher", username: "club-user" });
  });
});

describe("password-change session hardening", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    adminMock.createAdminClient.mockReset();
  });

  async function passwordRequest(
    token: string,
    body = JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: "a-new-strong-password" }),
    origin: string | null = "http://localhost",
  ) {
    return new NextRequest("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin === null ? {} : { origin }),
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body,
    });
  }

  it.each([
    ["malformed JSON", "{"],
    ["missing password fields", "{}"],
    ["invalid current password", JSON.stringify({ currentPassword: "incorrect-current-password", newPassword: "a-new-strong-password" })],
    ["invalid new password", JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: "short" })],
  ])("renews a valid session on %s", async (_label, body) => {
    const memory = makeDatabaseClient(await makeUser());
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const token = await createSessionToken(session("teacher", true));
    const response = await changePassword(await passwordRequest(token, body));
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cookie?.maxAge).toBe(2_592_000);
    expect(await readSessionToken(cookie!.value)).toMatchObject({ sessionVersion: 1 });
    expect(memory.user?.session_version).toBe(1);
  });

  it("ignores client-supplied user identity and session version when changing a password", async () => {
    const memory = makeDatabaseClient(await makeUser());
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const token = await createSessionToken(session("teacher", true));
    const response = await changePassword(await passwordRequest(token, JSON.stringify({
      userId: "53fd8fa6-9515-4fbe-804a-0b2091499cbb",
      sessionVersion: 999,
      currentPassword: CURRENT_PASSWORD,
      newPassword: "a-new-strong-password",
    })));

    expect(response.status).toBe(200);
    expect(memory.user?.id).toBe(session("teacher").userId);
    expect(memory.user?.session_version).toBe(2);
    expect(memory.user?.must_change_password).toBe(false);
    const renewed = await readSessionToken(response.cookies.get(SESSION_COOKIE_NAME)!.value);
    expect(renewed).toMatchObject({
      userId: session("teacher").userId,
      sessionVersion: 2,
    });
  });

  it("returns an uncached generic failure if session decoding cannot be configured", async () => {
    delete process.env.SESSION_SECRET;
    const response = await changePassword(await passwordRequest("test-token"));

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "暂时无法修改密码，请稍后重试" });
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("renews the session on a database failure without exposing details", async () => {
    adminMock.createAdminClient.mockImplementation(() => {
      throw new Error("private database failure");
    });
    const token = await createSessionToken(session("teacher", true));
    const response = await changePassword(await passwordRequest(token));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(2_592_000);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });

  it.each([null, "https://foreign.example"])("rejects origin %s before touching the database", async (origin) => {
    const token = await createSessionToken(session("teacher", true));
    const response = await changePassword(await passwordRequest(token, "{}", origin));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(2_592_000);
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    { session_version: 2 },
    { is_active: false },
  ])("clears revoked or disabled sessions before any password mutation", async (overrides) => {
    const memory = makeDatabaseClient(await makeUser(overrides));
    adminMock.createAdminClient.mockReturnValue(memory.client);
    const token = await createSessionToken(session("teacher", true));
    const response = await changePassword(await passwordRequest(token));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
    expect(memory.user?.must_change_password).toBe(true);
  });

  it("clears an invalid cookie on a same-origin unauthenticated request", async () => {
    const response = await changePassword(await passwordRequest("invalid-token"));
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
    expect(adminMock.createAdminClient).not.toHaveBeenCalled();
  });

  it("clears the cookie and uses a 302 expiry redirect without a proxy loop", async () => {
    const token = await createSessionToken(session("teacher", true));
    const request = cookieRequest("/auth/expired", token);
    const proxyResponse = await proxy(request);
    expect(proxyResponse.status).toBe(200);
    expect(proxyResponse.headers.has("location")).toBe(false);
    expect(proxyResponse.headers.has("set-cookie")).toBe(false);

    const response = await expireSession(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/login?reason=expired");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("routes a logged-in login visit through the database-backed home page", async () => {
    const token = await createSessionToken(session("member", true));
    const response = await proxy(cookieRequest("/login", token));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });
});
