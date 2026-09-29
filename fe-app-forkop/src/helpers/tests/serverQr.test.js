import { describe, expect, it } from 'vitest';

import { qrSvgDataUri } from '../../forkop/tabs/servers/qr';

// The tab carries its own QR encoder - byte mode, error correction L, mask 0 - and
// nothing outside a phone camera ever read its output back. This decodes the matrix
// the encoder produced: undo the mask, walk the module placement in reverse,
// de-interleave the blocks, drop the error correction bytes and read the segment.
// The data has to come back exactly, or the code in the dialog is unscannable.

function load() {
  return { qrSvgDataUri };
}

// The rectangles of the generated SVG, back into a matrix. The encoder draws one
// 1x1 path command per dark module, inside a four module quiet zone.
function matrixFromDataUri(dataUri) {
  const svg = decodeURIComponent(dataUri.replace('data:image/svg+xml,', ''));
  const viewBox = svg.match(/viewBox="0 0 (\d+) \1"/);
  expect(viewBox).toBeTruthy();
  const border = 4;
  const size = Number(viewBox[1]) - border * 2;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));

  for (const [, x, y] of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    modules[Number(y) - border][Number(x) - border] = true;
  }
  return modules;
}

// Which modules carry data: everything outside the finder, timing, alignment,
// format and version areas.
function functionMask(size, version) {
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) reserved[y][x] = true;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }

  const positions = alignmentPositions(version);
  for (const x of positions) {
    for (const y of positions) {
      const overlaps =
        (x === 6 && y === 6) ||
        (x === 6 && y === size - 7) ||
        (x === size - 7 && y === 6);
      if (overlaps) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) mark(x + dx, y + dy);
      }
    }
  }

  // Fifteen format bits twice over, plus the one module that is always dark: eight
  // of them along the bottom of the left column and eight along the right of row 8.
  for (let i = 0; i <= 8; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return reserved;
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) {
    result.unshift(pos);
  }
  return result;
}

const EC_PER_BLOCK_LOW = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
  28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  30, 30,
];
const BLOCKS_LOW = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
  12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

function rawCodewords(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return Math.floor(result / 8);
}

function decode(modules) {
  const size = modules.length;
  const version = (size - 17) / 4;
  expect(Number.isInteger(version)).toBe(true);

  const reserved = functionMask(size, version);

  // The mask the encoder writes into the format bits, applied to the data modules.
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        bits.push(modules[y][x] !== ((x + y) % 2 === 0));
      }
    }
  }

  const interleaved = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ? 1 : 0);
    interleaved.push(value);
  }

  // De-interleave: the encoder writes the data bytes of every block column by
  // column, then the error correction bytes the same way.
  const numBlocks = BLOCKS_LOW[version];
  const eccLen = EC_PER_BLOCK_LOW[version];
  const raw = rawCodewords(version);
  const shortBlocks = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks) - eccLen;
  const blocks = Array.from({ length: numBlocks }, (_, i) => ({
    length: shortLen + (i < shortBlocks ? 0 : 1),
    data: [],
  }));

  let at = 0;
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const block of blocks) {
      if (i < block.length) block.data.push(interleaved[at++]);
    }
  }

  const data = blocks.flatMap((block) => block.data);

  // Byte mode: a four bit mode indicator, the length, then the bytes.
  const stream = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i -= 1) stream.push((byte >> i) & 1);
  }
  const take = (count) =>
    stream.splice(0, count).reduce((acc, bit) => (acc << 1) | bit, 0);

  expect(take(4)).toBe(4);
  const length = take(version <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

describe('QR encoder', () => {
  const { qrSvgDataUri } = load();

  it('encodes a link a decoder reads back', () => {
    const link =
      'vless://11111111-1111-4111-8111-111111111111@203.0.113.9:30000' +
      '?security=reality&sni=www.microsoft.com&pbk=lZq9KrozUdbH7cBkbq04-FQbA0JbEbSkmXVARZ6y1HI' +
      '&sid=4aee2254&fp=chrome&type=tcp&encryption=none#client-1';

    expect(decode(matrixFromDataUri(qrSvgDataUri(link)))).toBe(link);
  });

  // A short link and a long one land on different versions, and the long one crosses
  // into the 16 bit length field and several error correction blocks.
  it('encodes across versions', () => {
    for (const link of [
      'ss://YQ@1.2.3.4:1#a',
      'socks5://client-1:cGFzc3dvcmQ@203.0.113.9:20001#client-1',
      `trojan://${'p'.repeat(400)}@203.0.113.9:20002?security=tls&sni=example.com&insecure=1#long`,
    ]) {
      expect(decode(matrixFromDataUri(qrSvgDataUri(link)))).toBe(link);
    }
  });

  // The label of a client may be anything, and btoa cannot take it directly, so the
  // encoder runs the text through TextEncoder first.
  it('encodes text outside ASCII', () => {
    const link = 'socks5://192.168.1.1:20003#Дом » Клиент: телефон';
    expect(decode(matrixFromDataUri(qrSvgDataUri(link)))).toBe(link);
  });

  it('refuses text no version can hold', () => {
    expect(qrSvgDataUri('x'.repeat(4000))).toBe('');
  });
});
