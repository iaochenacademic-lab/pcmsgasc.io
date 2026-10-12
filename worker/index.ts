import type { Env } from './env';
import { handleAuth, requireActor, refreshCookie } from './auth';
import { handleBusiness } from './business';
import { checkWriteRequest, httpError, protectResponse } from './http';
export { Account } from './account';

export default {
  async fetch(originalRequest: Request, env: Env): Promise<Response> {
    const path = new URL(originalRequest.url).pathname;
    if (!path.startsWith('/api/')) return protectResponse(await env.ASSETS.fetch(originalRequest), false);
    let request = originalRequest;
    let authenticated = false;
    try {
      request = await checkWriteRequest(request);
      if (path === '/api/health' && request.method === 'GET') return protectResponse(Response.json({ ok: true }), true);
      const authResponse = await handleAuth(request, env, path);
      if (authResponse) return protectResponse(authResponse, true);
      const actor = await requireActor(request, env);
      authenticated = true;
      const response = await handleBusiness(request, env, actor, path) ?? httpError(404, '找不到這個功能。');
      return protectResponse(await refreshCookie(request, env, response), true);
    } catch (error) {
      let response = error instanceof Response ? error : error instanceof SyntaxError
        ? httpError(400, '資料格式不正確。') : httpError(500, '暫時無法完成操作，請稍後重試。');
      // Never log request bodies, identity records, or authentication errors.
      if (authenticated) {
        try { response = await refreshCookie(request, env, response); } catch { /* revocation wins over renewal */ }
      }
      return protectResponse(response, true);
    }
  },
} satisfies ExportedHandler<Env>;
