import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateUser } from "@/lib/auth/service";
import { setSessionCookie } from "@/lib/auth/cookies";
import { parseLoginInput } from "@/lib/auth/validation";
import { createSupabaseUserRepository } from "@/lib/auth/user-repository";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "用户名或密码错误" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = parseLoginInput(body);
  if (!input) {
    return NextResponse.json(
      { error: "用户名或密码错误" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const repository = createSupabaseUserRepository(createAdminClient());
    const result = await authenticateUser(input, { repository });
    if (!result.ok) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const redirectTo = result.session.mustChangePassword
      ? "/change-password"
      : result.session.role === "teacher"
        ? "/teacher"
        : "/member";
    const response = NextResponse.json(
      { ok: true, redirectTo },
      { headers: { "Cache-Control": "no-store" } },
    );
    await setSessionCookie(response, result.session);
    return response;
  } catch {
    return NextResponse.json(
      { error: "暂时无法登录，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
