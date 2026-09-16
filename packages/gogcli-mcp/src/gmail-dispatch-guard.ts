import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { rawTextResult } from '@chrischall/mcp-utils';

// ============================================================================
// THE SAFETY RAIL. gog_gmail_reply / reply_all / send / forward / autoreply are
// the only tools in this fleet that put a message irreversibly into someone
// else's mailbox on the FIRST call. Every other Gmail write either stages
// something (drafts) or acts on mail already in this account (labels,
// archive, trash). A caller that meant "save a draft" and picked the wrong
// tool — or an agent that inherited the wrong reply target — used to find out
// only after the send API call already succeeded.
//
// `confirmed` makes the first call inert: it returns a PREVIEW (recipients,
// subject, size) instead of sending, and only a second call with
// confirmed:true dispatches. This is deliberately NOT part of replySchema —
// gog_gmail_drafts_reply/reply_all reuse that schema and must never gain a
// confirmation gate, since they never send on their own.
// ============================================================================
export const confirmedParam = z.boolean().optional().describe(
  'Set true to actually send. Without it (or false), NOTHING IS SENT — this call instead returns a preview of ' +
  'what would go out (recipients, subject, size) so you can check it before committing. Read the preview, then ' +
  'call again with confirmed: true and the SAME other arguments to send for real.',
);

// The shape every preview shares, so a caller learns the contract once. Uses
// rawTextResult (indented) rather than the minified seam other tools go
// through: a preview is read by a person or model deciding whether to
// proceed, not machine-consumed at scale, and the tools here make ~1 call —
// none of the token-budget pressure that motivates minifying a `drive ls`
// applies to a single preview object.
export function dispatchPreviewResult(op: string, details: Record<string, unknown>): CallToolResult {
  return rawTextResult(JSON.stringify({
    preview: true,
    sent: false,
    op,
    ...details,
    note: 'PREVIEW ONLY — nothing was sent. Review the recipients above, then call again with confirmed: true ' +
      '(and the same other arguments) to send for real.',
  }, null, 2));
}

// Over-inclusive on purpose: this feeds an audit log and a caller-facing
// preview, neither of which is the enforcement point (the confirmed gate is).
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
  const raw = process.env.GOG_GMAIL_TRUSTED_DOMAINS;
  if (raw) {
    for (const part of raw.split(',')) {
      const domain = part.trim().toLowerCase();
      if (domain) domains.add(domain);
    }
  }
  const acct = account ?? process.env.GOG_ACCOUNT;
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
