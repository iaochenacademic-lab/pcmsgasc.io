import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeUserPassword } from "@/lib/auth/service";
import { clearSessionCookie, getSessionFromRequest, setSessionCookie } from "@/lib/auth/cookies";
import { createSupabaseUserRepository } from "@/lib/auth/user-repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    const response = NextResponse.json(
      { error: "请重新登录后再修改密码" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
    clearSessionCookie(response);
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请填写当前密码和符合要求的新密码" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).currentPassword !== "string" ||
    typeof (body as Record<string, unknown>).newPassword !== "string"
  ) {
    return NextResponse.json(
      { error: "请填写当前密码和符合要求的新密码" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const values = body as { currentPassword: string; newPassword: string };
  try {
    const repository = createSupabaseUserRepository(createAdminClient());
    const result = await changeUserPassword(
      { userId: session.userId, ...values },
      { repository },
    );

    if (!result.ok) {
      if (result.reason === "user_not_found") {
        const response = NextResponse.json(
          { error: "请重新登录后再修改密码" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
        clearSessionCookie(response);
        return response;
      }

      return NextResponse.json(
        {
          error:
            result.reason === "invalid_current_password"
              ? "当前密码不正确"
              : "新密码至少需要 12 个字符，且最多为 72 字节，并且不能与当前密码相同",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json(
      {
        ok: true,
        redirectTo: result.session.role === "teacher" ? "/teacher" : "/member",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    await setSessionCookie(response, result.session);
    return response;
  } catch {
    return NextResponse.json(
      { error: "暂时无法修改密码，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
