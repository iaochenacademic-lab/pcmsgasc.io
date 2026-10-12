"use client";

import { PageError } from "@/components/attendance/page-state";

export default function MemberError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="成员首页" reset={reset} />;
}
