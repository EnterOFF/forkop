import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderPageStatus } from '../pageStatus';

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => ({ tag, className: '' }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function heading() {
  const node = {
    className: 'stale',
    children: [] as unknown[],
    replaceChildren(...children: unknown[]) {
      node.children = children;
    },
  };
  return node;
}

function state(
  loading: boolean,
  failed: boolean,
  running: number,
  busy: 'apply' | null = null,
) {
  return {
    loading,
    failed,
    data: {
      singbox: running,
      forkopRunning: running,
      forkopEnabled: 1,
      forkopBusy: busy,
    },
  };
}

describe('the service state in the heading', () => {
  it('is a dot in the colour of the state and the state in words', () => {
    const node = heading();
    renderPageStatus(node as unknown as HTMLElement, state(false, false, 1));
    expect(node.className).toBe('fkp_page-status fkp_page-status--success');
    expect(node.children).toEqual([
      { tag: 'span', className: 'fkp_page-status__dot' },
      'running',
    ]);

    renderPageStatus(
      node as unknown as HTMLElement,
      state(false, false, 1, 'apply'),
    );
    expect(node.className).toBe('fkp_page-status fkp_page-status--progress');
    expect(node.children[1]).toBe('applying...');
  });

  // An empty store reads as a stopped service; saying so before the state has
  // been read, or when it could not be, would be a guess.
  it('says nothing about a state the page has not read', () => {
    for (const unknown of [state(true, false, 0), state(false, true, 0)]) {
      const node = heading();
      node.children = ['running'];
      renderPageStatus(node as unknown as HTMLElement, unknown);
      expect([node.className, node.children]).toEqual(['', []]);
    }
  });
});
