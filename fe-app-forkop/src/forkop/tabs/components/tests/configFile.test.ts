import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloads = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../../../../helpers/downloadFile', () => downloads);

import {
  configImportApi,
  configText,
  downloadConfig,
  exportFileName,
  refusalMessage,
  renderImportDialog,
  UPLOAD_PATH,
} from '../configFile';
import type { ImportCheck } from '../configFile';

interface FakeNode {
  type: string;
  attrs: Record<string, unknown>;
  children: Array<FakeNode | string>;
}

function fakeNode(type: string, attrs?: unknown, children?: unknown): FakeNode {
  return {
    type,
    attrs: (attrs || {}) as Record<string, unknown>,
    children:
      children === undefined
        ? []
        : Array.isArray(children)
          ? (children as Array<FakeNode | string>)
          : [children as FakeNode | string],
  };
}

const textOf = (node: FakeNode | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const globals = globalThis as unknown as Record<string, unknown>;
const fs = { exec: vi.fn(), remove: vi.fn() };
const fetchMock = vi.fn();
const rpcCall = vi.fn();
const rpcDeclare = vi.fn(() => rpcCall);

beforeEach(() => {
  globals.E = fakeNode;
  globals.L = { env: { sessionid: 'page-session', cgi_base: '/cgi-bin' } };
  globals.fs = fs;
  globals.fetch = fetchMock;
  globals.rpc = { declare: rpcDeclare };
  globals.uci = {
    load: vi.fn(() => Promise.resolve(['system'])),
    get_first: vi.fn(() => 'Home Router'),
  };
  fs.exec.mockReset();
  fs.remove.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  rpcCall.mockReset();
  rpcDeclare.mockClear();
  downloads.downloadFile.mockReset();
});

describe('the downloaded file', () => {
  it('is named by the router and the day, as LuCI names its backup', () => {
    const day = new Date(2026, 9, 7);
    expect(exportFileName('OpenWrt', day)).toBe(
      'forkop-OpenWrt-2026-10-07.conf',
    );
    expect(exportFileName('Home Router', day)).toBe(
      'forkop-Home_Router-2026-10-07.conf',
    );
    expect(exportFileName(' ', day)).toBe('forkop-2026-10-07.conf');
  });

  it('holds the configuration as the router keeps it', async () => {
    fs.exec.mockResolvedValue({
      stdout: "config settings 'settings'\n",
      code: 0,
    });
    await downloadConfig();
    expect(fs.exec).toHaveBeenCalledWith('/usr/bin/forkop', [
      'show_config',
      'raw',
    ]);
    expect(downloads.downloadFile).toHaveBeenCalledWith(
      "config settings 'settings'\n",
      expect.stringMatching(/^forkop-Home_Router-\d{4}-\d{2}-\d{2}\.conf$/),
    );
  });

  it('is not offered when the router cannot read the configuration', async () => {
    fs.exec.mockResolvedValue({
      stdout: '',
      stderr: 'Configuration file not found\n',
      code: 1,
    });
    await expect(downloadConfig()).rejects.toThrow(
      'Configuration file not found',
    );
    expect(downloads.downloadFile).not.toHaveBeenCalled();
  });
});

describe('an uploaded file', () => {
  const BOM = String.fromCharCode(0xfeff);

  it('loses what an editor on Windows adds: a byte order mark and CRLF line ends', () => {
    const saved =
      "config section 'main'\r\n\toption domain 'a.example\r\nb.example'\r\n";
    expect(configText(BOM + saved)).toBe(
      "config section 'main'\n\toption domain 'a.example\nb.example'\n",
    );
    expect(configText('config x\n')).toBe('config x\n');
  });

  it('reaches the state service through cgi-upload, which stages in the session of the page', async () => {
    rpcCall.mockResolvedValue({ success: true, changed: false });
    const reply = await configImportApi.check('config text');

    expect(reply).toEqual({ success: true, changed: false });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/cgi-bin/cgi-upload');
    const form = request.body as FormData;
    expect([...form.keys()]).toEqual(['sessionid', 'filename', 'filedata']);
    expect(form.get('sessionid')).toBe('page-session');
    expect(form.get('filename')).toBe(UPLOAD_PATH);
    expect(await (form.get('filedata') as Blob).text()).toBe('config text');
    expect(rpcDeclare).toHaveBeenCalledWith({
      object: 'forkop',
      method: 'import_config',
      params: ['stage'],
      nobatch: true,
    });
    expect(rpcCall).toHaveBeenCalledWith(false);
    expect(fs.remove).toHaveBeenCalledWith(UPLOAD_PATH);
  });

  it('is removed from the router whatever the state service answered', async () => {
    rpcCall.mockRejectedValue(new Error('XHR request timed out'));
    await expect(configImportApi.stage('config text')).rejects.toThrow(
      'Failed to load the configuration: XHR request timed out',
    );
    expect(rpcCall).toHaveBeenCalledWith(true);
    expect(fs.remove).toHaveBeenCalledWith(UPLOAD_PATH);
  });

  it('goes no further when the router refuses the upload', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Upload permission denied\n'),
    });
    await expect(configImportApi.check('config text')).rejects.toThrow(
      'Failed to upload the file: Upload permission denied',
    );
    expect(rpcCall).not.toHaveBeenCalled();
  });
});

describe('a refused file', () => {
  const refusal = (reason: string, extra: Record<string, string> = {}) =>
    refusalMessage({
      success: false,
      reason,
      to: '2.0.0',
      min: '1.0.2',
      ...extra,
    });

  it('is explained by its reason', () => {
    expect(refusal('unreadable')).toBe('The file is not a UCI configuration');
    expect(refusal('missing')).toBe(
      'The file is not a Forkop configuration: it names no version',
    );
    expect(refusal('newer', { from: '2.1.0' })).toBe(
      'The configuration is from Forkop 2.1.0, newer than this one: update Forkop first',
    );
    expect(refusal('below_min', { from: '1.0.0' })).toBe(
      'The configuration is from Forkop 1.0.0, and Forkop loads configurations from 1.0.2 on',
    );
    expect(refusal('unknown', { from: '1.0.3' })).toBe(
      'No Forkop release wrote configuration version 1.0.3',
    );
    expect(refusal('migration', { from: '1.0.5', detail: 'Snell 2' })).toBe(
      'The configuration of Forkop 1.0.5 cannot be brought to 2.0.0: Snell 2',
    );
    expect(refusal('staging', { detail: 'Permission denied' })).toBe(
      'Failed to load the configuration: Permission denied',
    );
  });
});

describe('the upload dialog', () => {
  const ui = globals.ui as Record<string, unknown>;
  const check = (overrides: Partial<ImportCheck> = {}): ImportCheck => ({
    success: true,
    from: '2.0.0',
    to: '2.0.0',
    warnings: [],
    changed: true,
    unsaved: false,
    ...overrides,
  });
  const render = (value: ImportCheck, onLoad = vi.fn()) =>
    renderImportDialog('backup.conf', value, onLoad) as unknown as FakeNode[];
  const paragraphs = (nodes: FakeNode[]) =>
    nodes.filter((node) => node.type === 'p').map(textOf);

  beforeEach(() => {
    ui.hideModal = vi.fn();
    ui.createHandlerFn = (_context: unknown, fn: () => unknown) => fn;
  });

  it('names the file and its version, and the migration only when there is one', () => {
    expect(paragraphs(render(check()))[0]).toBe(
      'backup.conf holds a configuration of Forkop 2.0.0.',
    );
    const migrated = render(
      check({ from: '1.0.5', warnings: ["Removed the MTProto server 'MT'"] }),
    );
    expect(paragraphs(migrated).slice(0, 2)).toEqual([
      'backup.conf holds a configuration of Forkop 1.0.5, which is brought to 2.0.0 as an update would bring it.',
      'What the update changes in it:',
    ]);
    expect(textOf(migrated.find((node) => node.type === 'ul')!)).toBe(
      "Removed the MTProto server 'MT'",
    );
    expect(render(check()).some((node) => node.type === 'ul')).toBe(false);
  });

  it('says that unsaved changes made before give way only when there are some', () => {
    const replaced = 'Unsaved changes to Forkop made earlier are replaced.';
    expect(paragraphs(render(check()))).not.toContain(replaced);
    expect(paragraphs(render(check({ unsaved: true })))).toContain(replaced);
  });

  it('loads on Upload and leaves on Cancel', () => {
    const onLoad = vi.fn();
    const buttons = render(check(), onLoad).find((node) => node.type === 'div')!
      .children as FakeNode[];
    const [cancel, upload] = buttons;
    expect([textOf(cancel), textOf(upload)]).toEqual(['Cancel', 'Upload']);
    (cancel.attrs.click as () => void)();
    expect(ui.hideModal).toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
    (upload.attrs.click as () => void)();
    expect(onLoad).toHaveBeenCalled();
  });
});
