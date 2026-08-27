import { afterEach, describe, expect, it } from 'vitest';

import { renderLoaderCircleIcon24 } from '../renderLoaderCircleIcon24';

interface FakeElement {
  tag: string;
  attrs: Record<string, string>;
  children: FakeElement[];
}

const globals = globalThis as unknown as {
  document?: unknown;
};

const previousDocument = globals.document;

// svgEl() builds through document.createElementNS, and spinPhaseStyle() reads the
// document clock; nothing else of a document is involved.
function installDocument(currentTime: number) {
  globals.document = {
    timeline: { currentTime },
    createElementNS: (_ns: string, tag: string): FakeElement =>
      ({
        tag,
        attrs: {},
        children: [],
        setAttribute(this: FakeElement, name: string, value: string) {
          this.attrs[name] = value;
        },
        appendChild(this: FakeElement, child: FakeElement) {
          this.children.push(child);
        },
      }) as unknown as FakeElement,
  };
}

function renderAt(currentTime: number): FakeElement {
  installDocument(currentTime);
  return renderLoaderCircleIcon24() as unknown as FakeElement;
}

afterEach(() => {
  globals.document = previousDocument;
});

describe('the loader circle', () => {
  it('is the lucide arc, spun by the rotate class', () => {
    const svg = renderAt(0);

    expect(svg.tag).toBe('svg');
    expect(svg.attrs.class).toContain('rotate');
    expect(svg.children.map((child) => child.tag)).toEqual(['path']);
    expect(svg.children[0].attrs.d).toBe('M21 12a9 9 0 1 1-6.219-8.56');
  });

  // The turn belongs to the CSS animation alone. A second animation of the same
  // transform - the SMIL animateTransform this icon used to carry - is timed from
  // the SVG's own clock, which starts over with every rebuilt element and cannot
  // be anchored by a delay.
  it('carries no animation of its own', () => {
    const svg = renderAt(0);

    expect(svg.children.map((child) => child.tag)).not.toContain(
      'animateTransform',
    );
  });

  it('is built at the phase the document clock is at', () => {
    expect(renderAt(2750).attrs.style).toBe('animation-delay: -750ms');
    expect(renderAt(9100).attrs.style).toBe('animation-delay: -100ms');
  });

  // The reported defect: two spinners a re-render apart used to start their turn
  // at twelve o'clock whatever the first one had reached.
  it('lands on the same angle as one built a moment earlier', () => {
    // Where in the turn the browser will put this spinner: when it starts it,
    // plus how far in the delay says it already is.
    function phaseOf(svg: FakeElement, builtAt: number) {
      const delay = Number(
        /^animation-delay: (-?[\d.]+)ms$/.exec(svg.attrs.style)?.[1],
      );

      expect(delay).not.toBeNaN();

      return (builtAt + delay) % 1000;
    }

    expect(phaseOf(renderAt(4610), 4610)).toBe(phaseOf(renderAt(4160), 4160));
  });
});
