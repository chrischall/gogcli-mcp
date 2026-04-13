export type ToolResult = { content: [{ type: 'text'; text: string }] };

export function toText(output: string): ToolResult {
  return { content: [{ type: 'text' as const, text: output }] };
}

export function toError(err: unknown): ToolResult {
  return toText(err instanceof Error ? `Error: ${err.message}` : String(err));
}
