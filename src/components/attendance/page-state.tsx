"use client";

export function PageLoading({ title }: { title: string }) {
  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
    <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
    <section role="status" aria-live="polite" aria-busy="true" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="font-medium text-slate-700">正在载入签到与请假资料，请稍候。</p>
      <div aria-hidden="true" className="mt-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-28 rounded-xl bg-slate-100 motion-safe:animate-pulse" />)}
      </div>
    </section>
  </main>;
}

export function PageError({ title, reset }: { title: string; reset: () => void }) {
  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
    <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div role="alert">
        <h2 className="text-lg font-semibold text-slate-900">暂时无法加载页面</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">签到与请假资料读取失败，请重新加载后再试。</p>
      </div>
      <button type="button" onClick={reset} className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
        重新加载
      </button>
    </section>
  </main>;
}
