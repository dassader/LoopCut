import type { PointerEvent, RefObject, WheelEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { MAX_ZOOM, MIN_ZOOM } from "../../constants";
import { outputTimeToTimelineX } from "../../lib/timeline";
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
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
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
              <div className="playheadCap" />
              <div className="playheadLine" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
