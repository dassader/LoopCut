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
import { MIN_EXPORT_WIDTH } from "./constants";

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editor = useVideoEditor();
  const exporter = useExporter({
    file: editor.file,
    segments: editor.segments
  });
  const { thumbnails } = useThumbnails(editor.videoUrl, editor.duration);
  const { setExportWidth } = exporter;
  const { sourceWidth } = editor;

  useEffect(() => {
    if (!sourceWidth) {
      return;
    }

    setExportWidth(Math.max(MIN_EXPORT_WIDTH, sourceWidth));
  }, [setExportWidth, sourceWidth]);

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
            exportStatus={exporter.exportStatus}
            exportTimeline={exporter.exportTimeline}
            exportUrl={exporter.exportUrl}
            exportWidth={exporter.exportWidth}
            hasFile={Boolean(editor.file)}
            isExporting={exporter.isExporting}
            segmentsCount={editor.segments.length}
            setExportFormat={exporter.setExportFormat}
            setExportFps={exporter.setExportFps}
            setExportQuality={exporter.setExportQuality}
            setExportWidth={exporter.setExportWidth}
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
