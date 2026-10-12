"use client";
import { useRef, useState } from "react";
import { ActionError, useAction } from "./use-action";
import { buttonClass, inputClass, secondaryClass } from "./form-styles";

export function CheckInForm({ meetingId }: { meetingId: string }) {
  const [digits, setDigits] = useState(Array<string>(6).fill(""));
  const [result, setResult] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const action = useAction();
  return <form onSubmit={async (event) => {
    event.preventDefault(); setResult("");
    const data = await action.run("/api/member/check-in", "POST", { meetingId, code: digits.join("") });
    if (typeof data?.remainingAttempts === "number") setRemaining(data.remainingAttempts);
    if (data?.ok) setResult(data.status === "late" ? "签到成功：迟到" : "签到成功：已到");
  }}>
    <fieldset disabled={action.pending || remaining === 0 || !!result}><legend className="mb-3 text-sm font-medium text-slate-700">输入老师展示的 6 位签到码</legend>
      <div className="flex gap-2">{digits.map((digit, index) => <input key={index} ref={(node) => { refs.current[index] = node; }} aria-label={`签到码第${index + 1}位`} type="text" inputMode="numeric" autoComplete="off" maxLength={1} pattern="[0-9]" required value={digit}
        className="h-12 w-10 min-w-0 rounded-xl border border-slate-300 bg-white text-center font-mono text-xl font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 sm:h-14 sm:w-12"
        onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(-1); setDigits(digits.map((old, at) => at === index ? value : old)); if (value) refs.current[Math.min(index + 1, 5)]?.focus(); }}
        onKeyDown={(event) => { if (event.key === "Backspace" && !digit && index > 0) refs.current[index - 1]?.focus(); if (event.key === "ArrowLeft") refs.current[Math.max(0, index - 1)]?.focus(); if (event.key === "ArrowRight") refs.current[Math.min(5, index + 1)]?.focus(); }}
        onPaste={(event) => { event.preventDefault(); const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6); setDigits(Array.from({ length: 6 }, (_, at) => pasted[at] ?? "")); refs.current[Math.min(pasted.length, 5)]?.focus(); }} />)}</div>
      <button className={buttonClass + " mt-4 w-full sm:w-auto"} type="submit" disabled={digits.some((digit) => !digit)}>{action.pending ? "签到中…" : "确认签到"}</button>
    </fieldset>
    {action.fieldErrors.code && <p className="mt-2 text-sm text-rose-700">{action.fieldErrors.code}</p>}
    <ActionError error={action.error} />
    {remaining === 0 && <button type="button" className={secondaryClass + " mt-3"} onClick={() => window.location.reload()}>老师重置后，刷新页面重试</button>}
    {remaining !== null && remaining > 0 && !result && <p className="mt-2 text-sm text-slate-600">还可尝试 {remaining} 次</p>}
    {result && <p role="status" className="mt-3 font-semibold text-emerald-800">{result}</p>}
  </form>;
}

export function LeaveForm({ meetingId, lateSubmission = false }: { meetingId: string; lateSubmission?: boolean }) {
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("personal");
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState(false);
  const action = useAction();
  if (success) return <p role="status" className="text-sm font-medium text-sky-800">申请已提交，等待老师审批。</p>;
  if (!open) return <button type="button" className={secondaryClass} onClick={() => setOpen(true)}>请假</button>;
  return <form className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={async (event) => { event.preventDefault(); const data = await action.run("/api/member/leave-requests", "POST", { meetingId, leaveType, reason }); if (data?.ok) setSuccess(true); }}>
    <fieldset disabled={action.pending}><legend className="text-sm font-semibold text-slate-800">请假类型</legend>
      <div className="mt-2 flex flex-wrap gap-2">{[["personal", "事假"], ["sick", "病假"], ["official", "公假"]].map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${leaveType === value ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-300 bg-white text-slate-700"}`}><input type="radio" name={"leave-type-" + meetingId} value={value} checked={leaveType === value} onChange={() => setLeaveType(value)} />{label}</label>)}</div>
      <label className="mt-3 block text-sm font-medium text-slate-700">请假理由<textarea className={inputClass} required maxLength={200} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="mt-1 flex justify-between gap-3 text-xs"><span className="text-rose-700">{action.fieldErrors.reason}</span><span className="text-slate-500">{Array.from(reason).length}/200</span></div>
      {action.fieldErrors.leaveType && <p className="text-sm text-rose-700">{action.fieldErrors.leaveType}</p>}
      {lateSubmission && <p className="mt-2 text-sm text-amber-900">场次已开始，本次申请将标记为补交。</p>}
      <div className="mt-3 flex gap-2"><button className={buttonClass} type="submit">{action.pending ? "提交中…" : "提交申请"}</button><button className={secondaryClass} type="button" onClick={() => setOpen(false)}>收起</button></div>
    </fieldset><ActionError error={action.error} />
  </form>;
}

export function CancelLeaveButton({ leaveId }: { leaveId: string }) {
  const action = useAction();
  return <div><button className={secondaryClass} disabled={action.pending} onClick={() => { if (window.confirm("确定撤回这份待审批的请假申请？")) void action.run(`/api/member/leave-requests/${leaveId}/cancel`, "POST", {}); }}>{action.pending ? "撤回中…" : "撤回"}</button><ActionError error={action.error} /></div>;
}
