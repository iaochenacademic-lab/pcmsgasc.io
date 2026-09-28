import { EmptyDashboard } from "@/components/empty-dashboard";
import { requireRole } from "@/lib/auth/guards";

export default async function TeacherHomePage() {
  const session = await requireRole("teacher");
  return <EmptyDashboard role="teacher" name={session.name} />;
}
