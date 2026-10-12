import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionPayload } from "@/lib/auth/types";
import { LogoutButton } from "@/components/logout-button";

export function AppShell({ title, user, children }: { title: string; user: SessionPayload; children: ReactNode }) {
  return <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-7">
        <div><Link href={user.role === "teacher" ? "/teacher" : "/member"} className="text-xs font-bold tracking-[0.18em] text-indigo-700">CLUB PORTAL</Link><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>
        <div className="flex items-center gap-3 text-sm"><span className="font-medium text-slate-700">{user.name}</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">{user.role === "teacher" ? "老师" : "成员"}</span><LogoutButton /></div>
      </header>
      {user.role === "teacher" && <nav aria-label="老师导航" className="mt-4 flex gap-2 text-sm font-semibold"><Link className="rounded-xl px-4 py-2 text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2" href="/teacher">概览</Link><Link className="rounded-xl px-4 py-2 text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2" href="/teacher#meetings">场次</Link></nav>}
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  </main>;
}
