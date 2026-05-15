import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSlidesTools } from '../../src/tools/slides.js';
import * as runner from '../../src/runner.js';
import { setupHandlers as setupHandlersBase, type ToolHandler } from '../helpers/test-harness.js';

vi.mock('../../src/runner.js');

const setupHandlers = () => setupHandlersBase(registerSlidesTools);

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
    await handlers.get('gog_slides_export')!({ presentationId: 'p1', out: '/tmp/deck.pdf', format: 'pdf' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'export', 'p1', '--out=/tmp/deck.pdf', '--format=pdf'],
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
    await handlers.get('gog_slides_create')!({ title: 'Deck' });
    expect(runner.run).toHaveBeenCalledWith(['slides', 'create', 'Deck'], { account: undefined });
  });

  it('passes --parent and --template when provided', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const handlers = setupHandlers();
    await handlers.get('gog_slides_create')!({ title: 'Deck', parent: 'folder1', template: 'tpl1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['slides', 'create', 'Deck', '--parent=folder1', '--template=tpl1'],
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
