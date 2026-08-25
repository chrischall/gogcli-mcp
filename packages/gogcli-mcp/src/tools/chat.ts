import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  accountParam,
  runOrDiagnose,
  registerRunTool,
  paginationParams,
  pushPaginationFlags,
} from './utils.js';
import type { GogArg } from '../runner.js';
import { attachInlineParam, inlineAttachmentArgs } from '../attachments.js';

// Google Chat (gog >= 0.38.0 for the mention/reaction metadata in
// `messages list`; the rest of the surface is older).
//
// TWO NAMING SYSTEMS MEET HERE, and mixing them is the mistake this module's
// descriptions exist to prevent. Chat identifies everything by RESOURCE NAME —
// `spaces/AAAA`, `spaces/AAAA/messages/BBBB`, `spaces/AAAA/threads/CCCC` — and
// those names are what every tool below wants. A bare ID (`BBBB`) is accepted
// for a message only when `space` says which space it lives in, which is why
// the reaction tools carry that extra parameter.
//
// gog_chat_spaces_find / gog_chat_dm_space are the bridges from human words
// ("the launch room", "alice@example.com") to those names; reach for one of
// them first rather than guessing a resource name.
//
// WORKSPACE-ONLY, AND THAT IS NOT A SCOPE PROBLEM: gog refuses every chat call
// on a consumer @gmail.com account with "chat requires a Google Workspace
// account (non-gmail.com)" — verified live against gog 0.38.0 — no matter which
// scopes the token carries. Re-authorizing cannot fix it, so the note below is
// appended to every description here: a model that reads "permission error" as
// "missing scope" would otherwise burn a re-auth round trip on an account that
// can never work.
export function registerChatTools(server: McpServer): void {
  const workspaceOnlyNote =
    ' WORKSPACE ONLY: Google Chat has no API for consumer accounts, so this fails on an @gmail.com '
    + 'account with "chat requires a Google Workspace account". That is the ACCOUNT, not the token — '
    + 're-authorizing or adding scopes will not help.';
  const spaceParam = z.string().describe(
    'Space resource name, e.g. "spaces/AAAAsomeID" (from gog_chat_spaces_list, gog_chat_spaces_find or gog_chat_dm_space)',
  );
  const threadParam = z.string().optional().describe(
    'Thread resource name, e.g. "spaces/AAAA/threads/CCCC" — reply inside that thread instead of starting a new one',
  );

  server.registerTool('gog_chat_spaces_list', {
    description:
      'List the Google Chat spaces the account belongs to — named rooms and DMs alike — with their resource names. '
      + 'Start here when you do not yet have a space name; gog_chat_spaces_find is faster when you know the room\'s title.'
      + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ max, pageToken, page, all, account }) => {
    const args = ['chat', 'spaces', 'list'];
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_spaces_find', {
    description:
      'Find spaces whose display name matches. Substring and case-insensitive by default, which is what you want when the '
      + 'user names a room approximately ("the launch room"); pass exact=true to require the whole title. DMs have no '
      + 'display name — use gog_chat_dm_space to reach a person.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      displayName: z.string().describe('Space display name, or part of one'),
      exact: z.boolean().optional().describe('Require an exact (still case-insensitive) match on the whole display name'),
      max: z.number().int().optional().describe('Max results per page'),
      account: accountParam,
    },
  }, async ({ displayName, exact, max, account }) => {
    const args = ['chat', 'spaces', 'find', displayName];
    if (exact) args.push('--exact');
    if (max !== undefined) args.push(`--max=${max}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_spaces_create', {
    description:
      'Create a named Chat space, optionally seeding its membership. Members are added immediately and are notified — this '
      + 'is visible to other people the moment it runs, so confirm the member list before calling it.' + workspaceOnlyNote,
    inputSchema: {
      displayName: z.string().describe('Display name for the new space'),
      members: z.array(z.string()).optional().describe('Initial members, as email addresses or "users/..." resource names'),
      account: accountParam,
    },
  }, async ({ displayName, members, account }) => {
    const args = ['chat', 'spaces', 'create', displayName];
    if (members) for (const member of members) args.push(`--member=${member}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_threads_list', {
    description:
      'List the threads in a space, so a reply can be targeted at an existing conversation rather than starting a new one. '
      + 'Pass a thread name from here as `thread` to gog_chat_messages_send.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      space: spaceParam,
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ space, max, pageToken, page, all, account }) => {
    const args = ['chat', 'threads', 'list', space];
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_messages_list', {
    description:
      'Read messages in a space. The JSON carries each message\'s @-mentions and a summary of its emoji reactions '
      + '(gog >= 0.38.0) alongside the text, so "who was tagged" and "did anyone react" are answerable without extra calls. '
      + 'unread=true returns only what arrived after the account last read the space — the cheap way to answer "what did I '
      + 'miss". Newest-first needs an explicit order="createTime desc"; Chat\'s own default is oldest-first.'
      + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      space: spaceParam,
      thread: threadParam,
      unread: z.boolean().optional().describe('Only messages posted after the account last read this space'),
      order: z.string().optional().describe('Sort order, e.g. "createTime desc" for newest-first'),
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ space, thread, unread, order, max, pageToken, page, all, account }) => {
    const args = ['chat', 'messages', 'list', space];
    if (thread) args.push(`--thread=${thread}`);
    if (unread) args.push('--unread');
    if (order) args.push(`--order=${order}`);
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_messages_send', {
    description:
      'Post a message to a Chat space. THIS IS IMMEDIATELY VISIBLE TO EVERYONE IN THE SPACE and cannot be unsent through '
      + 'this tool, so treat it like sending mail, not like saving a draft. Pass `thread` to reply inside an existing '
      + 'conversation (from gog_chat_threads_list or a message\'s thread field); omit it to start a new one. Text supports '
      + 'Chat\'s markdown-ish formatting (*bold*, _italic_, `code`).' + workspaceOnlyNote,
    inputSchema: {
      space: spaceParam,
      text: z.string().optional().describe('Message text. Optional only when an attachment is supplied.'),
      thread: threadParam,
      attach: z.array(z.string()).optional().describe(
        'Attachment file paths, read WHERE GOG RUNS. On a hosted or remote deployment that is not your machine — use '
        + 'attachInline there instead.',
      ),
      attachInline: attachInlineParam,
      account: accountParam,
    },
  }, async ({ space, text, thread, attach, attachInline, account }) => {
    if (text === undefined && !attach?.length && !attachInline?.length) {
      throw new Error('A Chat message needs text, an attachment, or both.');
    }
    const args: GogArg[] = ['chat', 'messages', 'send', space];
    if (text !== undefined) args.push(`--text=${text}`);
    if (thread) args.push(`--thread=${thread}`);
    if (attach) for (const path of attach) args.push(`--attach=${path}`);
    // Same repeatable --attach flag; the executor materializes each payload to
    // a temp file beside gog. `args` is passed so the size check sees the whole
    // request, not just the attachments.
    args.push(...inlineAttachmentArgs('attach', attachInline, args));
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_dm_send', {
    description:
      'Send a direct message to one person by email address, creating the DM space if this is the first message. Delivered '
      + 'immediately and cannot be unsent through this tool. For a room rather than a person, use gog_chat_messages_send.'
      + workspaceOnlyNote,
    inputSchema: {
      email: z.string().describe('Recipient email address'),
      text: z.string().describe('Message text'),
      thread: threadParam,
      account: accountParam,
    },
  }, async ({ email, text, thread, account }) => {
    const args = ['chat', 'dm', 'send', email, `--text=${text}`];
    if (thread) args.push(`--thread=${thread}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_dm_space', {
    description:
      'Resolve the DM space for an email address — the bridge from a person to the "spaces/..." name the message tools '
      + 'want. Creates the space if none exists yet, which is silent: it does not message the person.' + workspaceOnlyNote,
    inputSchema: {
      email: z.string().describe('The other person\'s email address'),
      account: accountParam,
    },
  }, async ({ email, account }) => {
    return runOrDiagnose(['chat', 'dm', 'space', email], { account });
  });

  server.registerTool('gog_chat_reactions_list', {
    description:
      'List the emoji reactions on one message, with who reacted. gog_chat_messages_list already returns a reaction '
      + 'SUMMARY per message; come here when you need the individual reactors, or the reaction resource names that '
      + 'gog_chat_reactions_delete takes.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      message: z.string().describe('Message resource name ("spaces/AAAA/messages/BBBB"), or a bare message ID together with `space`'),
      space: z.string().optional().describe('Space resource name — required only when `message` is a bare ID'),
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ message, space, max, pageToken, page, all, account }) => {
    const args = ['chat', 'messages', 'reactions', 'list', message];
    if (space) args.push(`--space=${space}`);
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_reactions_create', {
    description:
      'React to a message with an emoji. Visible to the space immediately. Pass the emoji itself ("👍"), not a :shortcode:.'
      + workspaceOnlyNote,
    inputSchema: {
      message: z.string().describe('Message resource name ("spaces/AAAA/messages/BBBB"), or a bare message ID together with `space`'),
      emoji: z.string().describe('The emoji character to react with, e.g. "👍"'),
      space: z.string().optional().describe('Space resource name — required only when `message` is a bare ID'),
      account: accountParam,
    },
  }, async ({ message, emoji, space, account }) => {
    const args = ['chat', 'messages', 'reactions', 'create', message, emoji];
    if (space) args.push(`--space=${space}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_reactions_delete', {
    description:
      'Remove one emoji reaction. Takes the REACTION\'s own resource name ("spaces/.../messages/.../reactions/..."), not '
      + 'the message\'s and not the emoji — get it from gog_chat_reactions_list. An account can only remove its own reaction.'
      + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: {
      reaction: z.string().describe('Reaction resource name, e.g. "spaces/AAAA/messages/BBBB/reactions/CCCC"'),
      account: accountParam,
    },
  }, async ({ reaction, account }) => {
    return runOrDiagnose(['chat', 'messages', 'reactions', 'delete', reaction], { account });
  });

  registerRunTool(server, {
    service: 'chat',
    examples: '"spaces", "messages", "dm"',
    note: 'Google Chat has no API for consumer accounts: every chat subcommand fails on an @gmail.com account regardless of scopes.',
  });
}
