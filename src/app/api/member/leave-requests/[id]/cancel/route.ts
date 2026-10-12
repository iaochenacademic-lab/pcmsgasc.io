import { cancelLeave } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { isUuid } from "@/lib/attendance/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const POST = withApi<{ id: string }>("member", async (_request, actor, { params }) => {
  if (!isUuid(params.id)) return invalidAttendanceInput({ leaveId: "请假申请编号无效" });
  return attendanceResponse(await cancelLeave(params.id, actor, {
    repository: createSupabaseAttendanceRepository(createAdminClient()),
  }));
});
