import type { UserRole } from "@/lib/auth/types";
import { LogoutButton } from "@/components/logout-button";

interface EmptyDashboardProps {
  role: UserRole;
  name: string;
}

export function EmptyDashboard({ role, name }: EmptyDashboardProps) {
  const title = role === "teacher" ? "老师后台" : "成员首页";
  const description =
    role === "teacher"
      ? "这里将用于管理社团事务。"
      : "这里将展示与你相关的社团信息。";

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:px-7">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-indigo-600">CLUB PORTAL</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">社团管理平台</p>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <span className="hidden text-sm text-slate-600 sm:inline">{name}</span>
            <LogoutButton />
          </div>
        </header>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white px-6 py-12 shadow-sm sm:px-10 sm:py-16">
          <p className="text-sm font-medium text-indigo-600">欢迎回来，{name}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
          <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            暂无内容
          </div>
        </section>
      </div>
    </main>
  );
}
