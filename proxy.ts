import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { readSessionToken } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/types";

function isRolePath(pathname: string, role: "teacher" | "member"): boolean {
  return pathname === `/${role}` || pathname.startsWith(`/${role}/`);
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const destination = request.nextUrl.clone();
  destination.pathname = pathname;
  destination.search = "";
  return NextResponse.redirect(destination);
}

function unauthenticatedApiResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function roleHome(session: SessionPayload): "/teacher" | "/member" {
  return session.role === "teacher" ? "/teacher" : "/member";
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/auth/")) {
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

  let destination: string | null = null;
  if (session.mustChangePassword && pathname !== "/change-password") {
    destination = "/change-password";
  } else if (pathname === "/" || pathname === "/login") {
    destination = roleHome(session);
  } else if (isRolePath(pathname, "teacher") && session.role !== "teacher") {
    destination = roleHome(session);
  } else if (isRolePath(pathname, "member") && session.role !== "member") {
    destination = roleHome(session);
  } else if (isApi && pathname.startsWith("/api/teacher/") && session.role !== "teacher") {
    destination = roleHome(session);
  } else if (isApi && pathname.startsWith("/api/member/") && session.role !== "member") {
    destination = roleHome(session);
  }

  let response: NextResponse;
  if (destination && isApi) {
    response = NextResponse.json(
      { error: "Forbidden", redirectTo: destination },
      { status: 403 },
    );
  } else if (destination) {
    response = redirectTo(request, destination);
  } else {
    response = NextResponse.next();
  }

  await setSessionCookie(response, session);
  return response;
}

export const config = {
  matcher: ["/", "/login", "/teacher/:path*", "/member/:path*", "/change-password", "/api/:path*"],
};
