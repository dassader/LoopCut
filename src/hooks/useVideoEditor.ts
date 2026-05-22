import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent
} from "react";
import { CLIP_COLORS, DEFAULT_FPS, MAX_ZOOM, MIN_CLIP_SECONDS, MIN_ZOOM } from "../constants";
import { clamp } from "../lib/math";
import {
  findTimelineHit,
  outputTimeToTimelineX,
  segmentDuration,
  timelineDuration,
  timelineVisualWidth,
  timelineXToOutputTime
} from "../lib/timeline";
import type { DropMarker, Segment } from "../types";

const uid = () => crypto.randomUUID();

export function useVideoEditor() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const currentOutputRef = useRef(0);
  const playingRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [sourceWidth, setSourceWidth] = useState<number | null>(null);
  const [sourceHeight, setSourceHeight] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [currentOutputTime, setCurrentOutputTime] = useState(0);
  const [zoom, setZoom] = useState(84);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);

  const totalDuration = useMemo(() => timelineDuration(segments), [segments]);
  const timelineWidth = Math.max(860, Math.ceil(timelineVisualWidth(segments, zoom)));
  const frameStep = 1 / fps;

  useEffect(() => {
    currentOutputRef.current = currentOutputTime;
  }, [currentOutputTime]);

  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const seekToOutputTime = useCallback(
    (time: number) => {
      const clamped = clamp(time, 0, totalDuration);
      setCurrentOutputTime(clamped);

      const hit = findTimelineHit(segments, clamped);
      const video = videoRef.current;

      if (video && hit && Number.isFinite(hit.sourceTime)) {
        const sourceTime = clamp(hit.sourceTime, 0, duration || hit.sourceTime);
        if (Math.abs(video.currentTime - sourceTime) > 0.018) {
          video.currentTime = sourceTime;
        }
      }
    },
    [duration, segments, totalDuration]
  );

  useEffect(() => {
    if (!isPlaying) {
      seekToOutputTime(currentOutputTime);
    }
  }, [currentOutputTime, isPlaying, seekToOutputTime, segments]);

  const loadFile = useCallback((nextFile: File) => {
    if (!nextFile.type.startsWith("video/")) {
      return;
    }

    const nextUrl = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setVideoUrl(nextUrl);
    setDuration(0);
    setSourceWidth(null);
    setSourceHeight(null);
    setSegments([]);
    setSelectedSegmentId(null);
    setCurrentOutputTime(0);
    setIsPlaying(false);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const nextWidth = video.videoWidth || null;
    const nextHeight = video.videoHeight || null;
    const firstSegment: Segment = {
      id: uid(),
      sourceStart: 0,
      sourceEnd: nextDuration,
      color: CLIP_COLORS[0]
    };

    setDuration(nextDuration);
    setSourceWidth(nextWidth);
    setSourceHeight(nextHeight);
    setSegments(nextDuration > 0 ? [firstSegment] : []);
    setSelectedSegmentId(nextDuration > 0 ? firstSegment.id : null);
    setCurrentOutputTime(0);
  }, []);

  const cutAtPlayhead = useCallback(() => {
    if (!segments.length) {
      return;
    }

    const hit = findTimelineHit(segments, currentOutputTime);
    if (!hit) {
      return;
    }

    const durationInClip = segmentDuration(hit.segment);
    if (hit.offset <= MIN_CLIP_SECONDS || durationInClip - hit.offset <= MIN_CLIP_SECONDS) {
      return;
    }

    const leftId = uid();
    const rightId = uid();
    const cutSourceTime = hit.segment.sourceStart + hit.offset;
    const left: Segment = {
      ...hit.segment,
      id: leftId,
      sourceEnd: cutSourceTime
    };
    const right: Segment = {
      ...hit.segment,
      id: rightId,
      sourceStart: cutSourceTime,
      color: CLIP_COLORS[(hit.index + 1) % CLIP_COLORS.length]
    };

    setSegments((current) => {
      const next = [...current];
      next.splice(hit.index, 1, left, right);
      return next;
    });
    setSelectedSegmentId(rightId);
  }, [currentOutputTime, segments]);

  const removeSelected = useCallback(() => {
    if (!selectedSegmentId || segments.length <= 1) {
      return;
    }

    const removedIndex = segments.findIndex((segment) => segment.id === selectedSegmentId);
    const nextSegments = segments.filter((segment) => segment.id !== selectedSegmentId);
    const nextSelected = nextSegments[Math.min(removedIndex, nextSegments.length - 1)] ?? null;

    setSegments(nextSegments);
    setSelectedSegmentId(nextSelected?.id ?? null);
    seekToOutputTime(clamp(currentOutputTime, 0, timelineDuration(nextSegments)));
  }, [currentOutputTime, seekToOutputTime, segments, selectedSegmentId]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !segments.length) {
      return;
    }

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    const startTime = currentOutputTime >= totalDuration - 0.02 ? 0 : currentOutputTime;
    seekToOutputTime(startTime);
    await video.play();
    setIsPlaying(true);
  }, [currentOutputTime, isPlaying, seekToOutputTime, segments.length, totalDuration]);

  const moveByFrames = useCallback(
    (direction: -1 | 1) => {
      const video = videoRef.current;
      video?.pause();
      setIsPlaying(false);
      seekToOutputTime(currentOutputTime + direction * frameStep);
    },
    [currentOutputTime, frameStep, seekToOutputTime]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "SELECT" || target?.tagName === "TEXTAREA";

      if (isTyping) {
        return;
      }

      if (event.code === "ArrowLeft") {
        event.preventDefault();
        moveByFrames(-1);
      }

      if (event.code === "ArrowRight") {
        event.preventDefault();
        moveByFrames(1);
      }

      if (event.code === "Space") {
        event.preventDefault();
        cutAtPlayhead();
      }

      if (event.code === "Backspace" || event.code === "Delete") {
        event.preventDefault();
        removeSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cutAtPlayhead, moveByFrames, removeSelected]);

  const onVideoTimeUpdate = useCallback(() => {
    if (!playingRef.current) {
      return;
    }

    const video = videoRef.current;
    const hit = findTimelineHit(segments, currentOutputRef.current);
    if (!video || !hit) {
      return;
    }

    if (video.currentTime >= hit.segment.sourceEnd - 0.025) {
      const nextOutputTime = hit.clipStart + segmentDuration(hit.segment);
      if (nextOutputTime >= totalDuration - 0.025) {
        video.pause();
        setIsPlaying(false);
        seekToOutputTime(totalDuration);
        return;
      }

      const nextHit = findTimelineHit(segments, nextOutputTime + 0.001);
      if (nextHit) {
        setCurrentOutputTime(nextOutputTime);
        video.currentTime = nextHit.segment.sourceStart;
        void video.play();
      }
      return;
    }

    const nextOutputTime =
      hit.clipStart + clamp(video.currentTime - hit.segment.sourceStart, 0, segmentDuration(hit.segment));
    setCurrentOutputTime(clamp(nextOutputTime, 0, totalDuration));
  }, [seekToOutputTime, segments, totalDuration]);

  const outputTimeFromTimelineEvent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) => {
      const viewport = timelineRef.current;
      if (!viewport) {
        return 0;
      }

      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left + viewport.scrollLeft;
      return clamp(timelineXToOutputTime(segments, x, zoom), 0, totalDuration);
    },
    [segments, totalDuration, zoom]
  );

  const onTimelinePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-clip-control='true']")) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      seekToOutputTime(outputTimeFromTimelineEvent(event));
    },
    [outputTimeFromTimelineEvent, seekToOutputTime]
  );

  const onTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPlaying) {
        videoRef.current?.pause();
        setIsPlaying(false);
      }

      seekToOutputTime(outputTimeFromTimelineEvent(event));
    },
    [isPlaying, outputTimeFromTimelineEvent, seekToOutputTime]
  );

  const onTimelineWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const viewport = timelineRef.current;
      if (!viewport) {
        return;
      }

      event.preventDefault();

      const absDeltaX = Math.abs(event.deltaX);
      const absDeltaY = Math.abs(event.deltaY);
      const shouldZoom = absDeltaY > 0 && (absDeltaY >= absDeltaX || event.metaKey || event.ctrlKey || event.altKey);

      if (shouldZoom) {
        const rect = viewport.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const deltaY = event.deltaY;

        setZoom((currentZoom) => {
          const pointerTime = timelineXToOutputTime(segments, viewport.scrollLeft + localX, currentZoom);
          const zoomFactor = Math.exp(-deltaY * 0.0015);
          const nextZoom = clamp(currentZoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);

          requestAnimationFrame(() => {
            viewport.scrollLeft = outputTimeToTimelineX(segments, pointerTime, nextZoom) - localX;
          });

          return nextZoom;
        });
        return;
      }

      viewport.scrollLeft += event.deltaX;
    },
    [segments]
  );

  const moveSegment = useCallback(
    (dragId: string, targetId: string, side: "before" | "after") => {
      if (dragId === targetId) {
        return;
      }

      const dragSegment = segments.find((segment) => segment.id === dragId);
      if (!dragSegment) {
        return;
      }

      const withoutDrag = segments.filter((segment) => segment.id !== dragId);
      const targetIndex = withoutDrag.findIndex((segment) => segment.id === targetId);
      const insertIndex = side === "after" ? targetIndex + 1 : targetIndex;
      const next = [...withoutDrag];
      next.splice(insertIndex, 0, dragSegment);

      setSegments(next);
      setSelectedSegmentId(dragId);
    },
    [segments]
  );

  return {
    file,
    videoUrl,
    duration,
    sourceWidth,
    sourceHeight,
    segments,
    selectedSegmentId,
    setSelectedSegmentId,
    currentOutputTime,
    zoom,
    setZoom,
    fps,
    setFps,
    isPlaying,
    setIsPlaying,
    draggingSegmentId,
    setDraggingSegmentId,
    dropMarker,
    setDropMarker,
    totalDuration,
    timelineWidth,
    videoRef,
    timelineRef,
    loadFile,
    onLoadedMetadata,
    cutAtPlayhead,
    removeSelected,
    togglePlayback,
    onVideoTimeUpdate,
    onTimelinePointerDown,
    onTimelinePointerMove,
    onTimelinePointerUp: () => undefined,
    onTimelineWheel,
    moveSegment
  };
}
