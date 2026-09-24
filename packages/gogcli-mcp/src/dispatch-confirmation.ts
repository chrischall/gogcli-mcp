import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import {
  CONFIRM_TOKEN_INSTRUCTION,
  confirmationFromEnv,
  readEnvVar,
  requireConfirmationWithFallback,
  type ConfirmSubject,
} from '@chrischall/mcp-utils';
import { confirmSpentStore } from './send-confirm-token.js';

// ============================================================================
// THE DISPATCH RAIL, service-neutral: every tool that reaches another person
// (Gmail sends, Chat posts, guest-visible Calendar changes, Drive shares,
// Classroom announcements and invitations) asks the user first.
//
// Elicitation is primary: the host shows the preview and the model never holds
// the approval. On a client that declares no elicitation (claude.ai, measured),
// the call site's `DispatchTokenFallback` runs the two-phase preview +
// confirmToken flow instead (mcp-utils' confirmationFromEnv +
// requireConfirmationWithFallback), as the fleet's MCP_CONFIRM_MODE says:
// ask-user (default), auto, or refuse. A call site with no fallback (the
// forwarding filter) is always refused on such a client.
// ============================================================================

// Bound on the body text shown in a confirmation prompt. Enough to read what is
// actually being sent (the point of SEC-5), small enough to keep the prompt a
// prompt rather than a copy of the message.
export const BODY_PREVIEW_MAX = 2048;

/** The first BODY_PREVIEW_MAX characters of a body, marked when cut. */
export function bodyPreview(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (text.length <= BODY_PREVIEW_MAX) return text;
  return `${text.slice(0, BODY_PREVIEW_MAX)}… [${text.length - BODY_PREVIEW_MAX} more characters not shown]`;
}

/**
 * Every attachment a dispatch will carry: a server path in full (so the user
 * sees WHICH file on the gog host is leaving), an inline one by its filename.
 */
export function attachmentNames(
  paths: readonly string[] | undefined,
  inline: ReadonlyArray<{ filename: string }> | undefined,
): string[] {
  return [...(paths ?? []), ...(inline ?? []).map((a) => a.filename)];
}

/** One attachment as the fallback preview shows it and its hash binds it. */
export type AttachmentDetail = { name: string; size: number | null; sha256?: string };

/**
 * Name, byte size and content SHA-256 of every file a dispatch carries, for the
 * token fallback's preview and payload hash. A server path is read (it is
 * already confined to GOG_FILE_ROOTS) so a same-size swap between the phases is
 * still a changed payload; an unreadable one reports `size: null` and gog will
 * fail on it anyway.
 */
export function attachmentDetails(
  paths: readonly string[] | undefined,
  inline: ReadonlyArray<{ filename: string; contentBase64: string }> | undefined,
): AttachmentDetail[] {
  const out: AttachmentDetail[] = [];
  for (const path of paths ?? []) {
    let bytes: Buffer | undefined;
    try {
      bytes = readFileSync(path);
    } catch {
      bytes = undefined;
    }
    out.push(bytes
      ? { name: path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      : { name: path, size: null });
  }
  for (const a of inline ?? []) {
    out.push({
      name: a.filename,
      size: Buffer.from(a.contentBase64, 'base64').length,
      sha256: createHash('sha256').update(a.contentBase64).digest('hex'),
    });
  }
  return out;
}

/** Who a dispatch goes out as, for the fallback preview: an explicit alias, else the account. */
export function senderPreview(account: string | undefined, from?: string): string {
  return from ?? account ?? readEnvVar('GOG_ACCOUNT') ?? "the gog account's default address";
}

/** Drop the fingerprint for display: the user needs a name and a size. */
export function attachmentPreview(details: readonly AttachmentDetail[]): Array<{ name: string; size: number | null }> {
  return details.map(({ name, size }) => ({ name, size }));
}

/** The instruction a mail dispatch's phase 1 carries — verbatim from the spec that introduced the fallback. */
export const CONFIRM_SEND_INSTRUCTION =
  'Show this preview to the user verbatim and send only after they explicitly approve in chat. '
  + 'Then call again with confirmToken.';

/** The same instruction for a dispatch that is not mail (a share, an invitation, a post). */
export const CONFIRM_ACTION_INSTRUCTION = CONFIRM_TOKEN_INSTRUCTION;

/** Appended to each gated tool's description. */
export const CONFIRM_FALLBACK_DESCRIPTION =
  ' If the client cannot show that prompt (no MCP elicitation, e.g. claude.ai), a two-step flow applies instead: call '
  + 'WITHOUT confirmToken and nothing is sent or changed — the result has status "confirmation-required", the full '
  + 'preview and a confirmToken. Follow its instruction (by default: show the preview to the user verbatim and only '
  + 'after they explicitly approve it in chat, call again with the SAME arguments plus confirmToken). The tool re-reads '
  + 'what it would act on and refuses (DRAFT_CHANGED, with a fresh preview and token) if it changed; TOKEN_EXPIRED / '
  + 'TOKEN_REUSED / TOKEN_INVALID also do nothing. A server set to MCP_CONFIRM_MODE=refuse refuses instead.';

// The schema input every gated tool adds: mcp-utils' own, so its wording and
// the helper that reads it cannot drift apart.
export { confirmTokenParam } from '@chrischall/mcp-utils';

/** What the fallback binds a token to — recomputed from a fresh read on every call. */
export type TokenSubject = ConfirmSubject;

/**
 * Opt-in second rail for a client that cannot be prompted. `subject` is only
 * called when the fallback actually runs, so a tool may do an extra read there
 * without changing the elicitation path at all. It may return an error result
 * (a failed read), which is passed back unchanged.
 */
export interface DispatchTokenFallback {
  tool: string;
  account?: string;
  confirmToken?: string;
  /** Phase 1's instruction to the model. Defaults to {@link CONFIRM_ACTION_INSTRUCTION}. */
  instruction?: string;
  subject: () => TokenSubject | CallToolResult | Promise<TokenSubject | CallToolResult>;
}

/**
 * The refusal an escape hatch (`gog_<service>_run`, `gog_api_call`) gives for an
 * action a dedicated tool gates. Without it, the run tool is a way around the
 * rail: the model forwards the same subcommand and nobody is asked (#400).
 */
export function gatedElsewhere(what: string, via: string, does: string, tool: string): string {
  return `${what} ${does} and is not available through ${via}. Use ${tool}, which asks the user to confirm.`;
}

/** True when any forwarded token is one of `words` (kong lets flags precede the command word). */
export function hasCommandWord(args: readonly string[], words: ReadonlySet<string>): string | undefined {
  return args.find((a) => words.has(a.toLowerCase()));
}

// gog's spellings of `comments create|reply` under drive and docs (`gog schema` 0.41.0).
const COMMENT_ADD_WORDS = new Set(['create', 'add', 'new']);
const COMMENT_REPLY_WORDS = new Set(['reply', 'respond']);

/** True when a forwarded flag list asks for `--<flag>` (bare, or =anything but false). */
export function hasTrueFlag(args: readonly string[], flag: string): boolean {
  const name = `--${flag}`;
  return args.some((a) => {
    const lower = a.toLowerCase();
    if (lower === name) return true;
    return lower.startsWith(`${name}=`) && lower.slice(name.length + 1) !== 'false';
  });
}

/**
 * gog_{drive,docs}_run must not post the comments gog_*_comments_add / _reply
 * would ask about: a comment notifies the file's owner and everyone it +mentions.
 */
export function vetCommentsRun(service: 'drive' | 'docs', subcommand: string, args: readonly string[]): string | undefined {
  if (subcommand.toLowerCase() !== 'comments') return undefined;
  const reply = hasCommandWord(args, COMMENT_REPLY_WORDS);
  if (reply) {
    return gatedElsewhere(`gog ${service} comments ${reply.toLowerCase()}`, `gog_${service}_run`,
      'notifies the comment thread', `gog_${service}_comments_reply`);
  }
  const add = hasCommandWord(args, COMMENT_ADD_WORDS);
  return add
    ? gatedElsewhere(`gog ${service} comments ${add.toLowerCase()}`, `gog_${service}_run`,
      'notifies the file\'s owner and anyone it mentions', `gog_${service}_comments_add`)
    : undefined;
}

export interface DispatchConfirmationOptions {
  /** Stable id of the dispatch, echoed in every result (`gmail.send`, `drive.share`, …). */
  action: string;
  /** Heading of the elicitation prompt. */
  message: string;
  /** Label beside the prompt's confirmation checkbox. */
  confirmationLabel: string;
  /** What the elicitation prompt shows. */
  details: Record<string, unknown>;
  /** The way through on a client that cannot be prompted, when there is one. */
  unsupportedNote?: string;
  /** Opt-in second rail; omit it and a client that cannot be prompted is always refused. */
  fallback?: DispatchTokenFallback;
}

/**
 * Ask the user before a dispatch. `undefined` means proceed; anything else is
 * the result to return unchanged.
 *
 * Elicitation stays the primary path and is untouched. When the caller
 * declares it cannot be prompted AND a `fallback` is supplied, MCP_CONFIRM_MODE
 * decides: ask-user (default) or auto run the two-phase token flow; refuse
 * refuses and names the switch. Without a fallback it is always refused.
 */
export async function requireDispatchConfirmation(
  ctx: ServerContext,
  options: DispatchConfirmationOptions,
): Promise<InputRequiredResult | CallToolResult | undefined> {
  const { action, fallback } = options;
  const confirmation = {
    action,
    message: options.message,
    details: options.details,
    confirmationLabel: options.confirmationLabel,
    ...(options.unsupportedNote ? { unsupportedNote: options.unsupportedNote } : {}),
  };
  if (!fallback) return requireConfirmationWithFallback(ctx, confirmation);
  return requireConfirmationWithFallback(ctx, confirmationFromEnv({
    ...confirmation,
    tool: fallback.tool,
    account: fallback.account ?? readEnvVar('GOG_ACCOUNT') ?? '',
    confirmToken: fallback.confirmToken,
    subject: fallback.subject,
    instruction: fallback.instruction ?? CONFIRM_ACTION_INSTRUCTION,
    spent: confirmSpentStore(),
  }));
}

// The single place a CallToolResult's text is pulled back out, for the tools
// here that need to read gog's own JSON before deciding what to preview or
// log. Mirrors the shape every runOrDiagnose result actually returns
// (content[0].text); never throws on an unexpected shape.
export function resultText(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '{}';
}
