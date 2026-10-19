import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  downloadAsTxt: vi.fn(),
}));

vi.mock('../../../helpers/showToast', () => ({ showToast: mocks.showToast }));
vi.mock('../../../helpers/downloadAsTxt', () => ({
  downloadAsTxt: mocks.downloadAsTxt,
}));
vi.mock('../../button/renderButton', () => ({
  renderButton: (props: { text: string; onClick: () => void }) => ({
    button: props.text,
    click: props.onClick,
  }),
}));

interface FakeNode {
  type: string;
  attrs: Record<string, unknown>;
  children: unknown[];
  textContent?: string;
}

function fakeE(type: string, attrs: unknown, children?: unknown): FakeNode {
  const list =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  return {
    type,
    attrs: (attrs || {}) as Record<string, unknown>,
    children: list,
    textContent: list.every((child) => typeof child === 'string')
      ? list.join('')
      : undefined,
  };
}

function walk(node: unknown, found: unknown[] = []) {
  found.push(node);
  for (const child of (node as FakeNode)?.children || []) {
    walk(child, found);
  }
  return found;
}

function checkbox() {
  let handler: () => Promise<void> = async () => {};
  const input = {
    type: '',
    className: '',
    checked: false,
    addEventListener: (_event: string, listener: () => Promise<void>) => {
      handler = listener;
    },
  };
  return { input, flip: () => ((input.checked = !input.checked), handler()) };
}

async function render(
  getText?: (context: { maskValues: boolean }) => Promise<string>,
) {
  const box = checkbox();
  vi.stubGlobal('document', { createElement: () => box.input });
  const { renderModal } = await import('../renderModal');
  const body = renderModal('masked text', 'forkop-report', {
    getText,
    showMaskValuesToggle: Boolean(getText),
  }) as unknown as FakeNode;
  const code = walk(body).find(
    (node) => (node as FakeNode)?.type === 'code',
  ) as FakeNode;
  const download = walk(body).find(
    (node) => (node as { button?: string })?.button === 'Download',
  ) as { click: () => void };
  return { body, code, box, download };
}

describe('a text dialog', () => {
  beforeEach(() => {
    (globalThis as unknown as { E: unknown }).E = fakeE;
    mocks.showToast.mockReset();
    mocks.downloadAsTxt.mockReset();
  });

  it('shows the text it was given and saves what it shows', async () => {
    const { code, download } = await render();

    expect(code.textContent).toBe('masked text');
    download.click();
    expect(mocks.downloadAsTxt).toHaveBeenCalledWith(
      'masked text',
      'forkop-report',
    );
  });

  it('asks for the text again on every flip of the masking, and the last flip wins', async () => {
    const answers: Array<(text: string) => void> = [];
    const getText = vi.fn(
      () => new Promise<string>((resolve) => answers.push(resolve)),
    );
    const { code, box, download } = await render(getText);
    box.input.checked = true;

    const showRaw = box.flip();
    const hideAgain = box.flip();
    answers[1]('masked again');
    answers[0]('raw text');
    await Promise.all([showRaw, hideAgain]);

    expect(getText.mock.calls).toEqual([
      [{ maskValues: false }],
      [{ maskValues: true }],
    ]);
    expect(code.textContent).toBe('masked again');
    download.click();
    expect(mocks.downloadAsTxt).toHaveBeenCalledWith(
      'masked again',
      'forkop-report',
    );
  });

  it('undoes a flip whose text could not be read, and says so', async () => {
    const { code, box } = await render(() =>
      Promise.reject(new Error('router is gone')),
    );
    box.input.checked = true;

    await box.flip();

    expect(box.input.checked).toBe(true);
    expect(code.textContent).toBe('masked text');
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Failed to load diagnostics',
      'error',
    );
  });
});
