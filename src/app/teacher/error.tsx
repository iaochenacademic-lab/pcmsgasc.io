"use client";

import { PageError } from "@/components/attendance/page-state";

export default function TeacherError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError title="老师后台" reset={reset} />;
}
