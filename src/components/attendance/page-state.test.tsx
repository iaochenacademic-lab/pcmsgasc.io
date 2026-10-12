import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeacherLoading from "@/app/teacher/loading";
import MemberLoading from "@/app/member/loading";
import TeacherError from "@/app/teacher/error";
import MemberError from "@/app/member/error";

afterEach(cleanup);

describe("dashboard loading and failure states", () => {
  it.each([
    ["老师后台", TeacherLoading],
    ["成员首页", MemberLoading],
  ] as const)("announces %s loading to assistive technology", (title, Component) => {
    render(<Component />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在载入签到与请假资料");
  });

  it.each([
    ["老师后台", TeacherError],
    ["成员首页", MemberError],
  ] as const)("provides a retry for %s without exposing internal errors", (title, Component) => {
    const reset = vi.fn();
    render(<Component error={new Error("private server detail")} reset={reset} />);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法加载页面");
    expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
