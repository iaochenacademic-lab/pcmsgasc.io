"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function Countdown({ until, now, refresh = false, label = "剩余签到时间" }: { until: string; now: string; refresh?: boolean; label?: string }) {
  const [current, setCurrent] = useState(Date.parse(now));
  const router = useRouter();
  useEffect(() => { const timer = setInterval(() => setCurrent(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!refresh) return; const timer = setInterval(() => router.refresh(), 10_000); return () => clearInterval(timer); }, [refresh, router]);
  const seconds = Math.max(0, Math.ceil((Date.parse(until) - current) / 1000));
  const hours = Math.floor(seconds / 3600);
  return <p className="tabular-nums">{label}：{hours > 0 ? `${hours}小时 ` : ""}{Math.floor(seconds % 3600 / 60)}分 {seconds % 60}秒</p>;
}
