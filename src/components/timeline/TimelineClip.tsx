import { GripVertical } from "lucide-react";
import { segmentDuration } from "../../lib/timeline";
import type { DropMarker, Segment, Thumbnail } from "../../types";
import { ClipFilmstrip } from "./ClipFilmstrip";

type TimelineClipProps = {
  draggingSegmentId: string | null;
  dropMarker: DropMarker | null;
  moveSegment: (dragId: string, targetId: string, side: "before" | "after") => void;
  segment: Segment;
  selectedSegmentId: string | null;
  setDraggingSegmentId: (id: string | null) => void;
  setDropMarker: (marker: DropMarker | null) => void;
  setSelectedSegmentId: (id: string) => void;
  thumbnails: Thumbnail[];
  zoom: number;
};

export function TimelineClip({
  draggingSegmentId,
  dropMarker,
  moveSegment,
  segment,
  selectedSegmentId,
  setDraggingSegmentId,
  setDropMarker,
  setSelectedSegmentId,
  thumbnails,
  zoom
}: TimelineClipProps) {
  const width = Math.max(34, segmentDuration(segment) * zoom);
  const isSelected = segment.id === selectedSegmentId;
  const markerBefore = dropMarker?.id === segment.id && dropMarker.side === "before";
  const markerAfter = dropMarker?.id === segment.id && dropMarker.side === "after";

  return (
    <div
      className={`clip ${isSelected ? "selected" : ""}`}
      data-clip-control="true"
      draggable
      onClick={() => setSelectedSegmentId(segment.id)}
      onDragEnd={() => {
        setDraggingSegmentId(null);
        setDropMarker(null);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientX - rect.left > rect.width / 2 ? "after" : "before";
        setDropMarker({ id: segment.id, side });
      }}
      onDragStart={(event) => {
        setDraggingSegmentId(segment.id);
        event.dataTransfer.setData("text/plain", segment.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const dragId = event.dataTransfer.getData("text/plain") || draggingSegmentId;
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientX - rect.left > rect.width / 2 ? "after" : "before";

        if (dragId) {
          moveSegment(dragId, segment.id, side);
        }
        setDropMarker(null);
      }}
      style={{ width }}
    >
      {markerBefore ? <div className="dropLine before" /> : null}
      {markerAfter ? <div className="dropLine after" /> : null}
      <div className="clipColor" style={{ background: segment.color }} />
      <div className="clipGrip">
        <GripVertical size={15} />
      </div>
      <ClipFilmstrip segment={segment} thumbnails={thumbnails} />
    </div>
  );
}
