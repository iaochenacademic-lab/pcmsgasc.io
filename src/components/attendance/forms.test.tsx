import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInForm, LeaveForm } from "./member-forms";
import { ReviewLeave, AttendanceEditor } from "./teacher-forms";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, status: "present" }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("attendance interactions", () => {
  it("pastes all six digits, submits once and refreshes after check-in", async () => {
    render(<CheckInForm meetingId="meeting-one" />);
    fireEvent.paste(screen.getByLabelText("签到码第1位"), { clipboardData: { getData: () => "123456" } });
    expect(screen.getByLabelText("签到码第6位")).toHaveValue("6");
    fireEvent.click(screen.getByRole("button", { name: "确认签到" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/member/check-in", expect.objectContaining({ body: JSON.stringify({ meetingId: "meeting-one", code: "123456" }) })));
    expect(await screen.findByText("签到成功：已到")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });
  it("shows the server's remaining attempts and stops submitting at zero", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, json: async () => ({ ok: false, error: "次数用尽，请联系老师", remainingAttempts: 0 }) } as Response);
    render(<CheckInForm meetingId="meeting-one" />);
    fireEvent.paste(screen.getByLabelText("签到码第1位"), { clipboardData: { getData: () => "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "确认签到" }));
    expect(await screen.findByText("次数用尽，请联系老师")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认签到" })).toBeDisabled();
  });
  it("submits a typed leave request and displays field validation errors", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, error: "请检查填写内容", fieldErrors: { reason: "请填写请假理由" } }) } as Response);
    render(<LeaveForm meetingId="meeting-one" lateSubmission />);
    fireEvent.click(screen.getByRole("button", { name: "请假" }));
    expect(screen.getByText(/场次已开始/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("病假"));
    fireEvent.change(screen.getByLabelText("请假理由"), { target: { value: "看诊" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));
    expect(await screen.findByText("请填写请假理由")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/member/leave-requests", expect.objectContaining({ body: JSON.stringify({ meetingId: "meeting-one", leaveType: "sick", reason: "看诊" }) }));
  });
  it("requires a review comment before rejecting and sends the decision", async () => {
    render(<ReviewLeave leaveId="leave-one" />);
    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    expect(screen.getByRole("button", { name: "确认驳回" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("驳回意见"), { target: { value: "请补充说明" } });
    fireEvent.click(screen.getByRole("button", { name: "确认驳回" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/teacher/leave-requests/leave-one/review", expect.objectContaining({ body: JSON.stringify({ decision: "rejected", comment: "请补充说明" }) })));
  });
  it("restores automatic attendance only after confirmation and retains the note", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AttendanceEditor meetingId="meeting-one" userId="member-one" currentStatus="present" />);
    fireEvent.change(screen.getByLabelText("修改出勤状态"), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("登记备注"), { target: { value: "重新核对" } });
    fireEvent.click(screen.getByRole("button", { name: "保存登记" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/teacher/meetings/meeting-one/attendance/member-one", expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: null, note: "重新核对" }) })));
    expect(window.confirm).toHaveBeenCalled();
  });
});
