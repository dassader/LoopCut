import type { PointerEvent, RefObject, WheelEvent } from "react";
import { useCallback, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM } from "../../constants";
import { formatClockTime } from "../../lib/time";
import { outputTimeToTimelineX, timelineDuration, timelineXToOutputTime } from "../../lib/timeline";
import type { DropMarker, Segment, Thumbnail } from "../../types";
import { TimelineClip } from "./TimelineClip";
import { TimelineEditControls } from "./TimelineEditControls";

type TimelineProps = {
  currentOutputTime: number;
  cutAtPlayhead: () => void;
  draggingSegmentId: string | null;
  dropMarker: DropMarker | null;
  hasVideo: boolean;
  isPlaying: boolean;
  moveSegment: (dragId: string, targetId: string, side: "before" | "after") => void;
  onPointerCancel: () => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  removeSelected: () => void;
  selectedSegmentId: string | null;
  segments: Segment[];
  setDraggingSegmentId: (id: string | null) => void;
  setDropMarker: (marker: DropMarker | null) => void;
  setSelectedSegmentId: (id: string) => void;
  setZoom: (zoom: number) => void;
  thumbnails: Thumbnail[];
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineWidth: number;
  togglePlayback: () => void;
  zoom: number;
};

export function Timeline({
  currentOutputTime,
  cutAtPlayhead,
  draggingSegmentId,
  dropMarker,
  hasVideo,
  isPlaying,
  moveSegment,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  removeSelected,
  selectedSegmentId,
  segments,
  setDraggingSegmentId,
  setDropMarker,
  setSelectedSegmentId,
  setZoom,
  thumbnails,
  timelineRef,
  timelineWidth,
  togglePlayback,
  zoom
}: TimelineProps) {
  const playheadX = outputTimeToTimelineX(segments, currentOutputTime, zoom);
  const totalDuration = timelineDuration(segments);
  const [hoverTime, setHoverTime] = useState<{ time: number; x: number } | null>(null);

  const updateHoverTime = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const viewport = timelineRef.current;
      if (!viewport || !hasVideo || !segments.length) {
        setHoverTime(null);
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const pointerX = viewport.scrollLeft + localX;
      const time = timelineXToOutputTime(segments, pointerX, zoom);
      const x = outputTimeToTimelineX(segments, time, zoom);

      setHoverTime({ time, x });
    },
    [hasVideo, segments, timelineRef, zoom]
  );

  const clearHoverTime = useCallback(() => setHoverTime(null), []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      updateHoverTime(event);
      onPointerMove(event);
    },
    [onPointerMove, updateHoverTime]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      updateHoverTime(event);
      onPointerDown(event);
    },
    [onPointerDown, updateHoverTime]
  );

  const handlePointerCancel = useCallback(() => {
    clearHoverTime();
    onPointerCancel();
  }, [clearHoverTime, onPointerCancel]);

  return (
    <section className="timelineArea">
      <div className="timelineControlsRow">
        <TimelineEditControls
          cutAtPlayhead={cutAtPlayhead}
          hasVideo={hasVideo}
          isPlaying={isPlaying}
          removeSelected={removeSelected}
          selectedSegmentId={selectedSegmentId}
          segmentsCount={segments.length}
          togglePlayback={togglePlayback}
        />

        <div className="zoomControl timelineZoomControl" data-clip-control="true">
          <ZoomOut size={16} />
          <input
            max={MAX_ZOOM}
            min={MIN_ZOOM}
            onChange={(event) => setZoom(Number(event.target.value))}
            type="range"
            value={zoom}
          />
          <ZoomIn size={16} />
        </div>
      </div>

      <div
        className="timelineViewport"
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerLeave={clearHoverTime}
        onPointerMove={handlePointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        ref={timelineRef}
      >
        <div className="timelineContent" style={{ width: timelineWidth }}>
          <div className="clipLane">
            {segments.map((segment) => (
              <TimelineClip
                draggingSegmentId={draggingSegmentId}
                dropMarker={dropMarker}
                key={segment.id}
                moveSegment={moveSegment}
                segment={segment}
                selectedSegmentId={selectedSegmentId}
                setDraggingSegmentId={setDraggingSegmentId}
                setDropMarker={setDropMarker}
                setSelectedSegmentId={setSelectedSegmentId}
                thumbnails={thumbnails}
                zoom={zoom}
              />
            ))}
          </div>

          {hasVideo && segments.length ? (
            <div className="playhead" style={{ left: playheadX }}>
              <div className="playheadLine" />
            </div>
          ) : null}

          {hasVideo && segments.length && hoverTime ? (
            <div className="timelineTimeTooltip" style={{ left: hoverTime.x }}>
              {formatClockTime(Math.min(Math.max(hoverTime.time, 0), totalDuration))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
