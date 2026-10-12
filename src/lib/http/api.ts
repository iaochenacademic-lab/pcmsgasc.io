import "server-only";
import { NextRequest, NextResponse } from "next/server";

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
    return jsonResponse({ error: "请求来源或格式不正确，请刷新页面后重试" }, 403);
  }

  return null;
}
