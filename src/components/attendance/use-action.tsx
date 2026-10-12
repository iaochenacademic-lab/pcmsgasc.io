"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  async function run(url: string, method: string, body: unknown): Promise<Record<string, unknown> | null> {
    setPending(true); setError(""); setFieldErrors({});
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "操作失败，请稍后重试");
        if (data.fieldErrors && typeof data.fieldErrors === "object") {
          setFieldErrors(Object.fromEntries(Object.entries(data.fieldErrors).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
        }
        if (response.status === 401) router.replace("/login?reason=expired");
        return data;
      }
      router.refresh();
      return data;
    } catch {
      setError("网络连接失败，请稍后重试");
      return null;
    } finally { setPending(false); }
  }
  return { pending, error, fieldErrors, run };
}

export function ActionError({ error }: { error: string }) {
  return error ? <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null;
}
