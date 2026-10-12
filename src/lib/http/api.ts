import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionFromRequest } from "@/lib/auth/cookies";
import { currentUserSession, loadValidUser } from "@/lib/auth/current-user";
import type { SessionPayload, UserRole } from "@/lib/auth/types";
import { createSupabaseUserRepository } from "@/lib/auth/user-repository";
import { createAdminClient } from "@/lib/supabase/admin";

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function assertJsonSameOrigin(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (
    contentType !== "application/json" ||
    request.headers.get("origin") !== request.nextUrl.origin
  ) {
    return jsonResponse({ ok: false, reason: "forbidden", error: "请求来源或格式不正确，请刷新页面后重试" }, 403);
  }

  return null;
}

interface ApiContext<Params> {
  params: Params;
}

export function withApi<Params extends Record<string, string> = Record<string, string>>(
  role: UserRole,
  handler: (
    request: NextRequest,
    actor: SessionPayload,
    context: ApiContext<Params>,
  ) => Promise<NextResponse>,
) {
  return async (
    request: NextRequest,
    context: { params: Promise<Params> },
  ): Promise<NextResponse> => {
    const originError = assertJsonSameOrigin(request);
    if (originError) return originError;

    try {
      const session = await getSessionFromRequest(request);
      const user = session
        ? await loadValidUser(session, createSupabaseUserRepository(createAdminClient()))
        : null;
      if (!user) {
        const response = jsonResponse({
          ok: false, reason: "session_expired", error: "登录已失效，请重新登录",
        }, 401);
        clearSessionCookie(response);
        return response;
      }
      if (user.mustChangePassword || user.role !== role) {
        return jsonResponse({
          ok: false, reason: "forbidden",
          error: user.mustChangePassword ? "请先修改初始密码" : "没有权限执行此操作",
        }, 403);
      }

      const response = await handler(request, currentUserSession(user), {
        params: await context.params,
      });
      response.headers.set("Cache-Control", "no-store");
      if (response.status === 401) clearSessionCookie(response);
      return response;
    } catch {
      return jsonResponse({
        ok: false, reason: "server_error", error: "操作失败，请稍后重试",
      }, 500);
    }
  };
}

export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
