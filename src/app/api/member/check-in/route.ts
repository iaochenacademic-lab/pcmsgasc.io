import { checkIn } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { isUuid } from "@/lib/attendance/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject, withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const POST = withApi("member", async (request, actor) => {
  const body = await readJsonObject(request);
  if (!body) return invalidAttendanceInput({ body: "请提交有效的 JSON 对象" });
  if (!isUuid(body.meetingId)) return invalidAttendanceInput({ meetingId: "场次编号无效" });
  return attendanceResponse(await checkIn({
    meetingId: body.meetingId,
    code: body.code,
  }, actor, { repository: createSupabaseAttendanceRepository(createAdminClient()) }));
});
