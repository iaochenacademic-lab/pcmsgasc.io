import { cancelMeeting, regenerateCode, updateMeeting } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { isUuid } from "@/lib/attendance/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject, withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const PATCH = withApi<{ id: string }>("teacher", async (request, actor, { params }) => {
  if (!isUuid(params.id)) return invalidAttendanceInput({ meetingId: "场次编号无效" });
  const body = await readJsonObject(request);
  if (!body) return invalidAttendanceInput({ body: "请提交有效的 JSON 对象" });
  const deps = { repository: createSupabaseAttendanceRepository(createAdminClient()) };
  switch (body.action) {
    case "update":
      return attendanceResponse(await updateMeeting(params.id, {
        title: body.title,
        location: body.location,
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        lateAfterMinutes: body.lateAfterMinutes,
      }, actor, deps));
    case "cancel":
      return attendanceResponse(await cancelMeeting(params.id, actor, deps));
    case "regenerate_code":
      return attendanceResponse(await regenerateCode(params.id, actor, deps));
    default:
      return invalidAttendanceInput({ action: "请选择有效的场次操作" });
  }
});
