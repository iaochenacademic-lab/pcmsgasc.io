import { LoginForm } from "@/app/login/login-form";

interface LoginPageProps {
  searchParams: Promise<{ reason?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { reason } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <LoginForm sessionExpired={reason === "expired"} />
    </main>
  );
}
