import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import { callerAcceptsFormElicitation, readEnvVar, requireConfirmation, textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import {
  confirmTokenTtlSeconds,
  hashSendPayload,
  issueConfirmToken,
  sendConfirmFallbackEnabled,
  verifyConfirmToken,
  type ConfirmBinding,
  type ConfirmTokenError,
} from './send-confirm-token.js';

// ============================================================================
// THE DISPATCH RAIL, service-neutral: every tool that reaches another person
// (Gmail sends, Chat posts, guest-visible Calendar changes, Drive shares,
// Classroom announcements and invitations) asks the user first.
//
// Elicitation is primary: the host shows the preview and the model never holds
// the approval. On a client that declares no elicitation (claude.ai, measured),
// the call is refused — unless the call site supplies a `DispatchTokenFallback`
// and the server opted in with GOG_SEND_CONFIRM_FALLBACK=token, in which case
// the two-phase preview + confirmToken flow (send-confirm-token.ts) runs instead.
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
export const CONFIRM_ACTION_INSTRUCTION =
  'Show this preview to the user verbatim and proceed only after they explicitly approve in chat. '
  + 'Then call again with confirmToken.';

const FALLBACK_HINT = 'Or set GOG_SEND_CONFIRM_FALLBACK=token to enable two-step confirmation.';

/** Appended to each gated tool's description. */
export const CONFIRM_FALLBACK_DESCRIPTION =
  ' If the client cannot show that prompt (no MCP elicitation, e.g. claude.ai) and the server sets '
  + 'GOG_SEND_CONFIRM_FALLBACK=token, a two-step flow applies instead: call WITHOUT confirmToken and nothing is '
  + 'sent or changed — the result has status "confirmation-required", the full preview and a confirmToken. Show that preview '
  + 'to the user verbatim; only after they explicitly approve it in chat, call again with the SAME arguments plus '
  + 'confirmToken. The tool re-reads what it would act on and refuses (DRAFT_CHANGED, with a fresh preview and token) '
  + 'if it changed; TOKEN_EXPIRED / TOKEN_REUSED / TOKEN_INVALID also do nothing.';

export const confirmTokenParam = z.string().optional().describe(
  'ONLY for the two-step fallback (client without MCP elicitation, server with GOG_SEND_CONFIRM_FALLBACK=token). '
  + 'The confirmToken from this same tool\'s phase-1 "confirmation-required" response, passed back ONLY after the user '
  + 'has seen that preview and explicitly approved it in chat — never on the first call, never invented, never '
  + 'reused. Call again with the same arguments. Ignored when the client supports elicitation.',
);

/** What the fallback binds a token to — recomputed from a fresh read on every call. */
export interface TokenSubject {
  /** The draftId / messageId / fileId / eventId / query the dispatch acts on. */
  target: string;
  /** A version that rotates on edit: a draft's messageId, an event's etag. */
  revision?: string;
  /** Canonical send payload; its SHA-256 is bound into the token. */
  payload: unknown;
  /** The complete preview shown to the user. */
  preview: Record<string, unknown>;
}

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

const TOKEN_ERROR_NOTE: Record<Exclude<ConfirmTokenError, 'DRAFT_CHANGED'>, string> = {
  TOKEN_EXPIRED: 'Nothing was sent or changed: the confirmToken expired. Call again WITHOUT confirmToken for a fresh preview, '
    + 'and ask the user to approve it again.',
  TOKEN_REUSED: 'Nothing was sent or changed by this call: this confirmToken was already used, and one approval acts once. '
    + 'If doing it again is really intended, call again WITHOUT confirmToken and get a new approval.',
  TOKEN_INVALID: 'Nothing was sent or changed: this confirmToken was not issued by this server for this tool, account and '
    + 'target (or the server has restarted since). Call again WITHOUT confirmToken for a fresh preview and approval.',
};

const DRAFT_CHANGED_NOTE = {
  'message-id-rotated': 'Nothing was sent or changed: the target was edited since the user approved it (a draft\'s '
    + 'messageId or an event\'s version rotated), so what would happen is not what they saw.',
  'payload-changed': 'Nothing was sent or changed: what would happen no longer matches what the user approved.',
} as const;

function isToolResult(value: TokenSubject | CallToolResult): value is CallToolResult {
  return Array.isArray((value as CallToolResult).content);
}

function rejection(data: Record<string, unknown>): CallToolResult {
  return { ...textResult({ status: 'confirmation-rejected', confirmed: false, dispatched: false, ...data }), isError: true };
}

async function tokenConfirmation(op: string, fallback: DispatchTokenFallback): Promise<CallToolResult | undefined> {
  const subject = await fallback.subject();
  if (isToolResult(subject)) return subject;
  const binding: ConfirmBinding = {
    tool: fallback.tool,
    account: fallback.account ?? readEnvVar('GOG_ACCOUNT') ?? '',
    target: subject.target,
    ...(subject.revision === undefined ? {} : { revision: subject.revision }),
    payloadHash: hashSendPayload(subject.payload),
  };
  const phaseOne = () => {
    const { token, expiresAt } = issueConfirmToken(binding);
    return {
      action: op,
      preview: subject.preview,
      confirmToken: token,
      expiresAt,
      ttlSeconds: confirmTokenTtlSeconds(),
      instruction: fallback.instruction ?? CONFIRM_ACTION_INSTRUCTION,
    };
  };
  if (!fallback.confirmToken) {
    return textResult({ status: 'confirmation-required', confirmed: false, dispatched: false, ...phaseOne() });
  }
  const verdict = verifyConfirmToken(fallback.confirmToken, binding);
  if (verdict.ok) return undefined;
  if (verdict.error === 'DRAFT_CHANGED') {
    return rejection({
      error: 'DRAFT_CHANGED',
      reason: verdict.reason,
      note: `${DRAFT_CHANGED_NOTE[verdict.reason!]} The current preview and a fresh confirmToken are below.`,
      ...phaseOne(),
    });
  }
  return rejection({ error: verdict.error, action: op, note: TOKEN_ERROR_NOTE[verdict.error] });
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
 * Elicitation stays the primary path and is untouched. Only when the caller
 * declares it cannot be prompted AND a `fallback` is supplied AND
 * GOG_SEND_CONFIRM_FALLBACK=token does the two-phase token flow run instead of
 * the refusal; with the env unset, the refusal names that switch.
 */
export async function requireDispatchConfirmation(
  ctx: ServerContext,
  options: DispatchConfirmationOptions,
): Promise<InputRequiredResult | CallToolResult | undefined> {
  const { action, fallback } = options;
  if (fallback && callerAcceptsFormElicitation(ctx) === false && sendConfirmFallbackEnabled()) {
    return tokenConfirmation(action, fallback);
  }
  const note = fallback
    ? [options.unsupportedNote, FALLBACK_HINT].filter(Boolean).join(' ')
    : options.unsupportedNote;
  return requireConfirmation(ctx, {
    action,
    message: options.message,
    details: options.details,
    confirmationLabel: options.confirmationLabel,
    ...(note ? { unsupportedNote: note } : {}),
  });
}

// The single place a CallToolResult's text is pulled back out, for the tools
// here that need to read gog's own JSON before deciding what to preview or
// log. Mirrors the shape every runOrDiagnose result actually returns
// (content[0].text); never throws on an unexpected shape.
export function resultText(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '{}';
}
