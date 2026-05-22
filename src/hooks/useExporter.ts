import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GIF_COLORS,
  DEFAULT_EXPORT_FPS,
  EXPORT_FPS_PRESETS,
  EXPORT_GIF_COLOR_PRESETS,
  EXPORT_HEIGHT_PRESETS,
  MAX_EXPORT_SPEED,
  MIN_EXPORT_SPEED
} from "../constants";
import { exportBrowserAnimation } from "../lib/browserEncoder";
import { createExportPlan, ensureExportCapabilities } from "../lib/capabilities";
import { clamp } from "../lib/math";
import { createDownloadWriter, type DownloadWriter } from "../lib/streamDownload";
import type { ExportFormat, Segment } from "../types";

type UseExporterOptions = {
  file: File | null;
  segments: Segment[];
  sourceHeight: number | null;
  sourceWidth: number | null;
  videoElement: HTMLVideoElement | null;
};

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

const normalizeGifColorCount = (value: number) => {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_GIF_COLORS;

  return EXPORT_GIF_COLOR_PRESETS.reduce((closest, preset) =>
    Math.abs(preset - safeValue) < Math.abs(closest - safeValue) ? preset : closest
  );
};

const exportMimeType = (format: ExportFormat) => (format === "gif" ? "image/gif" : "image/webp");

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const createAbortError = () => new DOMException("Export canceled.", "AbortError");

export function useExporter({ file, segments, sourceHeight, sourceWidth, videoElement }: UseExporterOptions) {
  const [exportFormat, setExportFormatState] = useState<ExportFormat>("webp");
  const [exportFps, setExportFpsState] = useState(normalizeExportFps(DEFAULT_EXPORT_FPS));
  const [exportHeight, setExportHeightState] = useState(720);
  const [exportQuality, setExportQualityState] = useState(76);
  const [exportSpeed, setExportSpeedState] = useState(1);
  const [gifColorCount, setGifColorCountState] = useState(DEFAULT_GIF_COLORS);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const exportFormatRef = useRef(exportFormat);
  const exportFpsRef = useRef(exportFps);
  const exportHeightRef = useRef(exportHeight);
  const exportQualityRef = useRef(exportQuality);
  const exportSpeedRef = useRef(exportSpeed);
  const gifColorCountRef = useRef(gifColorCount);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearExport = useCallback(() => {
    setExportStatus("");
    setExportProgress(0);
  }, []);

  const setExportFormat = useCallback(
    (format: ExportFormat) => {
      const nextHeight = normalizeExportHeight(exportHeightRef.current);
      if (format !== exportFormatRef.current || nextHeight !== exportHeightRef.current) {
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
      const nextValue = clamp(resolveStateAction(value, exportQualityRef.current), 10, 100);
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

  const setGifColorCount = useCallback(
    (value: SetStateAction<number>) => {
      const nextValue = normalizeGifColorCount(resolveStateAction(value, gifColorCountRef.current));
      if (nextValue !== gifColorCountRef.current) {
        clearExport();
      }
      gifColorCountRef.current = nextValue;
      setGifColorCountState(nextValue);
    },
    [clearExport]
  );

  const cancelExport = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) {
      return;
    }

    setExportStatus("Canceling");
    controller.abort();
  }, []);

  useEffect(() => {
    exportFormatRef.current = exportFormat;
    exportFpsRef.current = exportFps;
    exportHeightRef.current = exportHeight;
    exportQualityRef.current = exportQuality;
    exportSpeedRef.current = exportSpeed;
    gifColorCountRef.current = gifColorCount;
  }, [exportFormat, exportFps, exportHeight, exportQuality, exportSpeed, gifColorCount]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const exportTimeline = useCallback(async () => {
    if (!file || !segments.length || isExporting || abortControllerRef.current) {
      return;
    }

    const renderFormat = exportFormat;
    const renderFps = normalizeExportFps(exportFps);
    const renderHeight = normalizeExportHeight(exportHeight);
    const renderQuality = clamp(Number.isFinite(exportQuality) ? exportQuality : 76, 10, 100);
    const renderSpeed = normalizeExportSpeed(exportSpeed);
    const renderGifColorCount = normalizeGifColorCount(gifColorCount);
    const controller = new AbortController();
    let writer: DownloadWriter | null = null;

    abortControllerRef.current = controller;
    setIsExporting(true);
    setExportProgress(0.01);
    setExportStatus("Checking browser capabilities");

    try {
      const plan = createExportPlan({
        fps: renderFps,
        height: renderHeight,
        segments,
        sourceHeight,
        sourceWidth,
        speed: renderSpeed
      });

      await ensureExportCapabilities({
        format: renderFormat,
        frameCount: plan.frameCount,
        height: plan.height,
        signal: controller.signal,
        width: plan.width
      });
      setExportStatus("Preparing download");
      writer = await createDownloadWriter(`loopcut.${renderFormat}`, exportMimeType(renderFormat));
      if (controller.signal.aborted) {
        throw createAbortError();
      }
      await exportBrowserAnimation({
        file,
        format: renderFormat,
        fps: renderFps,
        gifColorCount: renderGifColorCount,
        height: renderHeight,
        onProgress: setExportProgress,
        onStatus: setExportStatus,
        quality: renderQuality,
        segments,
        signal: controller.signal,
        sourceHeight,
        sourceWidth,
        speed: renderSpeed,
        videoElement,
        writer
      });
      if (controller.signal.aborted) {
        throw createAbortError();
      }
      writer.close();
      setExportProgress(1);
      setExportStatus("Ready");
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        writer?.abort("Export canceled");
        setExportProgress(0);
        setExportStatus("Canceled");
      } else {
        writer?.abort(error instanceof Error ? error.message : "Export failed");
        setExportStatus(error instanceof Error ? error.message : String(error || "Export failed"));
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsExporting(false);
    }
  }, [
    exportFormat,
    exportFps,
    exportHeight,
    exportQuality,
    exportSpeed,
    file,
    gifColorCount,
    isExporting,
    segments,
    sourceHeight,
    sourceWidth,
    videoElement
  ]);

  return {
    clearExport,
    cancelExport,
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
    gifColorCount,
    setGifColorCount,
    isExporting,
    exportProgress,
    exportStatus,
    exportTimeline
  };
}
