import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraSlidesTools } from '../../src/tools/slides-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupHandlers, toText, type ToolHandler } from '../../../gogcli-mcp/tests/helpers/test-harness.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return {
    ...actual,
    runOrDiagnose: vi.fn(),
  };
});

let handlers: Map<string, ToolHandler>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lib.runOrDiagnose).mockResolvedValue(toText('{}'));
  handlers = setupHandlers(registerExtraSlidesTools);
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

// gog 0.23.0
describe('gog_slides_insert_image', () => {
  it('inserts an image with the required width', async () => {
    await handlers.get('gog_slides_insert_image')!({
      presentationId: 'p1', slideId: 's1', image: '/tmp/i.png', width: 200,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'insert-image', 'p1', 's1', '/tmp/i.png', '--width=200'],
      { account: undefined },
    );
  });

  it('passes height, position and unit', async () => {
    await handlers.get('gog_slides_insert_image')!({
      presentationId: 'p1', slideId: 's1', image: '/tmp/i.png', width: 200, height: 100, x: 50, y: 60, unit: 'PT', account: 'a@b.com',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'insert-image', 'p1', 's1', '/tmp/i.png', '--width=200', '--height=100', '--x=50', '--y=60', '--unit=PT'],
      { account: 'a@b.com' },
    );
  });
});

// ===========================================================================
// gog 0.29 native authoring (PR3a): reads, slide mgmt, text, shapes/lines
// ===========================================================================

describe('gog_slides_insert_image url mode', () => {
  it('inserts from a public URL with width and height', async () => {
    await handlers.get('gog_slides_insert_image')!({
      presentationId: 'p1', slideId: 's1', url: 'https://x.test/i.png', width: 200, height: 100,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'insert-image', 'p1', 's1', '--width=200', '--url=https://x.test/i.png', '--height=100'],
      { account: undefined },
    );
  });
});

describe('gog_slides_replace_slide url mode', () => {
  it('replaces from a public URL', async () => {
    await handlers.get('gog_slides_replace_slide')!({
      presentationId: 'p1', slideId: 's1', url: 'https://x.test/i.png', notes: 'n',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'replace-slide', 'p1', 's1', '--url=https://x.test/i.png', '--notes=n'],
      { account: undefined },
    );
  });
});

describe('gog_slides_raw', () => {
  it('passes --pretty', async () => {
    await handlers.get('gog_slides_raw')!({ presentationId: 'p1', pretty: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'raw', 'p1', '--pretty'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_raw')!({ presentationId: 'p1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'raw', 'p1'], { account: undefined });
  });
});

describe('gog_slides_locate', () => {
  it('passes all filters', async () => {
    await handlers.get('gog_slides_locate')!({
      presentationId: 'p1', text: 'hi', page: 'sl1', occurrence: 2, all: true, matchCase: true, failEmpty: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'locate', 'p1', 'hi', '--page=sl1', '--occurrence=2', '--all', '--match-case', '--fail-empty'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_locate')!({ presentationId: 'p1', text: 'hi' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'locate', 'p1', 'hi'], { account: undefined });
  });
});

describe('gog_slides_thumbnail', () => {
  it('passes format, size, out and overwrite', async () => {
    await handlers.get('gog_slides_thumbnail')!({
      presentationId: 'p1', slideId: 's1', format: 'png', size: 'large', out: '/tmp/t.png', overwrite: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'thumbnail', 'p1', 's1', '--format=png', '--size=large', '--out=/tmp/t.png', '--overwrite'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_thumbnail')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'thumbnail', 'p1', 's1'], { account: undefined });
  });
});

describe('gog_slides_new_slide', () => {
  it('passes layout and index', async () => {
    await handlers.get('gog_slides_new_slide')!({ presentationId: 'p1', layout: 'TITLE_AND_BODY', index: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'new-slide', 'p1', '--layout=TITLE_AND_BODY', '--index=2'],
      { account: undefined },
    );
  });
  it('passes layoutId', async () => {
    await handlers.get('gog_slides_new_slide')!({ presentationId: 'p1', layoutId: 'LAY1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'new-slide', 'p1', '--layout-id=LAY1'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_new_slide')!({ presentationId: 'p1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'new-slide', 'p1'], { account: undefined });
  });
});

describe('gog_slides_duplicate_slide', () => {
  it('passes --to-index', async () => {
    await handlers.get('gog_slides_duplicate_slide')!({ presentationId: 'p1', slideId: 's1', toIndex: 3 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'duplicate-slide', 'p1', 's1', '--to-index=3'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_duplicate_slide')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'duplicate-slide', 'p1', 's1'], { account: undefined });
  });
});

describe('gog_slides_move_slide', () => {
  it('passes required --to-index', async () => {
    await handlers.get('gog_slides_move_slide')!({ presentationId: 'p1', slideId: 's1', toIndex: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'move-slide', 'p1', 's1', '--to-index=0'], { account: undefined });
  });
});

describe('gog_slides_insert_text', () => {
  it('passes cell targeting, insertion index and replace', async () => {
    await handlers.get('gog_slides_insert_text')!({
      presentationId: 'p1', objectId: 'o1', text: 'hi', row: 0, col: 1, insertionIndex: 2, replace: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'insert-text', 'p1', 'o1', 'hi', '--row=0', '--col=1', '--insertion-index=2', '--replace'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_insert_text')!({ presentationId: 'p1', objectId: 'o1', text: 'hi' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'insert-text', 'p1', 'o1', 'hi'], { account: undefined });
  });
});

describe('gog_slides_style_text', () => {
  it('passes every styling flag', async () => {
    await handlers.get('gog_slides_style_text')!({
      presentationId: 'p1', objectId: 'o1', range: '0:5', font: 'Arial', size: 18, textColor: '#ff0000',
      bold: true, noBold: true, italic: true, noItalic: true, underline: true, noUnderline: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'style-text', 'p1', 'o1', '--range=0:5', '--font=Arial', '--size=18', '--text-color=#ff0000',
        '--bold', '--no-bold', '--italic', '--no-italic', '--underline', '--no-underline'],
      { account: undefined },
    );
  });
  it('minimal (range only)', async () => {
    await handlers.get('gog_slides_style_text')!({ presentationId: 'p1', objectId: 'o1', range: '0:5' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'style-text', 'p1', 'o1', '--range=0:5'], { account: undefined });
  });
});

describe('gog_slides_link', () => {
  it('applies a url', async () => {
    await handlers.get('gog_slides_link')!({ presentationId: 'p1', objectId: 'o1', range: '0:5', url: 'https://x.test' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'link', 'p1', 'o1', '--range=0:5', '--url=https://x.test'], { account: undefined });
  });
  it('clears the link', async () => {
    await handlers.get('gog_slides_link')!({ presentationId: 'p1', objectId: 'o1', range: '0:5', clear: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'link', 'p1', 'o1', '--range=0:5', '--clear'], { account: undefined });
  });
});

describe('gog_slides_bullets', () => {
  it('turns bullets on with a preset', async () => {
    await handlers.get('gog_slides_bullets')!({ presentationId: 'p1', objectId: 'o1', range: '0:5', on: true, preset: 'BULLET_DISC_CIRCLE_SQUARE' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'bullets', 'p1', 'o1', '--range=0:5', '--on', '--preset=BULLET_DISC_CIRCLE_SQUARE'], { account: undefined });
  });
  it('turns bullets off', async () => {
    await handlers.get('gog_slides_bullets')!({ presentationId: 'p1', objectId: 'o1', range: '0:5', off: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'bullets', 'p1', 'o1', '--range=0:5', '--off'], { account: undefined });
  });
});

describe('gog_slides_replace_text', () => {
  it('scopes to a single object', async () => {
    await handlers.get('gog_slides_replace_text')!({ presentationId: 'p1', find: 'a', replacement: 'b', object: 'o1', matchCase: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'replace-text', 'p1', 'a', 'b', '--object=o1', '--match-case'], { account: undefined });
  });
  it('scopes to specific pages (repeatable)', async () => {
    await handlers.get('gog_slides_replace_text')!({ presentationId: 'p1', find: 'a', replacement: 'b', pages: ['s1', 's2'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'replace-text', 'p1', 'a', 'b', '--page=s1', '--page=s2'], { account: undefined });
  });
  it('scopes to the whole presentation', async () => {
    await handlers.get('gog_slides_replace_text')!({ presentationId: 'p1', find: 'a', replacement: 'b', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'replace-text', 'p1', 'a', 'b', '--all'], { account: undefined });
  });
});

describe('gog_slides_element_create_shape', () => {
  it('passes type, geometry and object id', async () => {
    await handlers.get('gog_slides_element_create_shape')!({
      presentationId: 'p1', slideId: 's1', type: 'RECTANGLE', x: 10, y: 20, width: 100, height: 50, unit: 'PT', objectId: 'shape1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'create-shape', 'p1', 's1', '--type=RECTANGLE', '--x=10', '--y=20', '--width=100', '--height=50', '--unit=PT', '--object-id=shape1'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_element_create_shape')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'create-shape', 'p1', 's1'], { account: undefined });
  });
});

describe('gog_slides_element_create_line', () => {
  it('passes category, geometry and object id', async () => {
    await handlers.get('gog_slides_element_create_line')!({
      presentationId: 'p1', slideId: 's1', category: 'BENT', x: 10, y: 20, width: 100, height: 50, unit: 'EMU', objectId: 'line1',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'create-line', 'p1', 's1', '--category=BENT', '--x=10', '--y=20', '--width=100', '--height=50', '--unit=EMU', '--object-id=line1'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_element_create_line')!({ presentationId: 'p1', slideId: 's1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'create-line', 'p1', 's1'], { account: undefined });
  });
});

describe('gog_slides_element_style', () => {
  it('passes fill, outline and dash flags', async () => {
    await handlers.get('gog_slides_element_style')!({
      presentationId: 'p1', objectId: 'o1', kind: 'shape', fillColor: '#fff', fillTransparent: true,
      outlineColor: '#000', outlineWeight: 2, outlineDash: 'DASH', outlineTransparent: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'style', 'p1', 'o1', '--kind=shape', '--fill-color=#fff', '--fill-transparent',
        '--outline-color=#000', '--outline-weight=2', '--outline-dash=DASH', '--outline-transparent'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_element_style')!({ presentationId: 'p1', objectId: 'o1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'style', 'p1', 'o1'], { account: undefined });
  });
});

describe('gog_slides_element_transform', () => {
  it('passes translate, scale, shear, rotate, apply-mode and unit', async () => {
    await handlers.get('gog_slides_element_transform')!({
      presentationId: 'p1', objectId: 'o1', translateX: 10, translateY: 20, scaleX: 1.5, scaleY: 2,
      shearX: 0.1, shearY: 0.2, rotate: 45, applyMode: 'ABSOLUTE', unit: 'PT',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'transform', 'p1', 'o1', '--translate-x=10', '--translate-y=20', '--scale-x=1.5', '--scale-y=2',
        '--shear-x=0.1', '--shear-y=0.2', '--rotate=45', '--apply-mode=ABSOLUTE', '--unit=PT'],
      { account: undefined },
    );
  });
  it('bare', async () => {
    await handlers.get('gog_slides_element_transform')!({ presentationId: 'p1', objectId: 'o1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'transform', 'p1', 'o1'], { account: undefined });
  });
});

describe('gog_slides_element_z_order', () => {
  it('passes the operation', async () => {
    await handlers.get('gog_slides_element_z_order')!({ presentationId: 'p1', objectId: 'o1', operation: 'BRING_TO_FRONT' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'z-order', 'p1', 'o1', '--operation=BRING_TO_FRONT'], { account: undefined });
  });
});

describe('gog_slides_element_group', () => {
  it('groups elements with a group id', async () => {
    await handlers.get('gog_slides_element_group')!({ presentationId: 'p1', objectIds: ['o1', 'o2', 'o3'], groupId: 'g1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'group', 'p1', 'o1', 'o2', 'o3', '--group-id=g1'], { account: undefined });
  });
  it('groups elements without a group id', async () => {
    await handlers.get('gog_slides_element_group')!({ presentationId: 'p1', objectIds: ['o1', 'o2'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'group', 'p1', 'o1', 'o2'], { account: undefined });
  });
});

describe('gog_slides_element_ungroup', () => {
  it('ungroups groups', async () => {
    await handlers.get('gog_slides_element_ungroup')!({ presentationId: 'p1', groupIds: ['g1', 'g2'] });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'ungroup', 'p1', 'g1', 'g2'], { account: undefined });
  });
});

describe('gog_slides_element_alt_text', () => {
  it('sets title and description', async () => {
    await handlers.get('gog_slides_element_alt_text')!({ presentationId: 'p1', objectId: 'o1', title: 'T', description: 'D' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'alt-text', 'p1', 'o1', '--title=T', '--description=D'], { account: undefined });
  });
  it('clears both fields with empty strings', async () => {
    await handlers.get('gog_slides_element_alt_text')!({ presentationId: 'p1', objectId: 'o1', title: '', description: '' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'element', 'alt-text', 'p1', 'o1', '--title=', '--description='], { account: undefined });
  });
  it('bare leaves both untouched', async () => {
    await handlers.get('gog_slides_element_alt_text')!({ presentationId: 'p1', objectId: 'o1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'alt-text', 'p1', 'o1'], { account: undefined });
  });
});

describe('gog_slides_element_delete', () => {
  it('deletes an element', async () => {
    await handlers.get('gog_slides_element_delete')!({ presentationId: 'p1', objectId: 'o1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['slides', 'element', 'delete', 'p1', 'o1'], { account: undefined });
  });
});

// ===========================================================================
// gog 0.29 native tables (PR3b)
// ===========================================================================

describe('gog_slides_table_create', () => {
  it('passes rows, cols and object id', async () => {
    await handlers.get('gog_slides_table_create')!({ presentationId: 'p1', slideId: 's1', rows: 3, cols: 4, objectId: 'tbl1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'create', 'p1', 's1', '--rows=3', '--cols=4', '--object-id=tbl1'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_table_create')!({ presentationId: 'p1', slideId: 's1', rows: 2, cols: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'create', 'p1', 's1', '--rows=2', '--cols=2'], { account: undefined });
  });
});

describe('gog_slides_table_cell_style', () => {
  it('passes fill, alignment, range and text styling', async () => {
    await handlers.get('gog_slides_table_cell_style')!({
      presentationId: 'p1', tableObjectId: 't1', row: 0, col: 1, range: '0:3', fillColor: '#eee', fillTransparent: true,
      contentAlign: 'MIDDLE', font: 'Arial', size: 12, textColor: '#111',
      bold: true, noBold: true, italic: true, noItalic: true, underline: true, noUnderline: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'cell', 'style', 'p1', 't1', '--row=0', '--col=1', '--range=0:3', '--fill-color=#eee', '--fill-transparent',
        '--content-align=MIDDLE', '--font=Arial', '--size=12', '--text-color=#111',
        '--bold', '--no-bold', '--italic', '--no-italic', '--underline', '--no-underline'],
      { account: undefined },
    );
  });
  it('minimal (row/col only)', async () => {
    await handlers.get('gog_slides_table_cell_style')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, col: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'cell', 'style', 'p1', 't1', '--row=0', '--col=0'], { account: undefined });
  });
});

describe('gog_slides_table_border_style', () => {
  it('passes span, position, color, weight, dash and transparent', async () => {
    await handlers.get('gog_slides_table_border_style')!({
      presentationId: 'p1', tableObjectId: 't1', row: 0, col: 0, rowSpan: 2, colSpan: 2,
      position: 'OUTER', borderColor: '#000', weight: 2, dash: 'DASH', transparent: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'border', 'style', 'p1', 't1', '--row=0', '--col=0', '--row-span=2', '--col-span=2',
        '--position=OUTER', '--border-color=#000', '--weight=2', '--dash=DASH', '--transparent'],
      { account: undefined },
    );
  });
  it('minimal (row/col only)', async () => {
    await handlers.get('gog_slides_table_border_style')!({ presentationId: 'p1', tableObjectId: 't1', row: 1, col: 1 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'border', 'style', 'p1', 't1', '--row=1', '--col=1'], { account: undefined });
  });
});

describe('gog_slides_table_column_insert', () => {
  it('passes count and --right', async () => {
    await handlers.get('gog_slides_table_column_insert')!({ presentationId: 'p1', tableObjectId: 't1', col: 1, count: 2, right: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'column', 'insert', 'p1', 't1', '--col=1', '--count=2', '--right'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_table_column_insert')!({ presentationId: 'p1', tableObjectId: 't1', col: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'column', 'insert', 'p1', 't1', '--col=0'], { account: undefined });
  });
});

describe('gog_slides_table_column_delete', () => {
  it('deletes by column index', async () => {
    await handlers.get('gog_slides_table_column_delete')!({ presentationId: 'p1', tableObjectId: 't1', col: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'column', 'delete', 'p1', 't1', '--col=2'], { account: undefined });
  });
});

describe('gog_slides_table_column_size', () => {
  it('sets column width', async () => {
    await handlers.get('gog_slides_table_column_size')!({ presentationId: 'p1', tableObjectId: 't1', col: 1, width: 120 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'column', 'size', 'p1', 't1', '--col=1', '--width=120'], { account: undefined });
  });
});

describe('gog_slides_table_row_insert', () => {
  it('passes count and --below', async () => {
    await handlers.get('gog_slides_table_row_insert')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, count: 1, below: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'row', 'insert', 'p1', 't1', '--row=0', '--count=1', '--below'], { account: undefined });
  });
  it('bare', async () => {
    await handlers.get('gog_slides_table_row_insert')!({ presentationId: 'p1', tableObjectId: 't1', row: 1 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'row', 'insert', 'p1', 't1', '--row=1'], { account: undefined });
  });
});

describe('gog_slides_table_row_delete', () => {
  it('deletes by row index', async () => {
    await handlers.get('gog_slides_table_row_delete')!({ presentationId: 'p1', tableObjectId: 't1', row: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'row', 'delete', 'p1', 't1', '--row=2'], { account: undefined });
  });
});

describe('gog_slides_table_row_size', () => {
  it('sets row min height', async () => {
    await handlers.get('gog_slides_table_row_size')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, height: 40 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'row', 'size', 'p1', 't1', '--row=0', '--height=40'], { account: undefined });
  });
});

describe('gog_slides_table_merge', () => {
  it('passes span', async () => {
    await handlers.get('gog_slides_table_merge')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, col: 0, rowSpan: 2, colSpan: 3 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'merge', 'p1', 't1', '--row=0', '--col=0', '--row-span=2', '--col-span=3'], { account: undefined });
  });
  it('minimal', async () => {
    await handlers.get('gog_slides_table_merge')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, col: 0 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'merge', 'p1', 't1', '--row=0', '--col=0'], { account: undefined });
  });
});

describe('gog_slides_table_unmerge', () => {
  it('passes span', async () => {
    await handlers.get('gog_slides_table_unmerge')!({ presentationId: 'p1', tableObjectId: 't1', row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'unmerge', 'p1', 't1', '--row=0', '--col=0', '--row-span=2', '--col-span=2'], { account: undefined });
  });
  it('minimal', async () => {
    await handlers.get('gog_slides_table_unmerge')!({ presentationId: 'p1', tableObjectId: 't1', row: 1, col: 1 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['slides', 'table', 'unmerge', 'p1', 't1', '--row=1', '--col=1'], { account: undefined });
  });
});
