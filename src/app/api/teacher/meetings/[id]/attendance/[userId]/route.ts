import { setAttendance } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { isUuid } from "@/lib/attendance/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject, withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const PUT = withApi<{ id: string; userId: string }>("teacher", async (request, actor, { params }) => {
  if (!isUuid(params.id)) return invalidAttendanceInput({ meetingId: "场次编号无效" });
  if (!isUuid(params.userId)) return invalidAttendanceInput({ userId: "成员编号无效" });
  const body = await readJsonObject(request);
  if (!body) return invalidAttendanceInput({ body: "请提交有效的 JSON 对象" });
  return attendanceResponse(await setAttendance(params.id, params.userId, {
    status: body.status,
    note: body.note,
  }, actor, { repository: createSupabaseAttendanceRepository(createAdminClient()) }));
});
