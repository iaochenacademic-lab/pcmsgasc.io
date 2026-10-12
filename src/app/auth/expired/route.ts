import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const destination = new URL("/login?reason=expired", request.nextUrl.origin);
  const response = NextResponse.redirect(destination, 302);
  response.headers.set("Cache-Control", "no-store");
  clearSessionCookie(response);
  return response;
}
