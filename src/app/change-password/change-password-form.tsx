"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { NEW_PASSWORD_MIN_LENGTH } from "@/lib/auth/constants";

interface ChangePasswordFormProps {
  name: string;
}

export function ChangePasswordForm({ name }: ChangePasswordFormProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = (await response.json()) as { redirectTo?: unknown; error?: unknown };

      if (!response.ok || typeof result.redirectTo !== "string") {
        setError(typeof result.error === "string" ? result.error : "暂时无法修改密码，请稍后重试。");
        return;
      }

      router.replace(result.redirectTo);
      router.refresh();
    } catch {
      setError("暂时无法修改密码，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/70 sm:p-10">
      <p className="mb-3 text-xs font-bold tracking-[0.2em] text-indigo-600">账户安全</p>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">请先修改密码</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {name}，首次登录需要设置一个新的个人密码后才能继续。
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="current-password" className="mb-2 block text-sm font-medium text-slate-700">
            当前密码
          </label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-700">
            新密码
          </label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={NEW_PASSWORD_MIN_LENGTH}
            maxLength={72}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        <div>
          <label htmlFor="password-confirmation" className="mb-2 block text-sm font-medium text-slate-700">
            确认新密码
          </label>
          <input
            id="password-confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={NEW_PASSWORD_MIN_LENGTH}
            maxLength={72}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
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
          {pending ? "正在保存…" : "保存新密码"}
        </button>
      </form>
    </section>
  );
}
