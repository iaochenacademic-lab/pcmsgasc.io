"use client";
import { useState } from "react";
import { ActionError, useAction } from "./use-action";
import { buttonClass, inputClass, secondaryClass } from "./form-styles";

export interface MeetingFormValues { title: string; location: string; date: string; startTime: string; endTime: string; lateAfterMinutes: number }
export function MeetingForm({ meetingId, initial, disabled = false }: { meetingId?: string; initial?: Partial<MeetingFormValues>; disabled?: boolean }) {
  const action = useAction();
  const [success, setSuccess] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault(); setSuccess("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = { title: String(data.get("title") ?? ""), location: String(data.get("location") ?? ""), date: String(data.get("date") ?? ""), startTime: String(data.get("startTime") ?? ""), endTime: String(data.get("endTime") ?? ""), lateAfterMinutes: Number(data.get("lateAfterMinutes")) };
    const result = await action.run(meetingId ? `/api/teacher/meetings/${meetingId}` : "/api/teacher/meetings", meetingId ? "PATCH" : "POST", meetingId ? { action: "update", ...values } : values);
    if (result?.ok) { setSuccess(meetingId ? "场次信息已更新" : "场次已创建"); if (!meetingId) form.reset(); }
  }}>
    <fieldset disabled={disabled || action.pending} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {([
        ["title", "标题", "text", 60], ["location", "地点（选填）", "text", 60], ["date", "日期", "date", undefined], ["startTime", "开始时间", "time", undefined], ["endTime", "结束时间", "time", undefined], ["lateAfterMinutes", "迟到阈值（分钟）", "number", undefined],
      ] as const).map(([name, label, type, maxLength]) => <label key={name} className="block text-sm font-medium text-slate-700">{label}<input className={inputClass} name={name} type={type} required={name !== "location"} maxLength={maxLength} min={name === "lateAfterMinutes" ? 0 : undefined} max={name === "lateAfterMinutes" ? 120 : undefined} defaultValue={initial?.[name] ?? (name === "lateAfterMinutes" ? 10 : "")} /><span className="mt-1 block text-xs text-rose-700">{action.fieldErrors[name]}</span></label>)}
      <div className="sm:col-span-2 lg:col-span-3"><button type="submit" className={buttonClass}>{action.pending ? "保存中…" : meetingId ? "保存场次" : "新建场次"}</button><p className="mt-2 text-xs text-slate-500">时间按俱乐部时区填写；单场不超过 12 小时，签到窗口于开始前 15 分钟开放。</p></div>
    </fieldset><ActionError error={action.error} />{success && <p role="status" className="mt-3 text-sm font-semibold text-emerald-800">{success}</p>}
  </form>;
}

export function MeetingActions({ meetingId, disabled = false }: { meetingId: string; disabled?: boolean }) {
  const action = useAction();
  return <div><div className="flex flex-wrap gap-2">
    <button className={secondaryClass} disabled={disabled || action.pending} onClick={() => { if (window.confirm("重置后旧签到码立即失效，所有成员的错误次数将清零。确定重置？")) void action.run(`/api/teacher/meetings/${meetingId}`, "PATCH", { action: "regenerate_code" }); }}>{action.pending ? "处理中…" : "重置签到码"}</button>
    <button className={secondaryClass + " text-rose-700"} disabled={disabled || action.pending} onClick={() => { if (window.confirm("取消场次后不能签到，待审批请假也会取消。确定继续？")) void action.run(`/api/teacher/meetings/${meetingId}`, "PATCH", { action: "cancel" }); }}>取消场次</button>
    </div>{disabled && <p className="mt-2 text-xs text-slate-500">场次已结束或取消，不能再重置签到码或取消。</p>}<ActionError error={action.error} /></div>;
}

export function ReviewLeave({ leaveId }: { leaveId: string }) {
  const action = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  return <div className="min-w-52"><div className="flex gap-2"><button className={buttonClass} disabled={action.pending} onClick={() => void action.run(`/api/teacher/leave-requests/${leaveId}/review`, "POST", { decision: "approved" })}>{action.pending ? "审批中…" : "批准"}</button><button className={secondaryClass} disabled={action.pending} onClick={() => setRejecting(!rejecting)}>驳回</button></div>
    {rejecting && <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void action.run(`/api/teacher/leave-requests/${leaveId}/review`, "POST", { decision: "rejected", comment }); }}><label className="block text-sm text-slate-700">驳回意见<textarea className={inputClass} required maxLength={200} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} /></label><p className="text-xs text-rose-700">{action.fieldErrors.comment}</p><button className={secondaryClass + " mt-2"} type="submit" disabled={!comment.trim() || action.pending}>确认驳回</button></form>}<ActionError error={action.error} />
  </div>;
}

export function AttendanceEditor({ meetingId, userId, currentStatus, initialNote = "", disabled = false }: { meetingId: string; userId: string; currentStatus: string; initialNote?: string; disabled?: boolean }) {
  const action = useAction();
  const [status, setStatus] = useState(currentStatus === "pending" ? "auto" : currentStatus);
  const [note, setNote] = useState(initialNote);
  return <form className="min-w-52" onSubmit={(event) => { event.preventDefault(); if (status === "auto" && !window.confirm("恢复自动会删除当前登记，不会恢复已被覆盖的原签到；状态将按请假和场次时间重新计算。确定继续？")) return; void action.run(`/api/teacher/meetings/${meetingId}/attendance/${userId}`, "PUT", { status: status === "auto" ? null : status, note }); }}>
    <fieldset disabled={disabled || action.pending}><label className="block text-xs font-medium text-slate-600">修改出勤状态<select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="present">已到</option><option value="late">迟到</option><option value="excused">请假</option><option value="absent">缺勤</option><option value="auto">恢复自动</option></select></label>
      <label className="mt-2 block text-xs font-medium text-slate-600">登记备注<input className={inputClass} maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} /></label><p className="text-xs text-rose-700">{action.fieldErrors.note ?? action.fieldErrors.status}</p><button type="submit" className={secondaryClass + " mt-2"}>{action.pending ? "保存中…" : "保存登记"}</button></fieldset><ActionError error={action.error} />
  </form>;
}
