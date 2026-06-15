import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerExtraContactsTools } from '../../src/tools/contacts-extra.js';
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
  handlers = setupHandlers(registerExtraContactsTools);
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

describe('gog_contacts_update', () => {
  it('calls runOrDiagnose with just resourceName', async () => {
    await handlers.get('gog_contacts_update')!({ resourceName: 'people/c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'update', 'people/c1'], { account: undefined });
  });

  it('passes all fields including empty-string clears', async () => {
    await handlers.get('gog_contacts_update')!({
      resourceName: 'people/c1',
      given: 'Ada',
      family: 'Lovelace',
      email: '',
      phone: '+1',
      org: 'Analytical',
      title: 'Engineer',
      url: 'https://a.com',
      note: 'hi',
      address: '1 St;City',
      birthday: '1815-12-10',
      ignoreEtag: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      [
        'contacts', 'update', 'people/c1',
        '--given=Ada', '--family=Lovelace', '--email=', '--phone=+1',
        '--org=Analytical', '--title=Engineer', '--url=https://a.com',
        '--note=hi', '--address=1 St;City', '--birthday=1815-12-10', '--ignore-etag',
      ],
      { account: undefined },
    );
  });

  it('omits --ignore-etag when false', async () => {
    await handlers.get('gog_contacts_update')!({ resourceName: 'people/c1', ignoreEtag: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'update', 'people/c1'], { account: undefined });
  });
});

describe('gog_contacts_delete', () => {
  it('calls runOrDiagnose with resourceName', async () => {
    await handlers.get('gog_contacts_delete')!({ resourceName: 'people/c1' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'delete', 'people/c1'], { account: undefined });
  });
});

describe('gog_contacts_export', () => {
  it('calls runOrDiagnose with no options', async () => {
    await handlers.get('gog_contacts_export')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'export'], { account: undefined });
  });

  it('passes selector and all flags', async () => {
    await handlers.get('gog_contacts_export')!({
      selector: 'people/c1',
      query: 'ada',
      all: true,
      out: 'out.vcf',
      max: 10,
      page: 'tok',
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'export', 'people/c1', '--query=ada', '--all', '--out=out.vcf', '--max=10', '--page=tok'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_contacts_export')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'export'], { account: undefined });
  });
});

describe('gog_contacts_dedupe', () => {
  it('calls runOrDiagnose with no options', async () => {
    await handlers.get('gog_contacts_dedupe')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'dedupe'], { account: undefined });
  });

  it('passes --match and --max', async () => {
    await handlers.get('gog_contacts_dedupe')!({ match: 'name', max: 100 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'dedupe', '--match=name', '--max=100'],
      { account: undefined },
    );
  });

  it('passes --apply, repeatable --resource, and --fail-empty', async () => {
    await handlers.get('gog_contacts_dedupe')!({
      apply: true,
      resource: ['people/c1', 'people/c2'],
      failEmpty: true,
    });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'dedupe', '--resource=people/c1', '--resource=people/c2', '--apply', '--fail-empty'],
      { account: undefined },
    );
  });

  it('omits --apply and --fail-empty when false', async () => {
    await handlers.get('gog_contacts_dedupe')!({ apply: false, failEmpty: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'dedupe'], { account: undefined });
  });
});

describe('gog_contacts_directory_list', () => {
  it('calls runOrDiagnose with no options', async () => {
    await handlers.get('gog_contacts_directory_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'directory', 'list'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_contacts_directory_list')!({ max: 50, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'directory', 'list', '--max=50', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_contacts_directory_list')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'directory', 'list'], { account: undefined });
  });
});

describe('gog_contacts_other_list', () => {
  it('calls runOrDiagnose with no options', async () => {
    await handlers.get('gog_contacts_other_list')!({});
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'other', 'list'], { account: undefined });
  });

  it('passes pagination flags', async () => {
    await handlers.get('gog_contacts_other_list')!({ max: 100, page: 'tok', all: true });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'other', 'list', '--max=100', '--page=tok', '--all'],
      { account: undefined },
    );
  });

  it('omits --all when false', async () => {
    await handlers.get('gog_contacts_other_list')!({ all: false });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'other', 'list'], { account: undefined });
  });
});

describe('gog_contacts_other_search', () => {
  it('calls runOrDiagnose with query', async () => {
    await handlers.get('gog_contacts_other_search')!({ query: 'ada' });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(['contacts', 'other', 'search', 'ada'], { account: undefined });
  });

  it('passes --max when provided', async () => {
    await handlers.get('gog_contacts_other_search')!({ query: 'ada', max: 25 });
    expect(lib.runOrDiagnose).toHaveBeenCalledWith(
      ['contacts', 'other', 'search', 'ada', '--max=25'],
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
