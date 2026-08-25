import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  accountParam,
  runOrDiagnose,
  registerRunTool,
  paginationParams,
  pushPaginationFlags,
} from './utils.js';

// Google Apps Script (gog >= 0.38.0 for pull/deployments/versions).
//
// This wraps the READ and RUN halves of the Apps Script API. gog has no push,
// so nothing here can change a project's code: `create` makes an empty project
// and `pull`/`content` only copy code outwards. The one tool with real reach is
// gog_appscript_run_function, which executes somebody's script under this
// account's authority — see its description.
//
// The Apps Script API is OFF by default on a Google Cloud project, so the first
// call on a fresh OAuth client fails with "Apps Script API is not enabled for
// this OAuth project" and a console URL. That error is gog's, it names the
// exact project, and it is not a scope failure — do not answer it with a
// re-auth.
export function registerAppScriptTools(server: McpServer): void {
  const scriptIdParam = z.string().describe(
    'Apps Script project ID — the long ID in script.google.com/…/projects/<scriptId>/…, NOT the Drive file ID of a '
    + 'container document',
  );
  const apiEnableNote =
    ' Needs the Apps Script API enabled on the OAuth client\'s Google Cloud project; if it is not, gog says so and prints '
    + 'the console URL to enable it. That is a project setting, not a missing scope — re-authorizing will not fix it.';

  server.registerTool('gog_appscript_get', {
    description:
      'Get an Apps Script project\'s metadata: title, creator, create/update times, and the parent Drive file when the '
      + 'project is bound to a Sheet, Doc or Form. Use gog_appscript_content to read the actual code.' + apiEnableNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      scriptId: scriptIdParam,
      account: accountParam,
    },
  }, async ({ scriptId, account }) => {
    return runOrDiagnose(['appscript', 'get', scriptId], { account });
  });

  server.registerTool('gog_appscript_content', {
    description:
      'Read a project\'s source — every .gs file and its appsscript.json manifest — INLINE in the response. This is the '
      + 'tool to reach for when the question is "what does this script do"; it needs no filesystem, so it works the same '
      + 'on a hosted deployment as it does locally, unlike gog_appscript_pull.' + apiEnableNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      scriptId: scriptIdParam,
      account: accountParam,
    },
  }, async ({ scriptId, account }) => {
    return runOrDiagnose(['appscript', 'content', scriptId], { account });
  });

  server.registerTool('gog_appscript_pull', {
    description:
      'Write a project\'s files into a local directory, for editing a script as ordinary files. '
      + 'THE DIRECTORY IS RESOLVED WHERE GOG RUNS, which is the caller\'s own machine only on a local (stdio) deployment: '
      + 'on the hosted connector, or any GOG_RUNNER_URL backend, the files land on that server where the caller cannot '
      + 'reach them. Use gog_appscript_content there instead — it returns the same source in the response. Existing files '
      + 'are left alone unless overwrite is set. Read-only as far as Google is concerned: nothing is pushed back.'
      + apiEnableNote,
    inputSchema: {
      scriptId: scriptIdParam,
      dir: z.string().describe('Destination directory, resolved on the machine where gog runs'),
      overwrite: z.boolean().optional().describe('Overwrite files that already exist in dir'),
      account: accountParam,
    },
  }, async ({ scriptId, dir, overwrite, account }) => {
    const args = ['appscript', 'pull', scriptId, dir];
    if (overwrite) args.push('--overwrite');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_appscript_create', {
    description:
      'Create a new, empty Apps Script project. Pass parentId to bind it to a Drive file (a Sheet, Doc or Form), which is '
      + 'what makes the script a container-bound script with access to that document; omit it for a standalone project. '
      + 'gog cannot upload code, so the project starts empty either way.' + apiEnableNote,
    inputSchema: {
      title: z.string().describe('Project title'),
      parentId: z.string().optional().describe('Drive file ID to bind the project to (Sheet, Doc or Form). Omit for a standalone project.'),
      account: accountParam,
    },
  }, async ({ title, parentId, account }) => {
    const args = ['appscript', 'create', `--title=${title}`];
    if (parentId) args.push(`--parent-id=${parentId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_appscript_deployments', {
    description:
      'List a project\'s deployments — the published web apps, add-ons and API executables, each pinned to a version. A '
      + 'deployment ID from here is what gog_appscript_run_function needs when a script is not running in dev mode.'
      + apiEnableNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      scriptId: scriptIdParam,
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ scriptId, max, pageToken, page, all, account }) => {
    const args = ['appscript', 'deployments', scriptId];
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_appscript_versions', {
    description:
      'List a project\'s saved versions — the immutable snapshots deployments point at, with their numbers and '
      + 'descriptions. Useful for answering "what is actually deployed" next to gog_appscript_deployments.' + apiEnableNote,
    annotations: { readOnlyHint: true },
    inputSchema: {
      scriptId: scriptIdParam,
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ scriptId, max, pageToken, page, all, account }) => {
    const args = ['appscript', 'versions', scriptId];
    pushPaginationFlags(args, { max, pageToken, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_appscript_run_function', {
    description:
      'Execute a function in a deployed Apps Script project. TREAT THIS AS ARBITRARY CODE EXECUTION: the script runs with '
      + 'this Google account\'s authority and can send mail, edit Drive files or call external services, and the wrapper '
      + 'cannot tell a read from a write — read the code with gog_appscript_content first if you did not write it. '
      + 'Requires the project to be deployed as an API executable and to share the OAuth client with the calling '
      + 'credentials, otherwise Google refuses regardless of scopes. devMode runs the latest saved code instead of the '
      + 'deployed version, and only works if the account owns the script. '
      + 'This is NOT the escape hatch — gog_appscript_run is that.' + apiEnableNote,
    annotations: { destructiveHint: true },
    inputSchema: {
      scriptId: scriptIdParam,
      functionName: z.string().describe('Name of the function to call, e.g. "doWork"'),
      params: z.string().optional().describe('Function parameters as a JSON ARRAY of positional arguments, e.g. \'["a", 1]\' — not an object'),
      devMode: z.boolean().optional().describe('Run the latest saved code rather than the deployed version (owner only)'),
      account: accountParam,
    },
  }, async ({ scriptId, functionName, params, devMode, account }) => {
    // gog passes --params through to the API as-is, so a malformed value comes
    // back as a Google error about the request body rather than about the
    // argument the caller actually got wrong. Checking the shape here is what
    // turns "invalid argument" into "params must be a JSON array".
    if (params !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(params);
      } catch {
        throw new Error(`params must be a JSON array of positional arguments, e.g. '["a", 1]'. Received: ${params}`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`params must be a JSON ARRAY of positional arguments, e.g. '["a", 1]' — Apps Script takes positional arguments, not named ones. Received: ${params}`);
      }
    }
    const args = ['appscript', 'run', scriptId, functionName];
    if (params !== undefined) args.push(`--params=${params}`);
    if (devMode) args.push('--dev-mode');
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, {
    service: 'appscript',
    examples: '"get", "content", "deployments"',
    note: 'To execute a function, use gog_appscript_run_function — this tool is the generic escape hatch.',
  });
}
