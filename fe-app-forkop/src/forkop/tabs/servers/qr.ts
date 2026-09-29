// Byte mode at error correction level L: one segment, the smallest version that fits
// the link, and mask 0 - the checkerboard - written into the format bits so any
// decoder undoes it. Choosing among the eight masks by penalty score would only make
// a code marginally easier to read, and a link is base64 and URL text, which the
// checkerboard already breaks up.

const QR_EC_CODEWORDS_PER_BLOCK_LOW = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
  28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  30, 30,
];

const QR_NUM_ERROR_CORRECTION_BLOCKS_LOW = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
  12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

function qrGetBit(value: number, index: number) {
  return ((value >>> index) & 1) !== 0;
}

function qrAppendBits(buffer: boolean[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) {
    buffer.push(qrGetBit(value, i));
  }
}

function qrRawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;

  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }

  return result;
}

function qrRawCodewords(version: number) {
  return Math.floor(qrRawDataModules(version) / 8);
}

function qrDataCodewords(version: number) {
  return (
    qrRawCodewords(version) -
    QR_EC_CODEWORDS_PER_BLOCK_LOW[version] *
      QR_NUM_ERROR_CORRECTION_BLOCKS_LOW[version]
  );
}

function qrEncodeText(text: string) {
  return Array.from(new TextEncoder().encode(text));
}

function qrBuildDataCodewords(bytes: number[], version: number) {
  const capacity = qrDataCodewords(version);
  const bits: boolean[] = [];
  const countBits = version <= 9 ? 8 : 16;

  qrAppendBits(bits, 4, 4);
  qrAppendBits(bits, bytes.length, countBits);
  bytes.forEach((value: number) => qrAppendBits(bits, value, 8));
  qrAppendBits(bits, 0, Math.min(4, capacity * 8 - bits.length));

  while (bits.length % 8 !== 0) {
    bits.push(false);
  }

  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | (bits[i + j] ? 1 : 0);
    }
    result.push(value);
  }

  for (let pad = 0xec; result.length < capacity; pad ^= 0xfd) {
    result.push(pad);
  }

  return result;
}

function qrMultiply(x: number, y: number) {
  let z = 0;

  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }

  return z;
}

function qrReedSolomonDivisor(degree: number) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;

  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = qrMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = qrMultiply(root, 2);
  }

  return result;
}

function qrReedSolomonRemainder(data: number[], divisor: number[]) {
  const result = Array(divisor.length).fill(0);

  data.forEach((value: number) => {
    const factor = value ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= qrMultiply(divisor[i], factor);
    }
  });

  return result;
}

function qrAddErrorCorrection(data: number[], version: number) {
  const numBlocks = QR_NUM_ERROR_CORRECTION_BLOCKS_LOW[version];
  const blockEccLen = QR_EC_CODEWORDS_PER_BLOCK_LOW[version];
  const rawCodewords = qrRawCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;
  const divisor = qrReedSolomonDivisor(blockEccLen);
  const blocks = [];

  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
    const blockData = data.slice(offset, offset + dataLen);
    offset += dataLen;
    blocks.push({
      data: blockData,
      ecc: qrReedSolomonRemainder(blockData, divisor),
    });
  }

  const result: number[] = [];
  const maxDataLen = Math.max(...blocks.map((block) => block.data.length));

  for (let i = 0; i < maxDataLen; i += 1) {
    blocks.forEach((block) => {
      if (i < block.data.length) {
        result.push(block.data[i]);
      }
    });
  }

  for (let i = 0; i < blockEccLen; i += 1) {
    blocks.forEach((block) => result.push(block.ecc[i]));
  }

  return result;
}

function qrAlignmentPatternPositions(version: number) {
  if (version === 1) {
    return [];
  }

  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];

  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }

  return result;
}

function qrMakeMatrix(version: number, dataCodewords: number[]) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () =>
    Array(size).fill(false),
  );

  function setFunction(x: number, y: number, dark: boolean) {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  }

  function drawFinder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) {
          continue;
        }
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(
          cx + dx,
          cy + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  const alignPositions = qrAlignmentPatternPositions(version);
  alignPositions.forEach((x) => {
    alignPositions.forEach((y) => {
      const overlapsFinder =
        (x === 6 && y === 6) ||
        (x === 6 && y === size - 7) ||
        (x === size - 7 && y === 6);
      if (!overlapsFinder) {
        drawAlignment(x, y);
      }
    });
  });

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = qrGetBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  function drawFormatBits(mask: number) {
    const formatData = (1 << 3) | mask;
    let rem = formatData;

    for (let i = 0; i < 10; i += 1) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }

    const formatBits = ((formatData << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) {
      setFunction(8, i, qrGetBit(formatBits, i));
    }
    setFunction(8, 7, qrGetBit(formatBits, 6));
    setFunction(8, 8, qrGetBit(formatBits, 7));
    setFunction(7, 8, qrGetBit(formatBits, 8));
    for (let i = 9; i < 15; i += 1) {
      setFunction(14 - i, 8, qrGetBit(formatBits, i));
    }
    for (let i = 0; i < 8; i += 1) {
      setFunction(size - 1 - i, 8, qrGetBit(formatBits, i));
    }
    for (let i = 8; i < 15; i += 1) {
      setFunction(8, size - 15 + i, qrGetBit(formatBits, i));
    }
    setFunction(8, size - 8, true);
  }

  drawFormatBits(0);

  const codewords = qrAddErrorCorrection(dataCodewords, version);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = qrGetBit(
            codewords[Math.floor(bitIndex / 8)],
            7 - (bitIndex % 8),
          );
          bitIndex += 1;
        }
      }
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  drawFormatBits(0);

  return modules;
}

// The code as an SVG, and how many modules wide it is with its quiet zone: the
// four the standard asks for, which decoders need around a large code.
export function qrCode(text: string) {
  const bytes = qrEncodeText(text);
  let version = 1;

  for (; version <= 40; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= qrDataCodewords(version) * 8) {
      break;
    }
  }

  if (version > 40) {
    return { uri: '', size: 0 };
  }

  const matrix = qrMakeMatrix(version, qrBuildDataCodewords(bytes, version));
  const border = 4;
  const size = matrix.length;
  const viewSize = size + border * 2;
  const path: string[] = [];

  matrix.forEach((row: boolean[], y: number) => {
    row.forEach((dark: boolean, x: number) => {
      if (dark) {
        path.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${viewSize}v${viewSize}H0z"/><path fill="#000" d="${path.join(' ')}"/></svg>`;
  return {
    uri: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    size: viewSize,
  };
}

export function qrSvgDataUri(text: string) {
  return qrCode(text).uri;
}
