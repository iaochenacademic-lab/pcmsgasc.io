import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { readSessionToken } from "@/lib/auth/session";

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const destination = request.nextUrl.clone();
  destination.pathname = pathname;
  destination.search = "";
  return NextResponse.redirect(destination);
}

function unauthenticatedApiResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, reason: "session_expired", error: "登录已失效，请重新登录" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/auth/") || pathname === "/auth/expired") {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    if (pathname === "/login") {
      return NextResponse.next();
    }
    return isApi ? unauthenticatedApiResponse() : redirectTo(request, "/login");
  }

  const session = await readSessionToken(token);
  if (!session) {
    const response =
      pathname === "/login"
        ? NextResponse.next()
        : isApi
          ? unauthenticatedApiResponse()
          : redirectTo(request, "/login");
    clearSessionCookie(response);
    return response;
  }

  // Database-backed page guards and API wrappers own authorization. A stale
  // cookie's role or password-change flag must not cause redirect loops.
  const response = pathname === "/login"
    ? redirectTo(request, "/")
    : NextResponse.next();
  await setSessionCookie(response, session);
  return response;
}

export const config = {
  matcher: ["/", "/login", "/auth/expired", "/teacher/:path*", "/member/:path*", "/change-password", "/api/:path*"],
};
