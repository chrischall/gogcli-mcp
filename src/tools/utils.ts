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

// On failure, appends `gog auth list` output so Claude can see which accounts
// are configured and suggest the right one.
export async function runOrDiagnose(
  args: string[],
  options: { account?: string },
): Promise<ToolResult> {
  try {
    return toText(await run(args, options));
  } catch (err) {
    const base = toError(err);
    try {
      const accounts = await run(['auth', 'list']);
      return toText(`${base.content[0].text}\n\nConfigured accounts:\n${accounts}`);
    } catch {
      return base;
    }
  }
}
