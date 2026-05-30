import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { run } from '../runner.js';

export type ToolResult = { content: [{ type: 'text'; text: string }] };

export const accountParam = z.string().optional().describe(
  'Google account email to use (overrides GOG_ACCOUNT env var)',
);

// Canonical ID descriptors. Use these instead of redefining the same
// `z.string().describe('Course ID')` etc. across multiple tool files —
// keeps descriptions in lockstep so they don't drift apart.
export const ids = {
  course: z.string().describe('Course ID'),
  coursework: z.string().describe('Coursework ID'),
  submission: z.string().describe('Submission ID'),
  announcement: z.string().describe('Announcement ID'),
  topic: z.string().describe('Topic ID'),
  invitation: z.string().describe('Invitation ID'),
  spreadsheet: z.string().describe('Spreadsheet ID (from the URL)'),
  doc: z.string().describe('Doc ID (from the URL)'),
  presentation: z.string().describe('Presentation ID'),
  slide: z.string().describe('Slide ID'),
  file: z.string().describe('File ID'),
  message: z.string().describe('Message ID'),
  thread: z.string().describe('Thread ID'),
  draft: z.string().describe('Draft ID'),
  label: z.string().describe('Label ID or name'),
  attachment: z.string().describe('Attachment ID'),
  comment: z.string().describe('Comment ID'),
  meetingCode: z.string().describe('Meeting code (e.g. abc-defg-hij)'),
  permission: z.string().describe('Permission ID'),
  user: z.string().describe('User ID'),
  // People API uses fully-qualified resource names ("people/c123") not bare IDs.
  person: z.string().describe('Person resource name (people/...) or email'),
};

// Pagination param triple — appears in 20+ tools across base + extras.
export const paginationParams = {
  max: z.number().int().optional().describe('Max results'),
  page: z.string().optional().describe('Page token'),
  all: z.boolean().optional().describe('Fetch all pages'),
};

// Append pagination flags to an argv array. Mirrors the shape of
// paginationParams above. Use together to keep call sites concise.
export function pushPaginationFlags(
  args: string[],
  p: { max?: number; page?: string; all?: boolean },
): void {
  if (p.max !== undefined) args.push(`--max=${p.max}`);
  if (p.page) args.push(`--page=${p.page}`);
  if (p.all) args.push('--all');
}

// Register a `gog_<service>_run` escape-hatch tool. 11 services currently
// register an identical-shape tool; this factory keeps them in lockstep.
// Pass `omitAccount: true` only for auth, which doesn't take --account.
export function registerRunTool(
  server: McpServer,
  options: {
    service: string;
    examples: string;
    omitAccount?: boolean;
    /** Extra sentence appended to the description (used by auth to point to gog_auth_add). */
    note?: string;
  },
): void {
  const { service, examples, omitAccount = false, note } = options;
  const baseDescription = `Run any gog ${service} subcommand not covered by the other tools. Run \`gog ${service} --help\` for the full list of subcommands, or \`gog ${service} <subcommand> --help\` for flags on a specific subcommand.`;
  const description = note ? `${baseDescription} ${note}` : baseDescription;
  const inputSchema: Record<string, z.ZodTypeAny> = {
    subcommand: z.string().describe(`The gog ${service} subcommand to run, e.g. ${examples}`),
    args: z.array(z.string()).describe('Additional positional args and flags'),
  };
  if (!omitAccount) {
    inputSchema.account = accountParam;
  }
  server.registerTool(`gog_${service}_run`, {
    description,
    annotations: { destructiveHint: true },
    inputSchema,
  }, async (rawArgs) => {
    const { subcommand, args, account } = rawArgs as { subcommand: string; args: string[]; account?: string };
    return runOrDiagnose([service, subcommand, ...args], { account });
  });
}

export function toText(output: string): ToolResult {
  return { content: [{ type: 'text' as const, text: output }] };
}

export function toError(err: unknown): ToolResult {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}

const AUTH_ERROR_PATTERN = /\b(401|unauthorized|token.*(expired|revoked)|invalid_grant)\b/i;

const TRANSIENT_ERROR_PATTERN =
  /\b429\b|\b5\d\d\b|\bquota\b|rateLimit|\bDEADLINE_EXCEEDED\b/i;

// gogcli rejects writes whose range falls outside the sheet's current grid
// (e.g. writing to column AP on a 41-column sheet) with a "exceeds grid limits"
// error and no remediation. Point the caller at the tool that grows the grid.
const GRID_LIMIT_ERROR_PATTERN = /exceeds grid limits/i;

const AUTH_HINT =
  '\n\nAuthentication may have expired. Use gog_auth_add to re-authorize the account. ' +
  'Ask the user if they would like to re-authenticate.';

const TRANSIENT_HINT =
  '\n\nThis error is often transient. Retry the same call before trying a different approach ' +
  '(do not fall back to smaller writes or row-by-row operations).';

const GRID_LIMIT_HINT =
  '\n\nThe target range is outside the sheet\'s current grid. Add the missing rows or columns ' +
  'first with gog_sheets_insert (dimension: rows or cols), then retry the write.';

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
    const isTransientError = !isAuthError && TRANSIENT_ERROR_PATTERN.test(errText);
    const isGridLimitError = GRID_LIMIT_ERROR_PATTERN.test(errText);
    const hint = isAuthError
      ? AUTH_HINT
      : isTransientError
        ? TRANSIENT_HINT
        : isGridLimitError
          ? GRID_LIMIT_HINT
          : '';
    try {
      const accounts = await run(['auth', 'list']);
      return toText(`${errText}\n\nConfigured accounts:\n${accounts}${hint}`);
    } catch {
      return toText(`${errText}${hint}`);
    }
  }
}
