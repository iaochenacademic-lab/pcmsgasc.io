const styles: Record<string, [string, string]> = {
  present: ["已到", "bg-emerald-50 text-emerald-800 ring-emerald-200"],
  late: ["迟到", "bg-amber-50 text-amber-900 ring-amber-200"],
  excused: ["请假", "bg-sky-50 text-sky-800 ring-sky-200"],
  absent: ["缺勤", "bg-rose-50 text-rose-800 ring-rose-200"],
  pending: ["未签到", "bg-slate-100 text-slate-700 ring-slate-200"],
  leave_pending: ["待审批", "bg-violet-50 text-violet-800 ring-violet-200"],
  approved: ["已批准", "bg-sky-50 text-sky-800 ring-sky-200"],
  rejected: ["已驳回", "bg-rose-50 text-rose-800 ring-rose-200"],
  cancelled: ["已取消", "bg-slate-100 text-slate-700 ring-slate-200"],
  upcoming: ["未开始", "bg-slate-100 text-slate-700 ring-slate-200"],
  open: ["签到中", "bg-emerald-50 text-emerald-800 ring-emerald-200"],
  closed: ["已结束", "bg-slate-100 text-slate-700 ring-slate-200"],
};
export function StatusBadge({ status, leave = false }: { status: string; leave?: boolean }) {
  const [label, classes] = styles[leave && status === "pending" ? "leave_pending" : status] ?? [status, "bg-slate-100 text-slate-700 ring-slate-200"];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${classes}`}>{label}</span>;
}
export const leaveTypeLabel: Record<string, string> = { personal: "事假", sick: "病假", official: "公假" };
