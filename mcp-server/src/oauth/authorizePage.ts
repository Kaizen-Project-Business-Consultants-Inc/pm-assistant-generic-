/**
 * Renders a self-contained HTML login page for OAuth authorization.
 * Hidden fields carry OAuth params; form POSTs to /authorize/submit.
 */
export function renderAuthorizePage(params: {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope?: string;
  error?: string;
}): string {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const errorHtml = params.error
    ? `<div class="error">${escHtml(params.error)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in — PM Assistant</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #1a1a2e;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.25rem;
    }
    .subtitle {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    .client-name {
      font-weight: 600;
      color: #333;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 0.3rem;
      color: #444;
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
      margin-bottom: 1rem;
      transition: border-color 0.15s;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,0.1);
    }
    button {
      width: 100%;
      padding: 0.7rem;
      background: #4f46e5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #4338ca; }
    .error {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 0.6rem 0.75rem;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
    .footer {
      text-align: center;
      margin-top: 1rem;
      font-size: 0.8rem;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign in</h1>
    <p class="subtitle">
      ${params.clientName ? `<span class="client-name">${escHtml(params.clientName)}</span> wants to access` : 'Authorize access to'}
      PM Assistant on your behalf.
    </p>
    ${errorHtml}
    <form method="POST" action="/authorize/submit">
      <input type="hidden" name="client_id" value="${escHtml(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escHtml(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escHtml(params.codeChallenge)}">
      ${params.state ? `<input type="hidden" name="state" value="${escHtml(params.state)}">` : ''}
      ${params.scope ? `<input type="hidden" name="scope" value="${escHtml(params.scope)}">` : ''}
      <label for="username">Username or Email</label>
      <input type="text" id="username" name="username" required autocomplete="username" autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Sign in &amp; Authorize</button>
    </form>
    <p class="footer">PM Assistant &mdash; Project Management</p>
  </div>
</body>
</html>`;
}
