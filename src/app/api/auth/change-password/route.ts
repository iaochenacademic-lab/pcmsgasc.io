import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeUserPassword } from "@/lib/auth/service";
import { clearSessionCookie, getSessionFromRequest, setSessionCookie } from "@/lib/auth/cookies";
import { currentUserSession, loadValidUser } from "@/lib/auth/current-user";
import { createSupabaseUserRepository } from "@/lib/auth/user-repository";
import type { SessionPayload } from "@/lib/auth/types";
import { assertJsonSameOrigin, jsonResponse } from "@/lib/http/api";

export const runtime = "nodejs";

function expiredResponse(): NextResponse {
  const response = jsonResponse({ error: "请重新登录后再修改密码" }, 401);
  clearSessionCookie(response);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = assertJsonSameOrigin(request);
  let session: SessionPayload | null;
  try {
    session = await getSessionFromRequest(request);
  } catch {
    return jsonResponse({ error: "暂时无法修改密码，请稍后重试" }, 500);
  }
  async function respond(response: NextResponse): Promise<NextResponse> {
    if (session) {
      await setSessionCookie(response, session);
    }
    return response;
  }

  // Rejected origins never access the database; only an already encrypted cookie
  // can be renewed here, without granting authorization or changing user data.
  if (originError) {
    return respond(originError);
  }
  if (!session) {
    return expiredResponse();
  }

  try {
    const repository = createSupabaseUserRepository(createAdminClient());
    const user = await loadValidUser(session, repository);
    if (!user) {
      return expiredResponse();
    }

    Object.assign(session, currentUserSession(user));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond(jsonResponse({ error: "请填写当前密码和符合要求的新密码" }, 400));
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).currentPassword !== "string" ||
      typeof (body as Record<string, unknown>).newPassword !== "string"
    ) {
      return respond(jsonResponse({ error: "请填写当前密码和符合要求的新密码" }, 400));
    }

    const values = body as { currentPassword: string; newPassword: string };
    const result = await changeUserPassword(
      {
        userId: session.userId,
        sessionVersion: session.sessionVersion,
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      { repository },
    );

    if (!result.ok) {
      if (result.reason === "user_not_found") {
        return expiredResponse();
      }

      return respond(jsonResponse({
        error: result.reason === "invalid_current_password"
          ? "当前密码不正确"
          : "新密码至少需要 12 个字符，且最多为 72 字节，并且不能与当前密码相同",
      }, 400));
    }

    const response = jsonResponse({
      ok: true,
      redirectTo: result.session.role === "teacher" ? "/teacher" : "/member",
    });
    await setSessionCookie(response, result.session);
    return response;
  } catch {
    return respond(jsonResponse({ error: "暂时无法修改密码，请稍后重试" }, 500));
  }
}
