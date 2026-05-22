import { CircleAlert, Info, Upload } from "lucide-react";
import type { RefObject } from "react";

type VideoViewerProps = {
  file: File | null;
  isPlaying: boolean;
  onChooseVideo: () => void;
  onLoadedMetadata: () => void;
  onVideoError: () => void;
  onTimeUpdate: () => void;
  setIsPlaying: (value: boolean) => void;
  videoError: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
};

export function VideoViewer({
  file,
  isPlaying,
  onChooseVideo,
  onLoadedMetadata,
  onVideoError,
  onTimeUpdate,
  setIsPlaying,
  videoError,
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
            onError={onVideoError}
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
        <div className="emptyState">
          {videoError ? (
            <div className="viewerError" role="alert">
              <div className="viewerErrorHeader">
                <CircleAlert size={16} />
                <span>Error</span>
              </div>
              <div className="viewerErrorBody">{videoError}</div>
            </div>
          ) : null}
          <button className="emptyPicker" onClick={onChooseVideo} type="button">
            <Upload size={28} />
            <span>Choose video</span>
            <span className="emptyPickerHint">
              <Info size={14} />
              Press space to cut
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
