import type { ExportFormat, Segment } from "../types";
import { clamp } from "./math";
import { timelineDuration } from "./timeline";
import { measureWebPFrame, writeAnimatedWebPFrame, writeAnimatedWebPHeader } from "./webpMuxer";

type MemoryInfo = {
  jsHeapSizeLimit?: number;
  usedJSHeapSize?: number;
};

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
};

export type ExportPlan = {
  correctedFps: number;
  duration: number;
  frameCount: number;
  height: number;
  sourceDuration: number;
  width: number;
};

export type ExportCapabilityCheckOptions = {
  format: ExportFormat;
  frameCount: number;
  height: number;
  signal?: AbortSignal;
  width: number;
};

export class CapabilityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, number | string | boolean | null> = {}
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

const MB = 1024 * 1024;
const DEFAULT_MEMORY_BUDGET_BYTES = 512 * MB;
const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 33_554_432;
const SERVICE_WORKER_TIMEOUT_MS = 8000;

const createAbortError = () => new DOMException("Export canceled.", "AbortError");

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

export const estimateOutputWidth = (height: number, sourceWidth: number | null, sourceHeight: number | null) => {
  const aspectRatio =
    sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;

  return Math.max(2, Math.round((height * aspectRatio) / 2) * 2);
};

export const createExportPlan = (options: {
  fps: number;
  height: number;
  segments: Segment[];
  sourceHeight: number | null;
  sourceWidth: number | null;
  speed: number;
}): ExportPlan => {
  const sourceDuration = timelineDuration(options.segments);
  const duration = Math.max(sourceDuration / options.speed, 0.001);
  const frameCount = Math.max(1, Math.round(duration * options.fps));
  const correctedFps = frameCount / duration;
  const width = estimateOutputWidth(options.height, options.sourceWidth, options.sourceHeight);

  return {
    correctedFps,
    duration,
    frameCount,
    height: options.height,
    sourceDuration,
    width
  };
};

const capabilityErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || ""));

export const assertCanvasSizeCapability = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new CapabilityError("canvas-size", "Selected export size is invalid. Choose another Height.", {
      height,
      width
    });
  }

  const pixels = width * height;
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION || pixels > MAX_CANVAS_PIXELS) {
    throw new CapabilityError("canvas-size", "Selected export size is too large for this browser. Choose a lower Height.", {
      height,
      maxDimension: MAX_CANVAS_DIMENSION,
      maxPixels: MAX_CANVAS_PIXELS,
      pixels,
      width
    });
  }
};

export const ensureCanvasSizeCapability = (width: number, height: number) => {
  assertCanvasSizeCapability(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  if (canvas.width !== width || canvas.height !== height) {
    throw new CapabilityError("canvas-size", "Selected export size is not supported by this browser. Choose a lower Height.", {
      height,
      width
    });
  }

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new CapabilityError("canvas", "Canvas rendering is not available in this browser.");
  }

  ctx.fillRect(0, 0, 1, 1);
  canvas.width = 1;
  canvas.height = 1;
};

const memoryBudgetBytes = () => {
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
  const heapLimit = Number(memory?.jsHeapSizeLimit);

  if (Number.isFinite(heapLimit) && heapLimit > 0) {
    const heapUsed = Number(memory?.usedJSHeapSize) || 0;
    return Math.max(128 * MB, Math.floor(Math.max(0, heapLimit - heapUsed) * 0.55));
  }

  const deviceMemory = Number((navigator as NavigatorWithMemory).deviceMemory);
  if (Number.isFinite(deviceMemory) && deviceMemory > 0) {
    return clamp(deviceMemory * 1024 * MB * 0.18, 256 * MB, 1536 * MB);
  }

  return DEFAULT_MEMORY_BUDGET_BYTES;
};

export const estimateExportWorkingSetBytes = (format: ExportFormat, width: number, height: number, frameCount: number) => {
  const rgbaFrameBytes = width * height * 4;
  const frameBookkeepingBytes = format === "webp" ? frameCount * 96 : 0;
  const scratchBytes = format === "gif" ? 96 * MB : 48 * MB;
  const frameCopies = format === "gif" ? 8 : 4;

  return Math.ceil(rgbaFrameBytes * frameCopies + frameBookkeepingBytes + scratchBytes);
};

export const ensureMemoryBudgetCapability = (format: ExportFormat, width: number, height: number, frameCount: number) => {
  const estimatedBytes = estimateExportWorkingSetBytes(format, width, height, frameCount);
  const budgetBytes = memoryBudgetBytes();

  if (estimatedBytes > budgetBytes) {
    throw new CapabilityError(
      "memory-budget",
      "Selected export settings may exceed this browser's memory budget. Choose lower Height, FPS, or a shorter cut.",
      {
        budgetBytes,
        estimatedBytes,
        frameCount,
        height,
        width
      }
    );
  }
};

const isWebPBytes = (bytes: Uint8Array) =>
  bytes.length >= 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x45 &&
  bytes[10] === 0x42 &&
  bytes[11] === 0x50;

const webPEncodingUnsupportedError = () =>
  new CapabilityError("webp-encode", "This browser cannot encode WebP from canvas. Export GIF instead.");

export const encodeCanvasToWebPBlob = async (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
        } else {
          reject(webPEncodingUnsupportedError());
        }
      },
      "image/webp",
      clamp(quality / 100, 0.1, 1)
    );
  });

export const validateWebPBlob = async (blob: Blob) => {
  if (blob.type && blob.type.toLowerCase() !== "image/webp") {
    throw webPEncodingUnsupportedError();
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isWebPBytes(bytes)) {
    throw webPEncodingUnsupportedError();
  }

  return bytes;
};

let webPEncodingSupport: Promise<void> | null = null;

export const ensureWebPEncodingCapability = () => {
  webPEncodingSupport ??= (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new CapabilityError("canvas", "Canvas rendering is not available in this browser.");
    }

    ctx.fillRect(0, 0, 1, 1);
    await validateWebPBlob(await encodeCanvasToWebPBlob(canvas, 76));
    canvas.width = 1;
    canvas.height = 1;
  })();

  return webPEncodingSupport;
};

export const canvasToWebPBytes = async (canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal) => {
  throwIfAborted(signal);
  const blob = await encodeCanvasToWebPBlob(canvas, quality);
  throwIfAborted(signal);

  const bytes = await validateWebPBlob(blob);
  throwIfAborted(signal);

  return bytes;
};

const containsFourCc = (bytes: Uint8Array, value: string) => {
  const expected = new TextEncoder().encode(value);
  for (let offset = 0; offset <= bytes.length - expected.length; offset += 1) {
    let matches = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (bytes[offset + index] !== expected[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
};

let animatedWebPSupport: Promise<void> | null = null;

export const ensureAnimatedWebPCapability = () => {
  animatedWebPSupport ??= (async () => {
    await ensureWebPEncodingCapability();

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new CapabilityError("canvas", "Canvas rendering is not available in this browser.");
    }

    ctx.fillRect(0, 0, 1, 1);
    const frameBytes = await canvasToWebPBytes(canvas, 76);
    const frameInfo = measureWebPFrame(frameBytes, 100);
    const chunks: Uint8Array[] = [];
    const writer = {
      abort: () => undefined,
      close: () => undefined,
      write: (chunk: Uint8Array) => {
        chunks.push(chunk.slice());
      }
    };
    writeAnimatedWebPHeader(writer, 1, 1, [frameInfo, frameInfo]);
    writeAnimatedWebPFrame(writer, 1, 1, { bytes: frameBytes, durationMs: 100 });
    writeAnimatedWebPFrame(writer, 1, 1, { bytes: frameBytes, durationMs: 100 });

    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    canvas.width = 1;
    canvas.height = 1;

    if (!isWebPBytes(bytes) || !containsFourCc(bytes, "ANIM") || !containsFourCc(bytes, "ANMF")) {
      throw new CapabilityError("animated-webp", "Animated WebP export is not available in this browser.");
    }
  })();

  return animatedWebPSupport;
};

const serviceWorkerStreamingUnsupportedError = () =>
  new CapabilityError(
    "service-worker-streaming",
    "Streaming download is not available. Open Loop Cut from the PWA page and reload before exporting."
  );

export const hasServiceWorkerStreamingPrimitives = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "ReadableStream" in window &&
  "MessageChannel" in window &&
  "crypto" in window &&
  typeof crypto.randomUUID === "function";

const waitForActiveServiceWorker = async (registration: ServiceWorkerRegistration, signal?: AbortSignal) => {
  throwIfAborted(signal);
  if (registration.active) {
    return registration.active;
  }

  const worker = registration.installing || registration.waiting;
  if (!worker) {
    throw serviceWorkerStreamingUnsupportedError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(serviceWorkerStreamingUnsupportedError());
    }, SERVICE_WORKER_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const onStateChange = () => {
      if (worker.state === "activated") {
        cleanup();
        resolve();
      }
    };

    worker.addEventListener("statechange", onStateChange);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  if (!registration.active) {
    throw serviceWorkerStreamingUnsupportedError();
  }

  return registration.active;
};

const waitForController = async (signal?: AbortSignal) => {
  throwIfAborted(signal);
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(serviceWorkerStreamingUnsupportedError());
    }, SERVICE_WORKER_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const onControllerChange = () => {
      cleanup();
      resolve();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  if (!navigator.serviceWorker.controller) {
    throw serviceWorkerStreamingUnsupportedError();
  }

  return navigator.serviceWorker.controller;
};

export const ensureServiceWorkerStreamingCapability = async (signal?: AbortSignal) => {
  throwIfAborted(signal);
  if (!hasServiceWorkerStreamingPrimitives()) {
    throw serviceWorkerStreamingUnsupportedError();
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    throwIfAborted(signal);
    await waitForActiveServiceWorker(registration, signal);
    const controller = await waitForController(signal);

    return { controller, registration };
  } catch (error) {
    if (error instanceof CapabilityError || error instanceof DOMException) {
      throw error;
    }

    throw new CapabilityError(
      "service-worker-streaming",
      "Streaming download is not available. Reload Loop Cut and try again.",
      { reason: capabilityErrorMessage(error) }
    );
  }
};

export const ensureExportCapabilities = async ({
  format,
  frameCount,
  height,
  signal,
  width
}: ExportCapabilityCheckOptions) => {
  throwIfAborted(signal);
  ensureCanvasSizeCapability(width, height);
  ensureMemoryBudgetCapability(format, width, height, frameCount);
  await ensureServiceWorkerStreamingCapability(signal);

  if (format === "webp") {
    await ensureAnimatedWebPCapability();
  }

  throwIfAborted(signal);
};
