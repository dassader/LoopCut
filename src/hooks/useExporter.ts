import { FFFSType, FFmpeg } from "@ffmpeg/ffmpeg";
import ffmpegWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EXPORT_FPS,
  EXPORT_FPS_PRESETS,
  EXPORT_HEIGHT_PRESETS,
  MAX_EXPORT_SPEED,
  MIN_EXPORT_SPEED
} from "../constants";
import { clamp } from "../lib/math";
import { timelineDuration } from "../lib/timeline";
import type { ExportFormat, Segment } from "../types";

type UseExporterOptions = {
  file: File | null;
  segments: Segment[];
};

type ExportTiming = {
  correctedFps: number;
  duration: number;
  frameCount: number;
  gifFinalDelay: number;
};

type FFmpegProgressSample = {
  frame: number | null;
  seconds: number | null;
};

type MountedInputFile = {
  cleanup: () => Promise<void>;
  inputPath: string;
};

const WORKERFS_UNSUPPORTED_MESSAGE =
  "WORKERFS is not supported in this browser. Export needs a browser with ffmpeg.wasm WORKERFS support.";

const formatFFmpegNumber = (value: number) => Number(value.toFixed(6)).toString();

const resolveStateAction = <T,>(action: SetStateAction<T>, current: T) =>
  typeof action === "function" ? (action as (value: T) => T)(current) : action;

const normalizeExportHeight = (value: number) => {
  const safeValue = Number.isFinite(value) ? value : 720;

  return EXPORT_HEIGHT_PRESETS.reduce((closest, preset) =>
    Math.abs(preset - safeValue) < Math.abs(closest - safeValue) ? preset : closest
  );
};

const normalizeExportFps = (value: number) => {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_EXPORT_FPS;

  return EXPORT_FPS_PRESETS.reduce((closest, preset) =>
    Math.abs(preset - safeValue) < Math.abs(closest - safeValue) ? preset : closest
  );
};

const normalizeExportSpeed = (value: number) =>
  clamp(Number.isFinite(value) ? value : MIN_EXPORT_SPEED, MIN_EXPORT_SPEED, MAX_EXPORT_SPEED);

const fileExtension = (fileName: string) => {
  const extension = fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return extension || "mp4";
};

const mountInputFile = async (ffmpeg: FFmpeg, file: File, prefix: string): Promise<MountedInputFile> => {
  const mountPoint = `/${prefix}-${Date.now()}-${crypto.randomUUID()}`;
  const inputName = `source.${fileExtension(file.name)}`;
  let didCreateDir = false;

  try {
    await ffmpeg.createDir(mountPoint);
    didCreateDir = true;

    const mounted = await ffmpeg.mount(
      FFFSType.WORKERFS,
      {
        blobs: [
          {
            data: file,
            name: inputName
          }
        ]
      },
      mountPoint
    );

    if (!mounted) {
      throw new Error(WORKERFS_UNSUPPORTED_MESSAGE);
    }

    return {
      inputPath: `${mountPoint}/${inputName}`,
      cleanup: async () => {
        await ffmpeg.unmount(mountPoint).catch(() => undefined);
        await ffmpeg.deleteDir(mountPoint).catch(() => undefined);
      }
    };
  } catch (error) {
    if (didCreateDir) {
      await ffmpeg.unmount(mountPoint).catch(() => undefined);
      await ffmpeg.deleteDir(mountPoint).catch(() => undefined);
    }

    if (error instanceof Error && error.message === WORKERFS_UNSUPPORTED_MESSAGE) {
      throw error;
    }

    throw new Error(WORKERFS_UNSUPPORTED_MESSAGE);
  }
};

const buildExportTiming = (segments: Segment[], requestedFps: number, speed: number): ExportTiming => {
  const duration = Math.max(timelineDuration(segments) / speed, 0.001);
  const frameCount = Math.max(1, Math.round(duration * requestedFps));
  const correctedFps = frameCount / duration;
  const targetDurationCentiseconds = Math.max(1, Math.round(duration * 100));
  const lastFrameTimeCentiseconds = Math.round(((frameCount - 1) / correctedFps) * 100);

  return {
    correctedFps,
    duration,
    frameCount,
    gifFinalDelay: clamp(targetDurationCentiseconds - lastFrameTimeCentiseconds, 1, 65535)
  };
};

const parseTimecodeSeconds = (value: string) => {
  const match = /(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
};

const parseFFmpegProgressSample = (message: string): FFmpegProgressSample => {
  let frame: number | null = null;
  let seconds: number | null = null;
  const lines = message.replace(/\r/g, "\n").split("\n");

  for (const line of lines) {
    const frameMatch = /(?:^|\s)frame=\s*(\d+)/.exec(line);
    if (frameMatch) {
      const nextFrame = Number(frameMatch[1]);
      if (Number.isFinite(nextFrame) && nextFrame >= 0) {
        frame = Math.max(frame ?? 0, nextFrame);
      }
    }

    const outTimeUnitsMatch = /^out_time_(?:us|ms)=(-?\d+)/.exec(line.trim());
    if (outTimeUnitsMatch) {
      const rawValue = Number(outTimeUnitsMatch[1]);
      if (Number.isFinite(rawValue) && rawValue >= 0) {
        seconds = Math.max(seconds ?? 0, rawValue / 1_000_000);
      }
    }

    const outTimeMatch = /^out_time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line.trim());
    if (outTimeMatch) {
      const nextSeconds = parseTimecodeSeconds(outTimeMatch[1]);
      if (nextSeconds !== null) {
        seconds = Math.max(seconds ?? 0, nextSeconds);
      }
    }

    const statsTimeMatch = /(?:^|\s)time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(line);
    if (statsTimeMatch) {
      const nextSeconds = parseTimecodeSeconds(statsTimeMatch[1]);
      if (nextSeconds !== null) {
        seconds = Math.max(seconds ?? 0, nextSeconds);
      }
    }
  }

  return { frame, seconds };
};

const latestFFmpegError = (lines: string[]) =>
  lines
    .slice()
    .reverse()
    .find((line) => /error|invalid|failed|unable|cannot|no such|not found|could not/i.test(line));

export function useExporter({ file, segments }: UseExporterOptions) {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [exportFormat, setExportFormatState] = useState<ExportFormat>("webp");
  const [exportFps, setExportFpsState] = useState(normalizeExportFps(DEFAULT_EXPORT_FPS));
  const [exportHeight, setExportHeightState] = useState(720);
  const [exportQuality, setExportQualityState] = useState(76);
  const [exportSpeed, setExportSpeedState] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportResultFormat, setExportResultFormat] = useState<ExportFormat | null>(null);
  const exportFormatRef = useRef(exportFormat);
  const exportFpsRef = useRef(exportFps);
  const exportHeightRef = useRef(exportHeight);
  const exportQualityRef = useRef(exportQuality);
  const exportSpeedRef = useRef(exportSpeed);
  const renderDurationRef = useRef(0);
  const renderFrameCountRef = useRef(0);
  const renderProgressRef = useRef(0);
  const renderStartedAtRef = useRef(0);
  const didSeeLowRenderSampleRef = useRef(false);
  const lastLogLinesRef = useRef<string[]>([]);

  const clearExportResult = useCallback(() => {
    setExportUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setExportResultFormat(null);
  }, []);

  const clearExport = useCallback(() => {
    clearExportResult();
    setExportStatus("");
    setExportProgress(0);
  }, [clearExportResult]);

  const setExportFormat = useCallback(
    (format: ExportFormat) => {
      const currentFormat = exportFormatRef.current;
      const currentHeight = normalizeExportHeight(exportHeightRef.current);
      const nextHeight = currentHeight;

      if (format !== currentFormat || nextHeight !== exportHeightRef.current) {
        clearExport();
      }
      exportFormatRef.current = format;
      exportHeightRef.current = nextHeight;
      setExportFormatState(format);
      setExportHeightState(nextHeight);
    },
    [clearExport]
  );

  const setExportFps = useCallback(
    (value: SetStateAction<number>) => {
      const nextValue = normalizeExportFps(resolveStateAction(value, exportFpsRef.current));
      if (nextValue !== exportFpsRef.current) {
        clearExport();
      }
      exportFpsRef.current = nextValue;
      setExportFpsState(nextValue);
    },
    [clearExport]
  );

  const setExportHeight = useCallback(
    (value: SetStateAction<number>) => {
      const nextValue = normalizeExportHeight(resolveStateAction(value, exportHeightRef.current));
      if (nextValue !== exportHeightRef.current) {
        clearExport();
      }
      exportHeightRef.current = nextValue;
      setExportHeightState(nextValue);
    },
    [clearExport]
  );

  const setExportQuality = useCallback(
    (value: SetStateAction<number>) => {
      const nextValue = resolveStateAction(value, exportQualityRef.current);
      if (nextValue !== exportQualityRef.current) {
        clearExport();
      }
      exportQualityRef.current = nextValue;
      setExportQualityState(nextValue);
    },
    [clearExport]
  );

  const setExportSpeed = useCallback(
    (value: SetStateAction<number>) => {
      const nextValue = normalizeExportSpeed(resolveStateAction(value, exportSpeedRef.current));
      if (nextValue !== exportSpeedRef.current) {
        clearExport();
      }
      exportSpeedRef.current = nextValue;
      setExportSpeedState(nextValue);
    },
    [clearExport]
  );

  useEffect(() => {
    exportFormatRef.current = exportFormat;
    exportFpsRef.current = exportFps;
    exportHeightRef.current = exportHeight;
    exportQualityRef.current = exportQuality;
    exportSpeedRef.current = exportSpeed;
  }, [exportFormat, exportFps, exportHeight, exportQuality, exportSpeed]);

  useEffect(() => {
    return () => {
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
    };
  }, [exportUrl]);

  const updateRenderProgress = useCallback((encodedProgress: number) => {
    if (!Number.isFinite(encodedProgress) || encodedProgress <= 0) {
      return;
    }

    const clampedEncodedProgress = clamp(encodedProgress, 0, 1);
    const elapsedMs = performance.now() - renderStartedAtRef.current;

    if (!didSeeLowRenderSampleRef.current && clampedEncodedProgress > 0.25 && elapsedMs < 1500) {
      return;
    }

    if (clampedEncodedProgress <= 0.25) {
      didSeeLowRenderSampleRef.current = true;
    }

    const nextProgress = clamp(0.1 + clampedEncodedProgress * 0.86, 0.1, 0.96);
    renderProgressRef.current = Math.max(renderProgressRef.current, nextProgress);
    setExportProgress(renderProgressRef.current);
    setExportStatus(`Rendering ${Math.round(renderProgressRef.current * 100)}%`);
  }, []);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      lastLogLinesRef.current = [...lastLogLinesRef.current.slice(-24), message];
      const sample = parseFFmpegProgressSample(message);
      const duration = renderDurationRef.current;
      const frameCount = renderFrameCountRef.current;

      if (sample.seconds !== null && duration > 0) {
        updateRenderProgress(sample.seconds / duration);
      }

      if (sample.frame !== null && frameCount > 0) {
        updateRenderProgress(sample.frame / frameCount);
      }
    });

    await ffmpeg.load({
      classWorkerURL: ffmpegWorkerURL,
      coreURL,
      wasmURL
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }, [updateRenderProgress]);

  const buildExportFilter = useCallback(
    (format: ExportFormat, timing: ExportTiming, height: number, speed: number) => {
      const parts: string[] = [];
      const setPts = `(PTS-STARTPTS)/${formatFFmpegNumber(speed)}`;
      segments.forEach((segment, index) => {
        parts.push(
          `[0:v]trim=start=${segment.sourceStart.toFixed(4)}:end=${segment.sourceEnd.toFixed(
            4
          )},setpts=${setPts}[v${index}]`
        );
      });

      const concatInputs = segments.map((_, index) => `[v${index}]`).join("");
      const resized = `fps=${formatFFmpegNumber(timing.correctedFps)},scale=-2:${height}:flags=lanczos`;

      if (format === "gif") {
        parts.push(
          `${concatInputs}concat=n=${segments.length}:v=1:a=0[vcat]`,
          `[vcat]${resized},split[s0][s1]`,
          "[s0]palettegen=max_colors=256[p]",
          "[s1][p]paletteuse=dither=bayer:bayer_scale=3[vout]"
        );
      } else {
        parts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=0,${resized},format=rgba[vout]`);
      }

      return parts.join(";");
    },
    [segments]
  );

  const exportTimeline = useCallback(async () => {
    if (!file || !segments.length || isExporting) {
      return;
    }

    clearExportResult();
    setIsExporting(true);
    setExportProgress(0.01);
    setExportStatus("Loading ffmpeg.wasm");
    const renderFormat = exportFormat;
    const renderFps = normalizeExportFps(exportFps);
    const renderHeight = normalizeExportHeight(exportHeight);
    const renderQuality = clamp(Number.isFinite(exportQuality) ? exportQuality : 76, 10, 100);
    const renderSpeed = normalizeExportSpeed(exportSpeed);
    const timing = buildExportTiming(segments, renderFps, renderSpeed);
    renderDurationRef.current = timing.duration;
    renderFrameCountRef.current = timing.frameCount;
    renderProgressRef.current = 0;
    renderStartedAtRef.current = performance.now();
    didSeeLowRenderSampleRef.current = false;
    lastLogLinesRef.current = [];

    let mountedInput: MountedInputFile | null = null;
    const outputName = `loopcut-${Date.now()}.${renderFormat}`;

    try {
      setExportProgress(0.03);
      const ffmpeg = await loadFFmpeg();
      setExportProgress(0.07);
      setExportStatus("Mounting video");
      mountedInput = await mountInputFile(ffmpeg, file, "render-input");
      setExportProgress(0.1);
      const filter = buildExportFilter(renderFormat, timing, renderHeight, renderSpeed);

      setExportStatus("Rendering 10%");
      const progressArgs = [
        "-hide_banner",
        "-loglevel",
        "info",
        "-stats",
        "-stats_period",
        "0.25",
        "-progress",
        "pipe:1"
      ];
      const args =
        renderFormat === "gif"
          ? [
              ...progressArgs,
              "-i",
              mountedInput.inputPath,
              "-filter_complex",
              filter,
              "-map",
              "[vout]",
              "-an",
              "-loop",
              "0",
              "-final_delay",
              `${timing.gifFinalDelay}`,
              "-f",
              "gif",
              outputName
            ]
          : [
              ...progressArgs,
              "-i",
              mountedInput.inputPath,
              "-filter_complex",
              filter,
              "-map",
              "[vout]",
              "-an",
              "-loop",
              "0",
              "-c:v",
              "libwebp_anim",
              "-quality",
              `${renderQuality}`,
              "-compression_level",
              "4",
              outputName
            ];

      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        const detail = latestFFmpegError(lastLogLinesRef.current);
        throw new Error(detail ? `FFmpeg error: ${detail}` : `FFmpeg exited with code ${exitCode}`);
      }
      setExportProgress(Math.max(renderProgressRef.current, 0.96));
      setExportStatus("Finalizing");
      const data = await ffmpeg.readFile(outputName);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: renderFormat === "gif" ? "image/gif" : "image/webp" });
      const resultUrl = URL.createObjectURL(blob);
      const settingsStillMatch =
        exportFormatRef.current === renderFormat &&
        exportFpsRef.current === renderFps &&
        exportHeightRef.current === renderHeight &&
        exportQualityRef.current === renderQuality &&
        exportSpeedRef.current === renderSpeed;

      if (!settingsStillMatch) {
        URL.revokeObjectURL(resultUrl);
        setExportStatus("Settings changed. Render again.");
        return;
      }

      setExportUrl(resultUrl);
      setExportResultFormat(renderFormat);
      setExportProgress(1);
      setExportStatus("Ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Export failed");
      setExportStatus(message);
    } finally {
      const ffmpeg = ffmpegRef.current;
      if (ffmpeg) {
        await mountedInput?.cleanup();
        await ffmpeg.deleteFile(outputName).catch(() => undefined);
      }
      renderDurationRef.current = 0;
      renderFrameCountRef.current = 0;
      renderProgressRef.current = 0;
      renderStartedAtRef.current = 0;
      didSeeLowRenderSampleRef.current = false;
      setIsExporting(false);
    }
  }, [
    buildExportFilter,
    clearExportResult,
    exportFormat,
    exportFps,
    exportHeight,
    exportQuality,
    exportSpeed,
    file,
    isExporting,
    loadFFmpeg,
    segments
  ]);

  return {
    clearExport,
    exportFormat,
    setExportFormat,
    exportFps,
    setExportFps,
    exportHeight,
    setExportHeight,
    exportQuality,
    setExportQuality,
    exportSpeed,
    setExportSpeed,
    isExporting,
    exportProgress,
    exportStatus,
    exportUrl,
    exportResultFormat,
    exportTimeline
  };
}
