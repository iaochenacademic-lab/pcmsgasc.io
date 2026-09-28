import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/login/login-form";
import { ChangePasswordForm } from "@/app/change-password/change-password-form";
import { EmptyDashboard } from "@/components/empty-dashboard";
import { LogoutButton } from "@/components/logout-button";

const navigationMock = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMock.replace }),
}));

describe("club authentication UI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders username/password login without a registration link", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("用户名")).toHaveAttribute("name", "username");
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("link", { name: /注册/ })).not.toBeInTheDocument();
    expect(screen.getByText(/首次登录后需要修改密码/)).toBeInTheDocument();
  });

  it("shows distinct empty dashboard titles for teachers and members", () => {
    const { rerender } = render(<EmptyDashboard role="teacher" name="Teacher One" />);
    expect(screen.getByRole("heading", { name: "老师后台" })).toBeInTheDocument();
    expect(screen.getByText("Teacher One")).toBeInTheDocument();

    rerender(<EmptyDashboard role="member" name="Member One" />);
    expect(screen.getByRole("heading", { name: "成员首页" })).toBeInTheDocument();
    expect(screen.getByText("Member One")).toBeInTheDocument();
  });

  it("posts logout to the server and returns to the login page", async () => {
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
      expect(navigationMock.replace).toHaveBeenCalledWith("/login");
    });
  });

  it("renders current, new, and confirmation password fields", () => {
    render(<ChangePasswordForm name="Sample Member" />);

    expect(screen.getByLabelText("当前密码")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("新密码")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("确认新密码")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("新密码")).toHaveAttribute("minLength", "12");
  });
});
