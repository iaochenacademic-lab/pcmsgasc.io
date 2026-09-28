import { Buffer } from "node:buffer";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
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
    rpc: async (_name: string, args: { p_user_id: string }) => {
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
    expect(changedSession).toMatchObject({ role: "teacher", mustChangePassword: false });
    expect(memory.user?.must_change_password).toBe(false);
    expect(memory.user?.password_hash).not.toBe(await hashPassword(CURRENT_PASSWORD));
  });

  it("clears invalid session cookies and redirects protected pages to login", async () => {
    const response = await proxy(cookieRequest("/teacher", "not-a-valid-token"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("redirects a user with the wrong role to their own role home", async () => {
    const token = await createSessionToken(session("member"));
    const response = await proxy(cookieRequest("/teacher", token));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/member");
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.secure).toBe(true);
  });

  it("forces an initial-login session to the password-change page", async () => {
    const token = await createSessionToken(session("teacher", true));
    const response = await proxy(cookieRequest("/teacher", token));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/change-password");
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
