import { McpServer } from '@modelcontextprotocol/server';
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
import { pos } from '../argv.js';
import { confinePaths } from '../file-roots.js';
import {
  attachmentDetails,
  attachmentNames,
  attachmentPreview,
  bodyPreview,
  CONFIRM_FALLBACK_DESCRIPTION,
  confirmTokenParam,
  gatedElsewhere,
  hasCommandWord,
  requireDispatchConfirmation,
  senderPreview,
} from '../dispatch-confirmation.js';

// gog's spellings of `send` under `messages` and `dm` (internal/cmd/chat_messages.go, chat_dm.go).
const CHAT_SEND_WORDS = new Set(['send', 'create', 'post']);

// gog's spellings of `spaces create` (`gog schema` 0.41.0).
const CHAT_SPACE_CREATE_WORDS = new Set(['create', 'add', 'new']);

/** gog_chat_run must not post, or add people to a space, where the dedicated tools would ask. */
export function vetChatRun(subcommand: string, args: readonly string[]): string | undefined {
  const sub = subcommand.toLowerCase();
  if (sub === 'spaces') {
    // A member-less space reaches nobody; one seeded with --member adds and notifies them.
    const word = hasCommandWord(args, CHAT_SPACE_CREATE_WORDS);
    const withMembers = args.some((a) => /^--members?(?:=|$)/i.test(a));
    return word && withMembers
      ? gatedElsewhere(`gog chat spaces ${word.toLowerCase()} --member`, 'gog_chat_run', 'adds people to a space', 'gog_chat_spaces_create')
      : undefined;
  }
  if (sub !== 'messages' && sub !== 'dm') return undefined;
  const word = hasCommandWord(args, CHAT_SEND_WORDS);
  if (!word) return undefined;
  return gatedElsewhere(`gog chat ${sub} ${word.toLowerCase()}`, 'gog_chat_run', 'posts a message',
    sub === 'dm' ? 'gog_chat_dm_send' : 'gog_chat_messages_send');
}

// A Chat post lands in other people's view the moment it is sent and cannot be
// unsent here, so both send tools go through the dispatch rail like Gmail does.
const CHAT_CONFIRM = {
  message: 'Review and confirm this Google Chat message:',
  confirmationLabel: 'Confirm that this Chat message should be posted now.',
} as const;

// Google Chat (gog >= 0.38.0 for the mention/reaction metadata in
// `messages list`, >= 0.39.0 for `messages search`; the rest is older).
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
    inputSchema: z.object({
      ...paginationParams,
      account: accountParam,
    }),
  }, async ({ max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['chat', 'spaces', 'list'];
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_spaces_find', {
    description:
      'Find spaces whose display name matches. Substring and case-insensitive by default, which is what you want when the '
      + 'user names a room approximately ("the launch room"); pass exact=true to require the whole title. DMs have no '
      + 'display name — use gog_chat_dm_space to reach a person.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      displayName: z.string().describe('Space display name, or part of one'),
      exact: z.boolean().optional().describe('Require an exact (still case-insensitive) match on the whole display name'),
      max: z.number().int().optional().describe('Max results per page'),
      account: accountParam,
    }),
  }, async ({ displayName, exact, max, account }) => {
    const args: GogArg[] = ['chat', 'spaces', 'find', pos(displayName)];
    if (exact) args.push('--exact');
    if (max !== undefined) args.push(`--max=${max}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_spaces_create', {
    description:
      'Create a named Chat space, optionally seeding its membership. Members are added immediately and are notified, so '
      + 'with members this asks the MCP host to show the user a confirmation prompt with the space name and every member '
      + 'first; nothing is created unless they accept. A space with no members reaches nobody and is created without '
      + 'asking.' + CONFIRM_FALLBACK_DESCRIPTION + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      displayName: z.string().describe('Display name for the new space'),
      members: z.array(z.string()).optional().describe('Initial members, as email addresses or "users/..." resource names'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ displayName, members, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['chat', 'spaces', 'create', pos(displayName)];
    if (members) for (const member of members) args.push(`--member=${member}`);
    if (members?.length) {
      const space = { displayName, members };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'chat.space-create',
        message: 'Review and confirm this Chat space — every member is added and notified:',
        confirmationLabel: 'Confirm that these people should be added to a new space now.',
        details: space,
        unsupportedNote: 'Create the space without members instead; the user can add people from Google Chat.',
        fallback: {
          tool: 'gog_chat_spaces_create',
          account,
          confirmToken,
          subject: () => ({ target: displayName, payload: space, preview: space }),
        },
      });
      if (confirmation) return confirmation;
    }
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_threads_list', {
    description:
      'List the threads in a space, so a reply can be targeted at an existing conversation rather than starting a new one. '
      + 'Pass a thread name from here as `thread` to gog_chat_messages_send.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      space: spaceParam,
      ...paginationParams,
      account: accountParam,
    }),
  }, async ({ space, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['chat', 'threads', 'list', pos(space)];
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
    inputSchema: z.object({
      space: spaceParam,
      thread: threadParam,
      unread: z.boolean().optional().describe('Only messages posted after the account last read this space'),
      order: z.enum(['createTime asc', 'createTime desc', 'lastUpdateTime asc', 'lastUpdateTime desc'])
        .optional().describe('Sort order (Chat default: "createTime asc", i.e. OLDEST first — ask for "createTime desc" when you want the latest messages)'),
      ...paginationParams,
      account: accountParam,
    }),
  }, async ({ space, thread, unread, order, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['chat', 'messages', 'list', pos(space)];
    if (thread) args.push(`--thread=${thread}`);
    if (unread) args.push('--unread');
    if (order) args.push(`--order=${order}`);
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_messages_search', {
    description:
      'Search Chat messages ACROSS every space and DM the account can see (gog >= 0.39.0) — the tool to reach for when the '
      + 'user asks "where did we discuss X" without naming a room, since gog_chat_messages_list needs a space up front. '
      + 'The query is Google Chat filter syntax, so it takes plain keywords or filters like sender, space, date, mention, '
      + 'unread, link and attachment. It is a search, NOT an export: Chat excludes some conversations (muted spaces among '
      + 'them), so an empty result does not prove a message never existed. view="full" adds each hit\'s read state and space '
      + 'mute setting; read state works on an ordinary chat grant, but the mute setting needs chat.users.spacesettings, '
      + 'which gog\'s chat scope set does NOT request (re-auth with extraScopes to get it). Missing metadata is OMITTED '
      + 'rather than defaulted, so an absent `read` means unknown while an explicit false means unread.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string().describe('Google Chat filter-syntax query — keywords, or filters such as "from:alice@example.com budget"'),
      order: z.enum(['create_time desc', 'relevance desc']).optional().describe(
        'Sort order. NOTE the snake_case, which differs from gog_chat_messages_list\'s camelCase. "relevance desc" needs '
        + 'Google Developer Preview access and errors without it',
      ),
      view: z.enum(['basic', 'full']).optional().describe(
        'Result view (default "basic"). "full" also requests read state (covered by an ordinary chat grant) and space '
        + 'mute setting (needs chat.users.spacesettings, which that grant does not include)',
      ),
      markup: z.enum(['chat', 'markdown']).optional().describe('Syntax to render each hit\'s formatted text in'),
      ...paginationParams,
      max: z.number().int().min(1).max(100).optional().describe('Max results per page (1-100; Chat search caps a page at 100)'),
      account: accountParam,
    }),
  }, async ({ query, order, view, markup, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['chat', 'messages', 'search', pos(query)];
    if (order) args.push(`--order=${order}`);
    if (view) args.push(`--view=${view}`);
    if (markup) args.push(`--markup=${markup}`);
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_messages_send', {
    description:
      'Post a message to a Chat space. THIS IS IMMEDIATELY VISIBLE TO EVERYONE IN THE SPACE and cannot be unsent through '
      + 'this tool, so treat it like sending mail, not like saving a draft. Pass `thread` to reply inside an existing '
      + 'conversation (from gog_chat_threads_list or a message\'s thread field); omit it to start a new one. Text supports '
      + 'Chat\'s markdown-ish formatting (*bold*, _italic_, `code`). Asks the MCP host to show the user a confirmation '
      + 'prompt with the space, thread, text and attachments first; nothing is posted unless they accept.'
      + CONFIRM_FALLBACK_DESCRIPTION + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      space: spaceParam,
      text: z.string().optional().describe('Message text. Optional only when an attachment is supplied.'),
      thread: threadParam,
      attach: z.array(z.string()).optional().describe(
        'Attachment file paths, read WHERE GOG RUNS. On a hosted or remote deployment that is not your machine — use '
        + 'attachInline there instead. Must be inside the server\'s GOG_FILE_ROOTS directories (default ~/gogcli-mcp-files).',
      ),
      attachInline: attachInlineParam,
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ space, text, thread, attach, attachInline, account, confirmToken }, ctx) => {
    confinePaths(attach, 'attach');
    if (text === undefined && !attach?.length && !attachInline?.length) {
      throw new Error('A Chat message needs text, an attachment, or both.');
    }
    const args: GogArg[] = ['chat', 'messages', 'send', pos(space)];
    if (text !== undefined) args.push(`--text=${text}`);
    if (thread) args.push(`--thread=${thread}`);
    if (attach) for (const path of attach) args.push(`--attach=${path}`);
    // Same repeatable --attach flag; the executor materializes each payload to
    // a temp file beside gog. `args` is passed so the size check sees the whole
    // request, not just the attachments.
    args.push(...inlineAttachmentArgs('attach', attachInline, args));
    const confirmation = await requireDispatchConfirmation(ctx, {
      ...CHAT_CONFIRM,
      action: 'chat.message-send',
      details: { space, thread, textPreview: bodyPreview(text), attachments: attachmentNames(attach, attachInline) },
      fallback: {
        tool: 'gog_chat_messages_send',
        account,
        confirmToken,
        subject: () => {
          const attachments = attachmentDetails(attach, attachInline);
          const from = senderPreview(account);
          return {
            target: space,
            payload: { from, space, thread, text, attachments },
            preview: { from, space, thread, text, attachments: attachmentPreview(attachments) },
          };
        },
      },
    });
    if (confirmation) return confirmation;
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_dm_send', {
    description:
      'Send a direct message to one person by email address, creating the DM space if this is the first message. Delivered '
      + 'immediately and cannot be unsent through this tool. For a room rather than a person, use gog_chat_messages_send. '
      + 'Asks the MCP host to show the user a confirmation prompt with the recipient and text first; nothing is sent '
      + 'unless they accept.' + CONFIRM_FALLBACK_DESCRIPTION + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      email: z.string().describe('Recipient email address'),
      text: z.string().describe('Message text'),
      thread: threadParam,
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ email, text, thread, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['chat', 'dm', 'send', pos(email), `--text=${text}`];
    if (thread) args.push(`--thread=${thread}`);
    const confirmation = await requireDispatchConfirmation(ctx, {
      ...CHAT_CONFIRM,
      action: 'chat.dm-send',
      details: { to: email, thread, textPreview: bodyPreview(text) },
      fallback: {
        tool: 'gog_chat_dm_send',
        account,
        confirmToken,
        subject: () => {
          const from = senderPreview(account);
          return { target: email, payload: { from, to: email, thread, text }, preview: { from, to: email, thread, text } };
        },
      },
    });
    if (confirmation) return confirmation;
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_dm_space', {
    description:
      'Resolve the DM space for an email address — the bridge from a person to the "spaces/..." name the message tools '
      + 'want. Creates the space if none exists yet, which is silent: it does not message the person.' + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      email: z.string().describe('The other person\'s email address'),
      account: accountParam,
    }),
  }, async ({ email, account }) => {
    return runOrDiagnose(['chat', 'dm', 'space', pos(email)], { account });
  });

  server.registerTool('gog_chat_reactions_list', {
    description:
      'List the emoji reactions on one message, with who reacted. gog_chat_messages_list already returns a reaction '
      + 'SUMMARY per message; come here when you need the individual reactors, or the reaction resource names that '
      + 'gog_chat_reactions_delete takes.' + workspaceOnlyNote,
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      message: z.string().describe('Message resource name ("spaces/AAAA/messages/BBBB"), or a bare message ID together with `space`'),
      space: z.string().optional().describe('Space resource name — required only when `message` is a bare ID'),
      ...paginationParams,
      account: accountParam,
    }),
  }, async ({ message, space, max, pageToken, page, all, account }) => {
    const args: GogArg[] = ['chat', 'messages', 'reactions', 'list', pos(message)];
    if (space) args.push(`--space=${space}`);
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_reactions_create', {
    description:
      'React to a message with an emoji. Visible to the space immediately. Pass the emoji itself ("👍"), not a :shortcode:.'
      + workspaceOnlyNote,
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      message: z.string().describe('Message resource name ("spaces/AAAA/messages/BBBB"), or a bare message ID together with `space`'),
      emoji: z.string().describe('The emoji character to react with, e.g. "👍"'),
      space: z.string().optional().describe('Space resource name — required only when `message` is a bare ID'),
      account: accountParam,
    }),
  }, async ({ message, emoji, space, account }) => {
    const args: GogArg[] = ['chat', 'messages', 'reactions', 'create', pos(message), pos(emoji)];
    if (space) args.push(`--space=${space}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_chat_reactions_delete', {
    description:
      'Remove one emoji reaction. Takes the REACTION\'s own resource name ("spaces/.../messages/.../reactions/..."), not '
      + 'the message\'s and not the emoji — get it from gog_chat_reactions_list. An account can only remove its own reaction.'
      + workspaceOnlyNote,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      reaction: z.string().describe('Reaction resource name, e.g. "spaces/AAAA/messages/BBBB/reactions/CCCC"'),
      account: accountParam,
    }),
  }, async ({ reaction, account }) => {
    return runOrDiagnose(['chat', 'messages', 'reactions', 'delete', pos(reaction)], { account });
  });

  registerRunTool(server, {
    service: 'chat',
    examples: '"spaces", "messages", "dm"',
    vet: vetChatRun,
    note: 'Google Chat has no API for consumer accounts: every chat subcommand fails on an @gmail.com account regardless of scopes.',
  });
}
