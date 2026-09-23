import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import { readEnvVar, requireConfirmation } from '@chrischall/mcp-utils';

// ============================================================================
// THE SAFETY RAIL. gog_gmail_reply / reply_all / send / forward / autoreply /
// drafts_send, and a filter that forwards, are the tools in this fleet that put
// a message irreversibly into someone else's mailbox. Every other Gmail write either stages
// something (drafts) or acts on mail already in this account (labels,
// archive, trash). A caller that meant "save a draft" and picked the wrong
// tool — or an agent that inherited the wrong reply target — used to find out
// only after the send API call already succeeded.
//
// MCP elicitation makes the first round inert: it returns an input_required
// result containing the preview, and only the protocol retry carrying the
// user's accepted confirmation dispatches. The confirmation is never a tool
// argument, so a model cannot bypass the user by setting a boolean itself.
//
// A CLIENT THAT CANNOT SHOW THAT PROMPT gets a sentence rather than a prompt
// it will refuse to deliver (`unsupportedNote`, mcp-utils `requireConfirmation`).
// Measured on the mcp-host fleet 2026-09-20: claude.ai declares no MCP
// elicitation capability, so from the day this rail shipped every one of these
// five tools answered it with a -32021 the surface renders as "Error occurred
// during tool execution" — four `gog_gmail_forward` attempts in a row, 69-107ms
// each, none of which reached `gog`. The rail is unchanged; what changes is that
// the refusal now says what happened and names the way through.
// ============================================================================

/**
 * The dispatches this rail guards, spelled once.
 *
 * A UNION rather than `string`, because the staging-twin table below is keyed
 * by these values and a key that matches no call site is silent: it costs the
 * note, not the refusal, so nothing fails and no test that writes the op by
 * hand can see it. `gmail.reply_all` shipped in the first cut of this file for
 * exactly that reason — `sendReply` builds `gmail.${kind}` from
 * `'reply' | 'reply-all'`, so the real op is HYPHENATED and the underscored key
 * was never read. With the union in place that is a compile error at both ends.
 */
export type GmailDispatchOp =
  | 'gmail.send'
  | 'gmail.reply'
  | 'gmail.reply-all'
  | 'gmail.forward'
  | 'gmail.autoreply'
  // Sending a staged draft dispatches mail just as irreversibly as a direct
  // send; draft-create then drafts-send was an unconfirmed two-step around the
  // rail (audit SEC-2).
  | 'gmail.drafts-send'
  // A filter with a forward action sends every FUTURE matching message to
  // another address — persistent exfiltration, not a one-off send.
  | 'gmail.filter-forward';

/** Every op, for tests that must cover the set rather than a chosen member. */
export const GMAIL_DISPATCH_OPS: readonly GmailDispatchOp[] = [
  'gmail.send',
  'gmail.reply',
  'gmail.reply-all',
  'gmail.forward',
  'gmail.autoreply',
  'gmail.drafts-send',
  'gmail.filter-forward',
];

/**
 * The op a reply dispatch reports, derived from the same `kind` the command
 * line is built from.
 *
 * Exported so the ONE place that interpolates a kind into an op is the one a
 * test can call, rather than a template literal inside `sendReply` that a test
 * can only imitate. Imitating it is what hid the hyphen.
 */
export function replyDispatchOp(kind: 'reply' | 'reply-all'): GmailDispatchOp {
  return `gmail.${kind}`;
}

/**
 * The staging twin of each dispatch, named in the refusal above. Every one of
 * these saves without sending. `gog_gmail_drafts_send` asks for confirmation
 * too, so on a client that cannot show a prompt the way through is the USER
 * sending the saved draft from Gmail — a human in the loop either way.
 *
 * `Partial<Record<…>>` and not an index signature: a key outside the union is
 * now rejected by the compiler, which is the whole point, while `autoreply`
 * stays deliberately absent — a bulk auto-reply over a search has no draft
 * twin, and naming a tool that does not exist would be worse than saying
 * nothing.
 */
const STAGING_TWIN: Partial<Record<GmailDispatchOp, string>> = {
  'gmail.forward': 'gog_gmail_drafts_forward',
  'gmail.reply': 'gog_gmail_drafts_reply',
  'gmail.reply-all': 'gog_gmail_drafts_reply_all',
  'gmail.send': 'gog_gmail_drafts_create',
};

// What to say when there is no staging twin but there IS still a way through.
const UNSUPPORTED_NOTE: Partial<Record<GmailDispatchOp, string>> = {
  'gmail.drafts-send': 'The draft is still saved: ask the user to review it and send it from Gmail.',
};

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

/** Apply the shared stateless confirmation flow with Gmail-specific copy. */
export function requireGmailDispatchConfirmation(
  ctx: ServerContext,
  op: GmailDispatchOp,
  details: Record<string, unknown>,
): InputRequiredResult | CallToolResult | undefined {
  const twin = STAGING_TWIN[op];
  const note = twin
    ? `Stage it with ${twin} instead; the user can review the draft and send it from Gmail `
      + '(gog_gmail_drafts_send also asks for confirmation).'
    : UNSUPPORTED_NOTE[op];
  return requireConfirmation(ctx, {
    action: op,
    message: op === 'gmail.filter-forward'
      ? 'Review and confirm this mail-forwarding filter:'
      : 'Review and confirm this email dispatch:',
    details,
    confirmationLabel: op === 'gmail.filter-forward'
      ? 'Confirm that matching mail should be forwarded automatically from now on.'
      : 'Confirm that this email should be sent now.',
    ...(note ? { unsupportedNote: note } : {}),
  });
}

// Over-inclusive on purpose: this feeds an audit log and a caller-facing
// preview, neither of which is the enforcement point (the protocol gate is).
// Missing a real recipient would be the dangerous direction of error; catching
// an extra email-shaped substring is not.
const EMAIL_PATTERN = /[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

export function extractEmails(...values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const matches = value.match(EMAIL_PATTERN);
    if (!matches) continue;
    for (const match of matches) {
      const lower = match.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        out.push(lower);
      }
    }
  }
  return out;
}

// GOG_GMAIL_TRUSTED_DOMAINS names domains that are never "external" — by
// default just the sending account's own domain, so a reply-all that includes
// the account itself never reads as a surprise. Comma-separated, additive.
function trustedDomains(account: string | undefined): Set<string> {
  const domains = new Set<string>();
  const raw = readEnvVar('GOG_GMAIL_TRUSTED_DOMAINS');
  if (raw) {
    for (const part of raw.split(',')) {
      const domain = part.trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  }
  const acct = account ?? readEnvVar('GOG_ACCOUNT');
  const at = acct?.indexOf('@') ?? -1;
  if (acct && at > -1) domains.add(acct.slice(at + 1).toLowerCase());
  return domains;
}

// A distinguishable, greppable event for every mail dispatch — recipient
// count plus whichever recipients fall outside the trusted-domain list — so an
// unexpected external send (outside counsel, a wrong-number alias) can be
// caught after the fact even if the confirmation step above is somehow
// bypassed by a future caller. stdout is the JSON-RPC channel, so this goes to
// stderr like every other diagnostic in this repo.
export function logGmailDispatch(tool: string, recipients: string[], account?: string): void {
  const domains = trustedDomains(account);
  const externalRecipients = recipients.filter((recipient) => {
    const at = recipient.indexOf('@');
    const domain = at > -1 ? recipient.slice(at + 1) : '';
    return !domain || !domains.has(domain);
  });
  const event = {
    event: 'gmail_dispatch',
    tool,
    recipientCount: recipients.length,
    externalRecipientCount: externalRecipients.length,
    hasExternalRecipients: externalRecipients.length > 0,
    externalRecipients,
    timestamp: new Date().toISOString(),
  };
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

// The single place a CallToolResult's text is pulled back out, for the tools
// here that need to read gog's own JSON before deciding what to preview or
// log. Mirrors the shape every runOrDiagnose result actually returns
// (content[0].text); never throws on an unexpected shape.
export function resultText(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === 'text' && typeof first.text === 'string' ? first.text : '{}';
}
