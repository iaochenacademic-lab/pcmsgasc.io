import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

describe("expired login notice", () => {
  it("shows the expiration reason from the login URL", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ reason: "expired" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("登录已失效，请重新登录");
  });

  it("does not show an expiry notice for a normal login", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("登录已失效，请重新登录")).not.toBeInTheDocument();
  });
});
