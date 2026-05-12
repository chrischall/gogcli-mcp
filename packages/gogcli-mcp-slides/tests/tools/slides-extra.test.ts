import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExtraSlidesTools } from '../../src/tools/slides-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function toText(text: string) {
  return { content: [{ type: 'text', text }] };
}

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerExtraSlidesTools(server);
  return handlers;
}

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers();
});

describe('gog_slides_create_from_markdown', () => {
  it('calls runOrDiagnose with title only', async () => {
    await handlers.get('gog_slides_create_from_markdown')!({ title: 'Deck' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'create-from-markdown', 'Deck'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    await handlers.get('gog_slides_create_from_markdown')!({
      title: 'Deck',
      content: '# Slide 1',
      contentFile: '/tmp/deck.md',
      parent: 'folder1',
      debug: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'slides', 'create-from-markdown', 'Deck',
        '--content=# Slide 1',
        '--content-file=/tmp/deck.md',
        '--parent=folder1',
        '--debug',
      ],
      { account: undefined },
    );
  });

  it('omits --debug when false', async () => {
    await handlers.get('gog_slides_create_from_markdown')!({ title: 'Deck', debug: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'create-from-markdown', 'Deck'],
      { account: undefined },
    );
  });
});

describe('gog_slides_create_from_template', () => {
  it('calls runOrDiagnose with templateId and title only', async () => {
    await handlers.get('gog_slides_create_from_template')!({ templateId: 'tpl1', title: 'Deck' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck'],
      { account: undefined },
    );
  });

  it('passes --replace for a single replacement entry', async () => {
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacements: { name: 'Alice' },
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck', '--replace=name=Alice'],
      { account: undefined },
    );
  });

  it('passes --replace for each entry in replacements', async () => {
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacements: { name: 'Alice', company: 'Acme' },
    });
    const call = vi.mocked(lib.runOrDiagnose).mock.calls[0]!;
    expect(call[0]).toEqual(expect.arrayContaining(['--replace=name=Alice', '--replace=company=Acme']));
    expect(call[1]).toEqual({ account: undefined });
  });

  it('passes --replacements, --parent, and --exact', async () => {
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacementsFile: '/tmp/r.json',
      parent: 'folder1',
      exact: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'slides', 'create-from-template', 'tpl1', 'Deck',
        '--replacements=/tmp/r.json',
        '--parent=folder1',
        '--exact',
      ],
      { account: undefined },
    );
  });

  it('omits --exact when false', async () => {
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      exact: false,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck'],
      { account: undefined },
    );
  });
});

describe('gog_slides_add_slide', () => {
  it('calls runOrDiagnose with presentationId and image', async () => {
    await handlers.get('gog_slides_add_slide')!({ presentationId: 'p1', image: '/tmp/img.png' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'add-slide', 'p1', '/tmp/img.png'],
      { account: undefined },
    );
  });

  it('passes --notes, --notes-file, and --before', async () => {
    await handlers.get('gog_slides_add_slide')!({
      presentationId: 'p1',
      image: '/tmp/img.png',
      notes: 'Speaker note',
      notesFile: '/tmp/notes.txt',
      before: 'slide5',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'slides', 'add-slide', 'p1', '/tmp/img.png',
        '--notes=Speaker note',
        '--notes-file=/tmp/notes.txt',
        '--before=slide5',
      ],
      { account: undefined },
    );
  });
});

describe('gog_slides_delete_slide', () => {
  it('calls runOrDiagnose with presentationId and slideId', async () => {
    await handlers.get('gog_slides_delete_slide')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'delete-slide', 'p1', 's1'],
      { account: undefined },
    );
  });
});

describe('gog_slides_update_notes', () => {
  it('calls runOrDiagnose with presentationId and slideId', async () => {
    await handlers.get('gog_slides_update_notes')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'update-notes', 'p1', 's1'],
      { account: undefined },
    );
  });

  it('passes --notes and --notes-file when provided', async () => {
    await handlers.get('gog_slides_update_notes')!({
      presentationId: 'p1',
      slideId: 's1',
      notes: 'speak clearly',
      notesFile: '/tmp/n.txt',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'slides', 'update-notes', 'p1', 's1',
        '--notes=speak clearly',
        '--notes-file=/tmp/n.txt',
      ],
      { account: undefined },
    );
  });
});

describe('gog_slides_replace_slide', () => {
  it('calls runOrDiagnose with presentationId, slideId, and image', async () => {
    await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p1',
      slideId: 's1',
      image: '/tmp/img.png',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'replace-slide', 'p1', 's1', '/tmp/img.png'],
      { account: undefined },
    );
  });

  it('passes --notes and --notes-file when provided', async () => {
    await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p1',
      slideId: 's1',
      image: '/tmp/img.png',
      notes: 'updated',
      notesFile: '/tmp/n.txt',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'slides', 'replace-slide', 'p1', 's1', '/tmp/img.png',
        '--notes=updated',
        '--notes-file=/tmp/n.txt',
      ],
      { account: undefined },
    );
  });
});
