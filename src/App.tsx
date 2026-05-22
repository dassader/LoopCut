import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useRef } from "react";
import { ExportPanel } from "./components/panels/ExportPanel";
import { SidePanel } from "./components/panels/SidePanel";
import { TimingPanel } from "./components/panels/TimingPanel";
import { Timeline } from "./components/timeline/Timeline";
import { VideoViewer } from "./components/viewer/VideoViewer";
import { useExporter } from "./hooks/useExporter";
import { useThumbnails } from "./hooks/useThumbnails";
import { useVideoEditor } from "./hooks/useVideoEditor";
import { EXPORT_HEIGHT_PRESETS } from "./constants";

const DEFAULT_EXPORT_HEIGHT = 720;

const chooseInitialExportHeight = (sourceHeight: number) => {
  const targetHeight = Math.min(sourceHeight, DEFAULT_EXPORT_HEIGHT);

  return EXPORT_HEIGHT_PRESETS.reduce(
    (best, height) => (height <= targetHeight ? height : best),
    EXPORT_HEIGHT_PRESETS[0]
  );
};

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editor = useVideoEditor();
  const exporter = useExporter({
    file: editor.file,
    segments: editor.segments
  });
  const { thumbnails } = useThumbnails(editor.videoUrl, editor.duration);
  const { setExportHeight } = exporter;
  const { sourceHeight } = editor;

  useEffect(() => {
    if (!sourceHeight) {
      return;
    }

    setExportHeight(chooseInitialExportHeight(sourceHeight));
  }, [setExportHeight, sourceHeight]);

  const chooseVideo = () => fileInputRef.current?.click();

  const loadVideoFile = (file: File) => {
    exporter.clearExport();
    editor.loadFile(file);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) {
      loadVideoFile(nextFile);
      event.target.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) {
      loadVideoFile(nextFile);
    }
  };

  return (
    <main className="app" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <input accept="video/*" className="hiddenInput" onChange={onFileChange} ref={fileInputRef} type="file" />

      <section className="workspace">
        <VideoViewer
          file={editor.file}
          isPlaying={editor.isPlaying}
          onChooseVideo={chooseVideo}
          onLoadedMetadata={editor.onLoadedMetadata}
          onTimeUpdate={editor.onVideoTimeUpdate}
          setIsPlaying={editor.setIsPlaying}
          videoRef={editor.videoRef}
          videoUrl={editor.videoUrl}
        />

        <SidePanel>
          <TimingPanel
            fps={editor.fps}
            setFps={editor.setFps}
          />
          <ExportPanel
            exportFormat={exporter.exportFormat}
            exportFps={exporter.exportFps}
            exportProgress={exporter.exportProgress}
            exportQuality={exporter.exportQuality}
            exportResultFormat={exporter.exportResultFormat}
            exportSpeed={exporter.exportSpeed}
            exportStatus={exporter.exportStatus}
            exportTimeline={exporter.exportTimeline}
            exportUrl={exporter.exportUrl}
            exportHeight={exporter.exportHeight}
            hasFile={Boolean(editor.file)}
            isExporting={exporter.isExporting}
            segmentsCount={editor.segments.length}
            setExportFormat={exporter.setExportFormat}
            setExportFps={exporter.setExportFps}
            setExportQuality={exporter.setExportQuality}
            setExportSpeed={exporter.setExportSpeed}
            setExportHeight={exporter.setExportHeight}
          />
        </SidePanel>
      </section>

      <Timeline
        currentOutputTime={editor.currentOutputTime}
        cutAtPlayhead={editor.cutAtPlayhead}
        draggingSegmentId={editor.draggingSegmentId}
        dropMarker={editor.dropMarker}
        hasVideo={Boolean(editor.videoUrl)}
        isPlaying={editor.isPlaying}
        moveSegment={editor.moveSegment}
        onPointerCancel={editor.onTimelinePointerUp}
        onPointerDown={editor.onTimelinePointerDown}
        onPointerMove={editor.onTimelinePointerMove}
        onPointerUp={editor.onTimelinePointerUp}
        onWheel={editor.onTimelineWheel}
        removeSelected={editor.removeSelected}
        selectedSegmentId={editor.selectedSegmentId}
        segments={editor.segments}
        setDraggingSegmentId={editor.setDraggingSegmentId}
        setDropMarker={editor.setDropMarker}
        setSelectedSegmentId={editor.setSelectedSegmentId}
        setZoom={editor.setZoom}
        thumbnails={thumbnails}
        timelineRef={editor.timelineRef}
        timelineWidth={editor.timelineWidth}
        togglePlayback={editor.togglePlayback}
        zoom={editor.zoom}
      />
    </main>
  );
}

export default App;
