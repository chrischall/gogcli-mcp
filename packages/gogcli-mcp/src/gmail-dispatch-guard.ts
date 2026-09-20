import type { CallToolResult, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import { readEnvVar, requireConfirmation } from '@chrischall/mcp-utils';

// ============================================================================
// THE SAFETY RAIL. gog_gmail_reply / reply_all / send / forward / autoreply are
// the only tools in this fleet that put a message irreversibly into someone
// else's mailbox on the FIRST call. Every other Gmail write either stages
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
 * The five dispatches this rail guards, spelled once.
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
  | 'gmail.autoreply';

/** Every op, for tests that must cover the set rather than a chosen member. */
export const GMAIL_DISPATCH_OPS: readonly GmailDispatchOp[] = [
  'gmail.send',
  'gmail.reply',
  'gmail.reply-all',
  'gmail.forward',
  'gmail.autoreply',
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
 * these saves without sending, and `gog_gmail_drafts_send` then dispatches it —
 * which is the rail's own sanctioned two-step (staging is visible and
 * inspectable, so the send is never the FIRST call), not a way around it.
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

/** Apply the shared stateless confirmation flow with Gmail-specific copy. */
export function requireGmailDispatchConfirmation(
  ctx: ServerContext,
  op: GmailDispatchOp,
  details: Record<string, unknown>,
): InputRequiredResult | CallToolResult | undefined {
  const twin = STAGING_TWIN[op];
  return requireConfirmation(ctx, {
    action: op,
    message: 'Review and confirm this email dispatch:',
    details,
    confirmationLabel: 'Confirm that this email should be sent now.',
    ...(twin
      ? {
          unsupportedNote: `Stage it with ${twin} instead, review the draft, `
            + 'and send it with gog_gmail_drafts_send.',
        }
      : {}),
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
