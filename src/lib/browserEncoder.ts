import type { ExportFormat, Segment } from "../types";
import {
  assertCanvasSizeCapability,
  canvasToWebPBytes,
  createExportPlan,
  ensureAnimatedWebPCapability
} from "./capabilities";
import { clamp } from "./math";
import { findTimelineHit, timelineDuration } from "./timeline";
import { seekVideoFrame, waitForVideoEvent } from "./video";
import GifWorker from "./gifWorker?worker";
import type { DownloadWriter } from "./streamDownload";
import { measureWebPFrame, type WebPFrameInfo, writeAnimatedWebPFrame, writeAnimatedWebPHeader } from "./webpMuxer";

type BrowserExportOptions = {
  file: File;
  format: ExportFormat;
  fps: number;
  gifColorCount: number;
  height: number;
  onProgress: (progress: number) => void;
  onStatus: (status: string) => void;
  quality: number;
  segments: Segment[];
  signal: AbortSignal;
  sourceHeight: number | null;
  sourceWidth: number | null;
  speed: number;
  videoElement: HTMLVideoElement | null;
  writer: DownloadWriter;
};

const createAbortError = () => new DOMException("Export canceled.", "AbortError");

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw createAbortError();
  }
};

const yieldToMainThread = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

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

type PendingGifWorkerRequest = {
  reject: (error: Error) => void;
  resolve: (chunks: Uint8Array[]) => void;
};

class GifWorkerSession {
  private nextId = 1;
  private pending = new Map<number, PendingGifWorkerRequest>();
  private worker = new GifWorker();

  constructor(private signal: AbortSignal) {
    this.worker.onmessage = (event: MessageEvent<GifWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }

      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve((response.chunks || []).map((chunk) => new Uint8Array(chunk)));
      } else {
        pending.reject(new Error(response.message));
      }
    };

    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || "GIF worker failed."));
    };

    signal.addEventListener("abort", this.abort, { once: true });
  }

  init(width: number, height: number, colorCount: number) {
    return this.request({ op: "init", width, height, colorCount });
  }

  sample(imageData: ImageData, stride: number) {
    const data = transferableImageDataBuffer(imageData);
    return this.request(
      {
        op: "sample",
        width: imageData.width,
        height: imageData.height,
        stride,
        data
      },
      [data]
    );
  }

  buildHeader() {
    return this.request({ op: "buildHeader" });
  }

  encodeFrame(imageData: ImageData, delayCentiseconds: number) {
    const data = transferableImageDataBuffer(imageData);
    return this.request(
      {
        op: "encodeFrame",
        width: imageData.width,
        height: imageData.height,
        delayCentiseconds,
        data
      },
      [data]
    );
  }

  trailer() {
    return this.request({ op: "trailer" });
  }

  close() {
    this.signal.removeEventListener("abort", this.abort);
    this.worker.terminate();
    this.pending.clear();
  }

  private abort = () => {
    this.fail(createAbortError());
  };

  private fail(error: Error) {
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = []) {
    throwIfAborted(this.signal);
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<Uint8Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error || "GIF worker request failed.")));
      }
    });
  }
}

const transferableImageDataBuffer = (imageData: ImageData) => {
  const { data } = imageData;
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer) {
    return data.buffer;
  }

  return data.slice().buffer;
};

const writeChunks = (writer: DownloadWriter, chunks: Uint8Array[], signal: AbortSignal) => {
  for (const chunk of chunks) {
    throwIfAborted(signal);
    writer.write(chunk);
  }
};

const createVideo = async (file: File, signal: AbortSignal) => {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  const cleanup = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    await waitForVideoEvent(video, "loadedmetadata", signal);
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    video,
    cleanup
  };
};

const useExportVideo = async (options: BrowserExportOptions) => {
  throwIfAborted(options.signal);
  const video = options.videoElement;
  if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
    const restoreTime = video.currentTime;
    const wasPaused = video.paused;
    video.pause();

    return {
      video,
      cleanup: () => {
        video.currentTime = restoreTime;
        if (!wasPaused) {
          void video.play();
        }
      }
    };
  }

  return createVideo(options.file, options.signal);
};

const createCanvas = (width: number, height: number, willReadFrequently: boolean) => {
  assertCanvasSizeCapability(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently });
  if (!ctx) {
    throw new Error("Canvas rendering is not available.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { canvas, ctx };
};

const sourceTimeForFrame = (segments: Segment[], sourceDuration: number, frameIndex: number, fps: number, speed: number) => {
  const exportTime = frameIndex / fps;
  const timelineTime = clamp(exportTime * speed, 0, Math.max(0, sourceDuration - 0.001));
  const hit = findTimelineHit(segments, timelineTime);

  return hit ? hit.sourceTime : 0;
};

const frameDelayCentiseconds = (frameIndex: number, fps: number) => {
  const start = Math.round((frameIndex / fps) * 100);
  const end = Math.round(((frameIndex + 1) / fps) * 100);
  return clamp(end - start, 1, 65535);
};

const frameDelayMilliseconds = (frameIndex: number, fps: number) => {
  const start = Math.round((frameIndex / fps) * 1000);
  const end = Math.round(((frameIndex + 1) / fps) * 1000);
  return clamp(end - start, 1, 0xffffff);
};

const drawFrame = async (
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  signal: AbortSignal
) => {
  throwIfAborted(signal);
  await seekVideoFrame(video, time, signal);
  throwIfAborted(signal);
  ctx.drawImage(video, 0, 0, width, height);
};

const exportGif = async (options: BrowserExportOptions, width: number, correctedFps: number, frameCount: number) => {
  const { video, cleanup } = await useExportVideo(options);
  const { canvas, ctx } = createCanvas(width, options.height, true);
  const sourceDuration = timelineDuration(options.segments);
  const gifWorker = new GifWorkerSession(options.signal);
  const sampleStride = Math.max(3, Math.ceil(Math.sqrt((width * options.height) / 55_000)));

  try {
    throwIfAborted(options.signal);
    await gifWorker.init(width, options.height, options.gifColorCount);

    options.onStatus("Building GIF palette");
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(options.signal);
      const sourceTime = sourceTimeForFrame(options.segments, sourceDuration, frameIndex, correctedFps, options.speed);
      await drawFrame(video, ctx, width, options.height, sourceTime, options.signal);
      await gifWorker.sample(ctx.getImageData(0, 0, width, options.height), sampleStride);
      options.onProgress(0.02 + ((frameIndex + 1) / frameCount) * 0.22);
      await yieldToMainThread();
    }

    throwIfAborted(options.signal);
    writeChunks(options.writer, await gifWorker.buildHeader(), options.signal);

    options.onStatus("Encoding GIF");
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(options.signal);
      const sourceTime = sourceTimeForFrame(options.segments, sourceDuration, frameIndex, correctedFps, options.speed);
      await drawFrame(video, ctx, width, options.height, sourceTime, options.signal);
      const chunks = await gifWorker.encodeFrame(
        ctx.getImageData(0, 0, width, options.height),
        frameDelayCentiseconds(frameIndex, correctedFps)
      );
      writeChunks(options.writer, chunks, options.signal);
      options.onProgress(0.25 + ((frameIndex + 1) / frameCount) * 0.73);
      await yieldToMainThread();
    }

    throwIfAborted(options.signal);
    writeChunks(options.writer, await gifWorker.trailer(), options.signal);
  } finally {
    gifWorker.close();
    cleanup();
    canvas.width = 1;
    canvas.height = 1;
  }
};

const exportWebP = async (options: BrowserExportOptions, width: number, correctedFps: number, frameCount: number) => {
  await ensureAnimatedWebPCapability();
  throwIfAborted(options.signal);
  const { video, cleanup } = await useExportVideo(options);
  const { canvas, ctx } = createCanvas(width, options.height, false);
  const sourceDuration = timelineDuration(options.segments);

  try {
    const frames: WebPFrameInfo[] = [];

    options.onStatus("Measuring WebP frames");
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(options.signal);
      const sourceTime = sourceTimeForFrame(options.segments, sourceDuration, frameIndex, correctedFps, options.speed);
      await drawFrame(video, ctx, width, options.height, sourceTime, options.signal);
      const durationMs = frameDelayMilliseconds(frameIndex, correctedFps);
      const bytes = await canvasToWebPBytes(canvas, options.quality, options.signal);
      frames.push(measureWebPFrame(bytes, durationMs));
      options.onProgress(0.02 + ((frameIndex + 1) / frameCount) * 0.42);
      await yieldToMainThread();
    }

    throwIfAborted(options.signal);
    options.onStatus("Writing WebP");
    writeAnimatedWebPHeader(options.writer, width, options.height, frames);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(options.signal);
      const sourceTime = sourceTimeForFrame(options.segments, sourceDuration, frameIndex, correctedFps, options.speed);
      await drawFrame(video, ctx, width, options.height, sourceTime, options.signal);
      const durationMs = frameDelayMilliseconds(frameIndex, correctedFps);
      const bytes = await canvasToWebPBytes(canvas, options.quality, options.signal);
      const frameInfo = measureWebPFrame(bytes, durationMs);
      if (frameInfo.payloadSize !== frames[frameIndex].payloadSize) {
        throw new Error("Browser WebP encoder produced unstable frame sizes.");
      }
      writeAnimatedWebPFrame(options.writer, width, options.height, { bytes, durationMs });
      options.onProgress(0.45 + ((frameIndex + 1) / frameCount) * 0.53);
      await yieldToMainThread();
    }

    options.onProgress(0.98);
  } finally {
    cleanup();
    canvas.width = 1;
    canvas.height = 1;
  }
};

export async function exportBrowserAnimation(options: BrowserExportOptions) {
  throwIfAborted(options.signal);
  const timing = createExportPlan({
    fps: options.fps,
    height: options.height,
    segments: options.segments,
    sourceHeight: options.sourceHeight,
    sourceWidth: options.sourceWidth,
    speed: options.speed
  });
  const { width } = timing;

  if (options.format === "gif") {
    await exportGif(options, width, timing.correctedFps, timing.frameCount);
  } else {
    await exportWebP(options, width, timing.correctedFps, timing.frameCount);
  }
}
