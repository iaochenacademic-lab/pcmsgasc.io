import { createMeeting } from "@/lib/attendance/service";
import { createSupabaseAttendanceRepository } from "@/lib/attendance/repository";
import { attendanceResponse, invalidAttendanceInput } from "@/lib/attendance/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonObject, withApi } from "@/lib/http/api";

export const runtime = "nodejs";

export const POST = withApi("teacher", async (request, actor) => {
  const body = await readJsonObject(request);
  if (!body) return invalidAttendanceInput({ body: "请提交有效的 JSON 对象" });
  return attendanceResponse(await createMeeting({
    title: body.title,
    location: body.location,
    date: body.date,
    startTime: body.startTime,
    endTime: body.endTime,
    lateAfterMinutes: body.lateAfterMinutes,
  }, actor, { repository: createSupabaseAttendanceRepository(createAdminClient()) }));
});
