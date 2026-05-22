import {
  addSampledColors,
  buildGifPalette,
  quantizeToPaletteDithered,
  sampledColorsToPaletteInput,
  type Color,
  writeGifFrame,
  writeGifHeader,
  writeGifTrailer
} from "./gifEncoder";
import type { DownloadWriter } from "./streamDownload";

type GifWorkerRequest =
  | {
      colorCount: number;
      height: number;
      id: number;
      op: "init";
      width: number;
    }
  | {
      data: ArrayBuffer;
      height: number;
      id: number;
      op: "sample";
      stride: number;
      width: number;
    }
  | {
      id: number;
      op: "buildHeader";
    }
  | {
      data: ArrayBuffer;
      delayCentiseconds: number;
      height: number;
      id: number;
      op: "encodeFrame";
      width: number;
    }
  | {
      id: number;
      op: "trailer";
    };

type GifWorkerResponse =
  | {
      chunks?: ArrayBuffer[];
      id: number;
      ok: true;
    }
  | {
      id: number;
      message: string;
      ok: false;
    };

let width = 0;
let height = 0;
let colorCount = 256;
let palette: Uint8Array | null = null;
let paletteCache = new Map<number, number>();
let sampledColors = new Map<number, Color>();

const imageDataFromBuffer = (data: ArrayBuffer, nextWidth: number, nextHeight: number) =>
  ({
    data: new Uint8ClampedArray(data),
    height: nextHeight,
    width: nextWidth
  }) as ImageData;

const makeChunkWriter = () => {
  const chunks: Uint8Array[] = [];
  const writer: DownloadWriter = {
    abort: () => undefined,
    close: () => undefined,
    write: (chunk) => {
      chunks.push(
        chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice()
      );
    }
  };

  return { chunks, writer };
};

const chunksToBuffers = (chunks: Uint8Array[]) => chunks.map((chunk) => chunk.buffer as ArrayBuffer);

const postSuccess = (id: number, chunks?: Uint8Array[]) => {
  const buffers = chunks ? chunksToBuffers(chunks) : undefined;
  const response: GifWorkerResponse = { id, ok: true, chunks: buffers };
  self.postMessage(response, buffers || []);
};

const postFailure = (id: number, error: unknown) => {
  const response: GifWorkerResponse = {
    id,
    ok: false,
    message: error instanceof Error ? error.message : String(error || "GIF worker failed.")
  };
  self.postMessage(response);
};

const requirePalette = () => {
  if (!palette) {
    throw new Error("GIF palette is not ready.");
  }

  return palette;
};

self.onmessage = (event: MessageEvent<GifWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.op === "init") {
      width = request.width;
      height = request.height;
      colorCount = request.colorCount;
      palette = null;
      paletteCache = new Map();
      sampledColors = new Map();
      postSuccess(request.id);
      return;
    }

    if (request.op === "sample") {
      addSampledColors(imageDataFromBuffer(request.data, request.width, request.height), sampledColors, request.stride);
      postSuccess(request.id);
      return;
    }

    if (request.op === "buildHeader") {
      palette = buildGifPalette(sampledColorsToPaletteInput(sampledColors), colorCount);
      paletteCache = new Map();
      const { chunks, writer } = makeChunkWriter();
      writeGifHeader(writer, width, height, palette);
      postSuccess(request.id, chunks);
      return;
    }

    if (request.op === "encodeFrame") {
      const nextPalette = requirePalette();
      const pixels = quantizeToPaletteDithered(
        imageDataFromBuffer(request.data, request.width, request.height),
        nextPalette,
        colorCount,
        paletteCache
      );
      const { chunks, writer } = makeChunkWriter();
      writeGifFrame(writer, width, height, {
        delayCentiseconds: request.delayCentiseconds,
        pixels
      });
      postSuccess(request.id, chunks);
      return;
    }

    if (request.op === "trailer") {
      const { chunks, writer } = makeChunkWriter();
      writeGifTrailer(writer);
      postSuccess(request.id, chunks);
    }
  } catch (error) {
    postFailure(request.id, error);
  }
};
