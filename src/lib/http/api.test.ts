import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { assertJsonSameOrigin, jsonResponse } from "@/lib/http/api";

function request(headers: Record<string, string>) {
  return new NextRequest("https://club.example/api/action", { method: "POST", headers });
}

describe("JSON API request boundaries", () => {
  it.each<Record<string, string>>([
    { "content-type": "application/json" },
    { "content-type": "application/json", origin: "https://other.example" },
    { "content-type": "application/json", origin: "null" },
    { "content-type": "text/plain", origin: "https://club.example" },
    { "content-type": "application/json-patch+json", origin: "https://club.example" },
    { origin: "https://club.example" },
  ])("rejects an absent or foreign origin and non-JSON content", (headers) => {
    const response = assertJsonSameOrigin(request(headers));
    expect(response?.status).toBe(403);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts same-origin JSON with a charset parameter", () => {
    expect(assertJsonSameOrigin(request({
      origin: "https://club.example",
      "content-type": "application/json; charset=utf-8",
    }))).toBeNull();
  });

  it("sets no-store for success and error responses", async () => {
    for (const status of [200, 400, 401, 403, 500]) {
      const response = jsonResponse({ message: "test" }, status);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ message: "test" });
    }
  });
});
