import { Info, Upload } from "lucide-react";
import type { RefObject } from "react";

type VideoViewerProps = {
  file: File | null;
  isPlaying: boolean;
  onChooseVideo: () => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  setIsPlaying: (value: boolean) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
};

export function VideoViewer({
  file,
  isPlaying,
  onChooseVideo,
  onLoadedMetadata,
  onTimeUpdate,
  setIsPlaying,
  videoRef,
  videoUrl
}: VideoViewerProps) {
  return (
    <section className={`viewer ${videoUrl ? "viewerLoaded" : ""}`}>
      {videoUrl ? (
        <>
          <video
            className="video"
            onEnded={() => setIsPlaying(false)}
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            playsInline
            ref={videoRef}
            src={videoUrl}
          />
          <div className="viewerHud">
            <span>{file?.name}</span>
          </div>
        </>
      ) : (
        <button className="emptyPicker" onClick={onChooseVideo} type="button">
          <Upload size={28} />
          <span>Choose video</span>
          <span className="emptyPickerHint">
            <Info size={14} />
            Press space to cut
          </span>
        </button>
      )}
    </section>
  );
}
