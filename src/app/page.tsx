import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";

export default async function HomePage() {
  const session = await requireSession();

  if (session.mustChangePassword) {
    redirect("/change-password");
  }

  redirect(session.role === "teacher" ? "/teacher" : "/member");
}
