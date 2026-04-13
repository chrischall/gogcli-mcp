import { z } from 'zod';
import { run } from '../runner.js';

export type ToolResult = { content: [{ type: 'text'; text: string }] };

export const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

export function toText(output: string): ToolResult {
  return { content: [{ type: 'text' as const, text: output }] };
}

export function toError(err: unknown): ToolResult {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}

const AUTH_ERROR_PATTERN = /\b(401|unauthorized|token.*(expired|revoked)|invalid_grant)\b/i;

const AUTH_HINT =
  '\n\nAuthentication may have expired. Use gog_auth_add to re-authorize the account. ' +
  'Ask the user if they would like to re-authenticate.';

export async function runOrDiagnose(
  args: string[],
  options: { account?: string },
): Promise<ToolResult> {
  try {
    return toText(await run(args, options));
  } catch (err) {
    const base = toError(err);
    const errText = base.content[0].text;
    const isAuthError = AUTH_ERROR_PATTERN.test(errText);
    const hint = isAuthError ? AUTH_HINT : '';
    try {
      const accounts = await run(['auth', 'list']);
      return toText(`${errText}\n\nConfigured accounts:\n${accounts}${hint}`);
    } catch {
      return toText(`${errText}${hint}`);
    }
  }
}
