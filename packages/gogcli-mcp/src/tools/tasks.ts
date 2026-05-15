import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool } from './utils.js';

export function registerTasksTools(server: McpServer): void {
  server.registerTool('gog_tasks_lists', {
    description: 'List all Google Task lists.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['tasks', 'lists', 'list'], { account });
  });

  server.registerTool('gog_tasks_list', {
    description: 'List tasks in a Google Task list.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      tasklistId: z.string().describe('Task list ID (use gog_tasks_lists to find IDs)'),
      account: accountParam,
    },
  }, async ({ tasklistId, account }) => {
    return runOrDiagnose(['tasks', 'list', tasklistId], { account });
  });

  server.registerTool('gog_tasks_get', {
    description: 'Get a specific task by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      tasklistId: z.string().describe('Task list ID'),
      taskId: z.string().describe('Task ID'),
      account: accountParam,
    },
  }, async ({ tasklistId, taskId, account }) => {
    return runOrDiagnose(['tasks', 'get', tasklistId, taskId], { account });
  });

  server.registerTool('gog_tasks_add', {
    description: 'Add a task to a Google Task list.',
    annotations: { destructiveHint: false },
    inputSchema: {
      tasklistId: z.string().describe('Task list ID'),
      title: z.string().describe('Task title'),
      notes: z.string().optional().describe('Task notes/description'),
      due: z.string().optional().describe('Due date (YYYY-MM-DD or RFC3339)'),
      account: accountParam,
    },
  }, async ({ tasklistId, title, notes, due, account }) => {
    const args = ['tasks', 'add', tasklistId, `--title=${title}`];
    if (notes) args.push(`--notes=${notes}`);
    if (due) args.push(`--due=${due}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_tasks_done', {
    description: 'Mark a task as completed.',
    annotations: { destructiveHint: true },
    inputSchema: {
      tasklistId: z.string().describe('Task list ID'),
      taskId: z.string().describe('Task ID'),
      account: accountParam,
    },
  }, async ({ tasklistId, taskId, account }) => {
    return runOrDiagnose(['tasks', 'done', tasklistId, taskId], { account });
  });

  server.registerTool('gog_tasks_delete', {
    description: 'Delete a task.',
    annotations: { destructiveHint: true },
    inputSchema: {
      tasklistId: z.string().describe('Task list ID'),
      taskId: z.string().describe('Task ID'),
      account: accountParam,
    },
  }, async ({ tasklistId, taskId, account }) => {
    return runOrDiagnose(['tasks', 'delete', tasklistId, taskId], { account });
  });

  registerRunTool(server, { service: 'tasks', examples: '"update", "undo", "clear"' });
}
