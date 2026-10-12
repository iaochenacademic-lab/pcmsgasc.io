import { reviewLeave } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { isUuid } from "@/lib/attendance/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject, withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const POST = withApi<{ id: string }>("teacher", async (request, actor, { params }) => {
  if (!isUuid(params.id)) return invalidAttendanceInput({ leaveId: "请假申请编号无效" });
  const body = await readJsonObject(request);
  if (!body) return invalidAttendanceInput({ body: "请提交有效的 JSON 对象" });
  return attendanceResponse(await reviewLeave(params.id, {
    decision: body.decision,
    comment: body.comment,
  }, actor, { repository: createSupabaseAttendanceRepository(createAdminClient()) }));
});
