import type { DownloadWriter } from "./streamDownload";

export type Color = {
  b: number;
  count: number;
  g: number;
  r: number;
};

type ColorBox = {
  bMax: number;
  bMin: number;
  colors: Color[];
  count: number;
  gMax: number;
  gMin: number;
  rMax: number;
  rMin: number;
};

export type GifFrame = {
  delayCentiseconds: number;
  pixels: Uint8Array;
};

const makeBox = (colors: Color[]): ColorBox => {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  let count = 0;

  for (const color of colors) {
    rMin = Math.min(rMin, color.r);
    rMax = Math.max(rMax, color.r);
    gMin = Math.min(gMin, color.g);
    gMax = Math.max(gMax, color.g);
    bMin = Math.min(bMin, color.b);
    bMax = Math.max(bMax, color.b);
    count += color.count;
  }

  return { colors, count, rMin, rMax, gMin, gMax, bMin, bMax };
};

const splitBox = (box: ColorBox) => {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;
  const channel: "r" | "g" | "b" = rRange >= gRange && rRange >= bRange ? "r" : gRange >= bRange ? "g" : "b";
  const colors = box.colors.slice().sort((a, b) => a[channel] - b[channel]);
  const half = box.count / 2;
  let cursor = 0;
  let splitPoint = 1;

  for (let index = 0; index < colors.length - 1; index += 1) {
    cursor += colors[index].count;
    splitPoint = index + 1;
    if (cursor >= half) {
      break;
    }
  }

  splitPoint = Math.max(1, Math.min(colors.length - 1, splitPoint));

  return [makeBox(colors.slice(0, splitPoint)), makeBox(colors.slice(splitPoint))];
};

const normalizePaletteColorCount = (value: number) => Math.max(2, Math.min(256, Math.round(value)));

export const buildGifPalette = (colors: Color[], colorCount = 256) => {
  const safeColorCount = normalizePaletteColorCount(colorCount);

  if (!colors.length) {
    return new Uint8Array(256 * 3);
  }

  const boxes = [makeBox(colors)];
  while (boxes.length < safeColorCount) {
    boxes.sort((a, b) => {
      const aRange = Math.max(a.rMax - a.rMin, a.gMax - a.gMin, a.bMax - a.bMin);
      const bRange = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin);
      return bRange * b.count - aRange * a.count;
    });

    const box = boxes.shift();
    if (!box || box.colors.length <= 1) {
      if (box) {
        boxes.push(box);
      }
      break;
    }

    boxes.push(...splitBox(box));
  }

  const palette = new Uint8Array(256 * 3);
  const selectedBoxes = boxes.slice(0, safeColorCount).filter((box) => box.count > 0);
  selectedBoxes.forEach((box, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const color of box.colors) {
      r += color.r * color.count;
      g += color.g * color.count;
      b += color.b * color.count;
    }

    palette[index * 3] = Math.round(r / box.count);
    palette[index * 3 + 1] = Math.round(g / box.count);
    palette[index * 3 + 2] = Math.round(b / box.count);
  });

  if (selectedBoxes.length) {
    const lastColorOffset = (selectedBoxes.length - 1) * 3;
    for (let index = selectedBoxes.length; index < 256; index += 1) {
      const offset = index * 3;
      palette[offset] = palette[lastColorOffset];
      palette[offset + 1] = palette[lastColorOffset + 1];
      palette[offset + 2] = palette[lastColorOffset + 2];
    }
  }

  return palette;
};

export const addSampledColors = (imageData: ImageData, colors: Map<number, Color>, stride: number) => {
  const data = imageData.data;
  const step = Math.max(1, stride) * 4;
  for (let index = 0; index < data.length; index += step) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const current = colors.get(key);
    if (current) {
      current.r += r;
      current.g += g;
      current.b += b;
      current.count += 1;
    } else {
      colors.set(key, { r, g, b, count: 1 });
    }
  }
};

export const sampledColorsToPaletteInput = (colors: Map<number, Color>) =>
  [...colors.values()].map((color) => ({
    r: Math.round(color.r / color.count),
    g: Math.round(color.g / color.count),
    b: Math.round(color.b / color.count),
    count: color.count
  }));

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const createAbortError = () => new DOMException("Export canceled.", "AbortError");

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const nearestPaletteIndex = (
  r: number,
  g: number,
  b: number,
  palette: Uint8Array,
  colorCount: number,
  cache: Map<number, number>
) => {
  const safeR = clampByte(r);
  const safeG = clampByte(g);
  const safeB = clampByte(b);
  const safeColorCount = normalizePaletteColorCount(colorCount);
  const key = ((safeR >> 3) << 10) | ((safeG >> 3) << 5) | (safeB >> 3);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let paletteIndex = 0; paletteIndex < safeColorCount; paletteIndex += 1) {
    const paletteOffset = paletteIndex * 3;
    const dr = safeR - palette[paletteOffset];
    const dg = safeG - palette[paletteOffset + 1];
    const db = safeB - palette[paletteOffset + 2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = paletteIndex;
    }
  }

  cache.set(key, bestIndex);
  return bestIndex;
};

export const quantizeToPalette = (
  imageData: ImageData,
  palette: Uint8Array,
  colorCount: number,
  cache: Map<number, number>
) => {
  const data = imageData.data;
  const pixels = new Uint8Array(data.length / 4);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < data.length; sourceIndex += 4, targetIndex += 1) {
    const r = data[sourceIndex];
    const g = data[sourceIndex + 1];
    const b = data[sourceIndex + 2];
    pixels[targetIndex] = nearestPaletteIndex(r, g, b, palette, colorCount, cache);
  }

  return pixels;
};

const distributeError = (errors: Float32Array, index: number, r: number, g: number, b: number, weight: number) => {
  errors[index] += r * weight;
  errors[index + 1] += g * weight;
  errors[index + 2] += b * weight;
};

export const quantizeToPaletteDithered = (
  imageData: ImageData,
  palette: Uint8Array,
  colorCount: number,
  cache: Map<number, number>,
  signal?: AbortSignal
) => {
  const { data, height, width } = imageData;
  const pixels = new Uint8Array(width * height);
  let currentErrors = new Float32Array((width + 2) * 3);
  let nextErrors = new Float32Array((width + 2) * 3);

  for (let y = 0; y < height; y += 1) {
    throwIfAborted(signal);

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = y * width + x;
      const errorIndex = (x + 1) * 3;
      const r = clampByte(data[sourceIndex] + currentErrors[errorIndex]);
      const g = clampByte(data[sourceIndex + 1] + currentErrors[errorIndex + 1]);
      const b = clampByte(data[sourceIndex + 2] + currentErrors[errorIndex + 2]);
      const paletteIndex = nearestPaletteIndex(r, g, b, palette, colorCount, cache);
      const paletteOffset = paletteIndex * 3;
      const errorR = r - palette[paletteOffset];
      const errorG = g - palette[paletteOffset + 1];
      const errorB = b - palette[paletteOffset + 2];

      pixels[targetIndex] = paletteIndex;
      distributeError(currentErrors, errorIndex + 3, errorR, errorG, errorB, 7 / 16);
      distributeError(nextErrors, errorIndex - 3, errorR, errorG, errorB, 3 / 16);
      distributeError(nextErrors, errorIndex, errorR, errorG, errorB, 5 / 16);
      distributeError(nextErrors, errorIndex + 3, errorR, errorG, errorB, 1 / 16);
    }

    const previousErrors = currentErrors;
    currentErrors = nextErrors;
    nextErrors = previousErrors;
    nextErrors.fill(0);
  }

  return pixels;
};

class ByteWriter {
  private bytes: number[] = [];

  byte(value: number) {
    this.bytes.push(value & 0xff);
  }

  bytesArray(values: ArrayLike<number>) {
    for (let index = 0; index < values.length; index += 1) {
      this.byte(values[index]);
    }
  }

  string(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      this.byte(value.charCodeAt(index));
    }
  }

  uint16(value: number) {
    this.byte(value);
    this.byte(value >> 8);
  }

  flush() {
    const chunk = new Uint8Array(this.bytes);
    this.bytes = [];
    return chunk;
  }
}

class BitWriter {
  private bitCount = 0;
  private bitValue = 0;
  private bytes: number[] = [];

  write(code: number, size: number) {
    this.bitValue |= code << this.bitCount;
    this.bitCount += size;

    while (this.bitCount >= 8) {
      this.bytes.push(this.bitValue & 0xff);
      this.bitValue >>= 8;
      this.bitCount -= 8;
    }
  }

  finish() {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitValue & 0xff);
      this.bitValue = 0;
      this.bitCount = 0;
    }

    return new Uint8Array(this.bytes);
  }
}

const lzwEncode = (pixels: Uint8Array) => {
  const minCodeSize = 8;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const maxCode = 4096;
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;
  let dictionary = new Map<number, number>();
  const bits = new BitWriter();

  const reset = () => {
    dictionary = new Map();
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };

  bits.write(clearCode, codeSize);
  let prefix = pixels[0] ?? 0;

  for (let index = 1; index < pixels.length; index += 1) {
    const value = pixels[index];
    const key = prefix * 256 + value;
    const code = dictionary.get(key);

    if (code !== undefined) {
      prefix = code;
      continue;
    }

    bits.write(prefix, codeSize);

    if (nextCode < maxCode) {
      dictionary.set(key, nextCode);
      nextCode += 1;
      if (nextCode > 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      bits.write(clearCode, codeSize);
      reset();
    }

    prefix = value;
  }

  bits.write(prefix, codeSize);
  bits.write(endCode, codeSize);

  return bits.finish();
};

const writeDataSubBlocks = (writer: DownloadWriter, data: Uint8Array) => {
  for (let offset = 0; offset < data.length; offset += 255) {
    const size = Math.min(255, data.length - offset);
    const block = new Uint8Array(size + 1);
    block[0] = size;
    block.set(data.subarray(offset, offset + size), 1);
    writer.write(block);
  }
  writer.write(new Uint8Array([0]));
};

export const writeGifHeader = (writer: DownloadWriter, width: number, height: number, palette: Uint8Array) => {
  const bytes = new ByteWriter();
  bytes.string("GIF89a");
  bytes.uint16(width);
  bytes.uint16(height);
  bytes.byte(0xf7);
  bytes.byte(0);
  bytes.byte(0);
  bytes.bytesArray(palette);
  bytes.string("!\xff\x0bNETSCAPE2.0\x03\x01");
  bytes.uint16(0);
  bytes.byte(0);
  writer.write(bytes.flush());
};

export const writeGifFrame = (writer: DownloadWriter, width: number, height: number, frame: GifFrame) => {
  const bytes = new ByteWriter();
  bytes.string("!\xf9\x04");
  bytes.byte(0);
  bytes.uint16(frame.delayCentiseconds);
  bytes.byte(0);
  bytes.byte(0);
  bytes.byte(0x2c);
  bytes.uint16(0);
  bytes.uint16(0);
  bytes.uint16(width);
  bytes.uint16(height);
  bytes.byte(0);
  bytes.byte(8);
  writer.write(bytes.flush());
  writeDataSubBlocks(writer, lzwEncode(frame.pixels));
};

export const writeGifTrailer = (writer: DownloadWriter) => {
  writer.write(new Uint8Array([0x3b]));
};
