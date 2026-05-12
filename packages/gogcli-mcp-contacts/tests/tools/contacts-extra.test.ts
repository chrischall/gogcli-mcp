import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraContactsTools } from '../../src/tools/contacts-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { setupExtrasHandlers, toText, type ToolHandler } from '../../../gogcli-mcp/tests/helpers/extras-harness.js';

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
  handlers = setupExtrasHandlers(registerExtraContactsTools);
});

describe('gog_people_me', () => {
  it('calls runOrDiagnose with people me', async () => {
    await handlers.get('gog_people_me')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'me'], { account: undefined });
  });

  it('forwards account', async () => {
    await handlers.get('gog_people_me')!({ account: 'a@b.com' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'me'], { account: 'a@b.com' });
  });
});

describe('gog_people_get', () => {
  it('calls runOrDiagnose with userId', async () => {
    await handlers.get('gog_people_get')!({ userId: 'people/c123' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'get', 'people/c123'], { account: undefined });
  });
});

describe('gog_people_search', () => {
  it('calls runOrDiagnose with query', async () => {
    await handlers.get('gog_people_search')!({ query: 'alice' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'search', 'alice'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_people_search')!({ query: 'alice', max: 100, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['people', 'search', 'alice', '--max=100', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_people_search')!({ query: 'x', all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'search', 'x'], { account: undefined });
  });
});

describe('gog_people_relations', () => {
  it('calls runOrDiagnose with no userId', async () => {
    await handlers.get('gog_people_relations')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'relations'], { account: undefined });
  });

  it('passes userId and --type when provided', async () => {
    await handlers.get('gog_people_relations')!({ userId: 'people/c123', type: 'manager' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['people', 'relations', 'people/c123', '--type=manager'],
      { account: undefined },
    );
  });
});

describe('gog_people_raw', () => {
  it('calls runOrDiagnose with userId', async () => {
    await handlers.get('gog_people_raw')!({ userId: 'people/c123' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'raw', 'people/c123'], { account: undefined });
  });

  it('passes --person-fields and --pretty when provided', async () => {
    await handlers.get('gog_people_raw')!({
      userId: 'people/c123',
      personFields: 'names,emailAddresses',
      pretty: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['people', 'raw', 'people/c123', '--person-fields=names,emailAddresses', '--pretty'],
      { account: undefined },
    );
  });

  it('omits --pretty when false', async () => {
    await handlers.get('gog_people_raw')!({ userId: 'people/c123', pretty: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['people', 'raw', 'people/c123'], { account: undefined });
  });
});
