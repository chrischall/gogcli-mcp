import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSlidesTools } from '../../src/tools/slides.js';
import * as runner from '../../src/runner.js';

vi.mock('../../src/runner.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setupHandlers(): Map<string, ToolHandler> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name, _config, cb) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerSlidesTools(server);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe('gog_slides_export', () => {
  it('calls run with presentationId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_export')!({ presentationId: 'p1' });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'export', 'p1'], { account: undefined });
  });

  it('passes --out and --format when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_export')!({ presentationId: 'p1', out: '/tmp/out.pdf', format: 'pdf' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'export', 'p1', '--out=/tmp/out.pdf', '--format=pdf'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Export failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_export')!({ presentationId: 'bad' });
    expect(result.content[0].text).toBe('Error: Export failed');
  });
});

describe('gog_slides_info', () => {
  it('calls run with presentationId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_info')!({ presentationId: 'p1' });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'info', 'p1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Info failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_info')!({ presentationId: 'bad' });
    expect(result.content[0].text).toBe('Error: Info failed');
  });
});

describe('gog_slides_create', () => {
  it('calls run with title only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create')!({ title: 'My Deck' });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'create', 'My Deck'], { account: undefined });
  });

  it('passes --parent and --template when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create')!({ title: 'My Deck', parent: 'folder1', template: 'tpl1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create', 'My Deck', '--parent=folder1', '--template=tpl1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_create')!({ title: 'x' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_slides_create_from_markdown', () => {
  it('calls run with title only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_markdown')!({ title: 'Deck' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create-from-markdown', 'Deck'],
      { account: undefined },
    );
  });

  it('passes all optional flags', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_markdown')!({
      title: 'Deck',
      content: '# Slide 1',
      contentFile: '/tmp/deck.md',
      parent: 'folder1',
      debug: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
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
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_markdown')!({ title: 'Deck', debug: false });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create-from-markdown', 'Deck'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Markdown failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_create_from_markdown')!({ title: 'x' });
    expect(result.content[0].text).toBe('Error: Markdown failed');
  });
});

describe('gog_slides_create_from_template', () => {
  it('calls run with templateId and title only', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_template')!({ templateId: 'tpl1', title: 'Deck' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck'],
      { account: undefined },
    );
  });

  it('passes --replace for a single replacement entry', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacements: { name: 'Alice' },
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck', '--replace=name=Alice'],
      { account: undefined },
    );
  });

  it('passes --replace for each entry in replacements', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacements: { name: 'Alice', company: 'Acme' },
    });
    const call = vi.mocked(runner.run).mock.calls[0]!;
    expect(call[0]).toEqual(expect.arrayContaining(['--replace=name=Alice', '--replace=company=Acme']));
    expect(call[1]).toEqual({ account: undefined });
  });

  it('passes --replacements, --parent, and --exact', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_template')!({
      templateId: 'tpl1',
      title: 'Deck',
      replacementsFile: '/tmp/r.json',
      parent: 'folder1',
      exact: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
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
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create_from_template')!({ templateId: 'tpl1', title: 'Deck', exact: false });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create-from-template', 'tpl1', 'Deck'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Template failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_create_from_template')!({ templateId: 't', title: 'x' });
    expect(result.content[0].text).toBe('Error: Template failed');
  });
});

describe('gog_slides_copy', () => {
  it('calls run with presentationId and title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_copy')!({ presentationId: 'p1', title: 'Copy' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'copy', 'p1', 'Copy'],
      { account: undefined },
    );
  });

  it('passes --parent when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_copy')!({ presentationId: 'p1', title: 'Copy', parent: 'folder1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'copy', 'p1', 'Copy', '--parent=folder1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Copy failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_copy')!({ presentationId: 'p', title: 'x' });
    expect(result.content[0].text).toBe('Error: Copy failed');
  });
});

describe('gog_slides_add_slide', () => {
  it('calls run with presentationId and image', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_add_slide')!({ presentationId: 'p1', image: '/tmp/img.png' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'add-slide', 'p1', '/tmp/img.png'],
      { account: undefined },
    );
  });

  it('passes --notes, --notes-file, and --before', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_add_slide')!({
      presentationId: 'p1',
      image: '/tmp/img.png',
      notes: 'Speaker note',
      notesFile: '/tmp/notes.txt',
      before: 'slide5',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'slides', 'add-slide', 'p1', '/tmp/img.png',
        '--notes=Speaker note',
        '--notes-file=/tmp/notes.txt',
        '--before=slide5',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Add failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_add_slide')!({ presentationId: 'p', image: 'i' });
    expect(result.content[0].text).toBe('Error: Add failed');
  });
});

describe('gog_slides_list_slides', () => {
  it('calls run with presentationId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_list_slides')!({ presentationId: 'p1' });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'list-slides', 'p1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('List failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_list_slides')!({ presentationId: 'bad' });
    expect(result.content[0].text).toBe('Error: List failed');
  });
});

describe('gog_slides_delete_slide', () => {
  it('calls run with presentationId and slideId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_delete_slide')!({ presentationId: 'p1', slideId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'delete-slide', 'p1', 's1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Delete failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_delete_slide')!({ presentationId: 'p', slideId: 's' });
    expect(result.content[0].text).toBe('Error: Delete failed');
  });
});

describe('gog_slides_read_slide', () => {
  it('calls run with presentationId and slideId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_read_slide')!({ presentationId: 'p1', slideId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'read-slide', 'p1', 's1'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Read failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_read_slide')!({ presentationId: 'p', slideId: 's' });
    expect(result.content[0].text).toBe('Error: Read failed');
  });
});

describe('gog_slides_update_notes', () => {
  it('calls run with presentationId and slideId', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_update_notes')!({ presentationId: 'p1', slideId: 's1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'update-notes', 'p1', 's1'],
      { account: undefined },
    );
  });

  it('passes --notes and --notes-file when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_update_notes')!({
      presentationId: 'p1',
      slideId: 's1',
      notes: 'speak clearly',
      notesFile: '/tmp/n.txt',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'slides', 'update-notes', 'p1', 's1',
        '--notes=speak clearly',
        '--notes-file=/tmp/n.txt',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Notes failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_update_notes')!({ presentationId: 'p', slideId: 's' });
    expect(result.content[0].text).toBe('Error: Notes failed');
  });
});

describe('gog_slides_replace_slide', () => {
  it('calls run with presentationId, slideId, and image', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p1',
      slideId: 's1',
      image: '/tmp/img.png',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'replace-slide', 'p1', 's1', '/tmp/img.png'],
      { account: undefined },
    );
  });

  it('passes --notes and --notes-file when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p1',
      slideId: 's1',
      image: '/tmp/img.png',
      notes: 'updated',
      notesFile: '/tmp/n.txt',
    });
    expect(runner.run).toHaveBeenCalledWith(
      [
        'slides', 'replace-slide', 'p1', 's1', '/tmp/img.png',
        '--notes=updated',
        '--notes-file=/tmp/n.txt',
      ],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Replace failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p',
      slideId: 's',
      image: 'i',
    });
    expect(result.content[0].text).toBe('Error: Replace failed');
  });
});

describe('gog_slides_run', () => {
  it('passes subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_run')!({ subcommand: 'info', args: ['p1'] });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'info', 'p1'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const handlers = setupHandlers();
    const result = await handlers.get('gog_slides_run')!({ subcommand: 'info', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
