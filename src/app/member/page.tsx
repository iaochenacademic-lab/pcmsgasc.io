import { EmptyDashboard } from "@/components/empty-dashboard";
import { requireRole } from "@/lib/auth/guards";

export default async function MemberHomePage() {
  const session = await requireRole("member");
  return <EmptyDashboard role="member" name={session.name} />;
}
