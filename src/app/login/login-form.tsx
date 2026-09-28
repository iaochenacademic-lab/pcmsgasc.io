"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as { redirectTo?: unknown; error?: unknown };

      if (!response.ok || typeof result.redirectTo !== "string") {
        setError("用户名或密码错误，请检查后重试。");
        return;
      }

      router.replace(result.redirectTo);
      router.refresh();
    } catch {
      setError("暂时无法登录，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/70 sm:p-10">
      <div className="mb-8">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-indigo-600">CLUB PORTAL</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">社团管理平台</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">请使用老师或成员账号登录</p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="username" className="mb-2 block text-sm font-medium text-slate-700">
            用户名
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">
            密码
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "正在登录…" : "登录"}
        </button>
      </form>

      <div className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">
        <p>仅限管理员预先创建的账号，不提供自助注册。</p>
        <p>首次登录后需要修改密码。</p>
      </div>
    </section>
  );
}
