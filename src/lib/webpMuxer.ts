import type { DownloadWriter } from "./streamDownload";

type WebPFrame = {
  bytes: Uint8Array;
  durationMs: number;
};

export type WebPFrameInfo = {
  durationMs: number;
  payloadSize: number;
};

type WebPFrameChunk = {
  end: number;
  start: number;
};

const textEncoder = new TextEncoder();

const fourCc = (value: string) => textEncoder.encode(value);

const readFourCc = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

const readUint32 = (bytes: Uint8Array, offset: number) =>
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);

const writeUint24 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
};

const writeUint32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
};

const chunkSize = (payloadSize: number) => 8 + payloadSize + (payloadSize % 2);

const makeChunkHeader = (type: string, payloadSize: number) => {
  const header = new Uint8Array(8);
  header.set(fourCc(type), 0);
  writeUint32(header, 4, payloadSize);
  return header;
};

const makeChunk = (type: string, payload: Uint8Array) => {
  const padding = payload.length % 2;
  const chunk = new Uint8Array(8 + payload.length + padding);
  chunk.set(fourCc(type), 0);
  writeUint32(chunk, 4, payload.length);
  chunk.set(payload, 8);
  return chunk;
};

const extractFrameChunks = (bytes: Uint8Array) => {
  if (readFourCc(bytes, 0) !== "RIFF" || readFourCc(bytes, 8) !== "WEBP") {
    throw new Error("Browser returned an invalid WebP frame.");
  }

  const chunks: WebPFrameChunk[] = [];
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const type = readFourCc(bytes, offset);
    const size = readUint32(bytes, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) {
      throw new Error("Browser returned a truncated WebP frame.");
    }

    if (type === "VP8 " || type === "VP8L" || type === "ALPH") {
      chunks.push({ start: offset, end });
    }

    offset = end;
  }

  if (!chunks.length) {
    throw new Error("Browser WebP encoder did not produce a usable frame.");
  }

  return chunks;
};

const makeVP8XChunk = (width: number, height: number) => {
  const payload = new Uint8Array(10);
  payload[0] = 0x02;
  writeUint24(payload, 4, width - 1);
  writeUint24(payload, 7, height - 1);
  return makeChunk("VP8X", payload);
};

const makeANIMChunk = () => {
  const payload = new Uint8Array(6);
  payload[3] = 0xff;
  return makeChunk("ANIM", payload);
};

export const measureWebPFrame = (bytes: Uint8Array, durationMs: number): WebPFrameInfo => ({
  durationMs,
  payloadSize: extractFrameChunks(bytes).reduce((total, chunk) => total + chunk.end - chunk.start, 0)
});

const anmfPayloadSize = (frame: WebPFrameInfo) => 16 + frame.payloadSize;

const animationRiffSize = (frames: WebPFrameInfo[]) => {
  const chunksSize = chunkSize(10) + chunkSize(6) + frames.reduce((total, frame) => total + chunkSize(anmfPayloadSize(frame)), 0);
  const riffSize = 4 + chunksSize;
  if (riffSize > 0xffffffff) {
    throw new Error("Animated WebP is too large for the WebP container.");
  }

  return riffSize;
};

export const writeAnimatedWebPHeader = (
  writer: DownloadWriter,
  width: number,
  height: number,
  frames: WebPFrameInfo[]
) => {
  const header = new Uint8Array(12);
  header.set(fourCc("RIFF"), 0);
  writeUint32(header, 4, animationRiffSize(frames));
  header.set(fourCc("WEBP"), 8);

  writer.write(header);
  writer.write(makeVP8XChunk(width, height));
  writer.write(makeANIMChunk());
};

export const writeAnimatedWebPFrame = (writer: DownloadWriter, width: number, height: number, frame: WebPFrame) => {
  const chunks = extractFrameChunks(frame.bytes);
  const framePayloadSize = chunks.reduce((total, chunk) => total + chunk.end - chunk.start, 0);
  const anmfHeader = new Uint8Array(8 + 16);

  anmfHeader.set(fourCc("ANMF"), 0);
  writeUint32(anmfHeader, 4, 16 + framePayloadSize);
  writeUint24(anmfHeader, 8, 0);
  writeUint24(anmfHeader, 11, 0);
  writeUint24(anmfHeader, 14, width - 1);
  writeUint24(anmfHeader, 17, height - 1);
  writeUint24(anmfHeader, 20, Math.max(1, Math.min(0xffffff, frame.durationMs)));
  anmfHeader[23] = 0x02;
  writer.write(anmfHeader);

  for (const chunk of chunks) {
    writer.write(frame.bytes.subarray(chunk.start, chunk.end));
  }

  if ((16 + framePayloadSize) % 2) {
    writer.write(new Uint8Array([0]));
  }
};
