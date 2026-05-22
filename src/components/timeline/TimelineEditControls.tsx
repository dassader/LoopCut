import { Pause, Play, Scissors, Trash2 } from "lucide-react";
import { IconButton, PrimaryButton } from "../ui/Buttons";

type TimelineEditControlsProps = {
  cutAtPlayhead: () => void;
  hasVideo: boolean;
  isPlaying: boolean;
  removeSelected: () => void;
  selectedSegmentId: string | null;
  segmentsCount: number;
  togglePlayback: () => void;
};

export function TimelineEditControls({
  cutAtPlayhead,
  hasVideo,
  isPlaying,
  removeSelected,
  selectedSegmentId,
  segmentsCount,
  togglePlayback
}: TimelineEditControlsProps) {
  return (
    <div className="timelineEditControls" data-clip-control="true">
      <IconButton
        aria-label={isPlaying ? "Pause" : "Play"}
        disabled={!hasVideo}
        onClick={togglePlayback}
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </IconButton>
      <PrimaryButton disabled={!hasVideo} onClick={cutAtPlayhead} title="Cut">
        <Scissors size={15} />
        <span>Cut</span>
      </PrimaryButton>
      <IconButton
        aria-label="Delete"
        className="danger"
        disabled={!selectedSegmentId || segmentsCount <= 1}
        onClick={removeSelected}
        title="Delete"
      >
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}
