import { ChangePasswordForm } from "@/app/change-password/change-password-form";
import { requireSession } from "@/lib/auth/guards";

export default async function ChangePasswordPage() {
  const session = await requireSession();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <ChangePasswordForm name={session.name} />
    </main>
  );
}
