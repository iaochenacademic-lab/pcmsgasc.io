const MAX_BODY_BYTES = 65536;

export function httpError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function checkWriteRequest(request: Request): Promise<Request> {
  if (['GET', 'HEAD'].includes(request.method)) return request;
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    throw httpError(403, '請從本站頁面提交操作。');
  }
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) throw httpError(405, '不支援此操作。');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    throw httpError(415, '請提交 JSON 格式的資料。');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw httpError(413, '提交內容過長。');
  const reader = request.body?.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel();
          throw httpError(413, '提交內容過長。');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return new Request(request.url, { method: request.method, headers, body });
}

export function protectResponse(response: Response, privateResponse: boolean): Response {
  const result = new Response(response.body, response);
  if (privateResponse) result.headers.set('Cache-Control', 'no-store');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  result.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return result;
}
