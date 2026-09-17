import type { ConnectorAuth } from './connector-auth.js';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function encodeOauthRequest(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function renderLoginPage<Props>(
  auth: ConnectorAuth<Props>,
  options: { oauthReq: unknown; error?: string },
): string {
  const fields = auth.fields.map((field) => `
    <label>${escapeHtml(field.label)}
      <input name="${escapeHtml(field.name)}" type="${field.type ?? 'text'}" required>
    </label>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Connect ${escapeHtml(auth.service)}</title>
<style>body{font:16px system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem;color:#202124}form{display:grid;gap:1rem}label{display:grid;gap:.4rem}input,button{font:inherit;padding:.7rem}button{color:white;background:${escapeHtml(auth.accent ?? '#444')};border:0;border-radius:.3rem}.error{color:#b3261e}</style>
</head><body><h1>Connect ${escapeHtml(auth.service)}</h1>
${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ''}
<form method="post">${fields}
<input type="hidden" name="oauthReq" value="${escapeHtml(encodeOauthRequest(options.oauthReq))}">
<button type="submit">Authorize</button></form>
${auth.privacyNote ? `<p>${escapeHtml(auth.privacyNote)}</p>` : ''}
</body></html>`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serve the connector's GET login form and POST authorization completion. */
export async function handleAuthorize<Props>(
  request: Request,
  env: {
    OAUTH_PROVIDER: {
      parseAuthRequest(request: Request): Promise<unknown>;
      completeAuthorization(input: unknown): Promise<{ redirectTo: string }>;
    };
  },
  auth: ConnectorAuth<Props>,
): Promise<Response> {
  if (request.method === 'GET') {
    const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    return new Response(renderLoginPage(auth, { oauthReq }), {
      headers: { 'content-type': 'text/html' },
    });
  }

  const formData = await request.formData();
  const encodedOauthReq = formData.get('oauthReq');
  const oauthReq = typeof encodedOauthReq === 'string'
    ? JSON.parse(atob(encodedOauthReq))
    : undefined;
  const fields = Object.fromEntries(auth.fields.map((field) => {
    const value = formData.get(field.name);
    return [field.name, typeof value === 'string' ? value : ''];
  }));

  try {
    const props = await auth.login(fields, env);
    const firstField = auth.fields[0];
    const userId = auth.userId ?? (firstField ? fields[firstField.name] : 'public');
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId,
      scope: [],
      metadata: {},
      props,
    });
    return Response.redirect(redirectTo, 302);
  } catch (error) {
    return new Response(renderLoginPage(auth, { oauthReq, error: messageOf(error) }), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
}
