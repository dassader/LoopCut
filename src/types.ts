export type Segment = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  color: string;
};

export type TimelineHit = {
  segment: Segment;
  index: number;
  clipStart: number;
  offset: number;
  sourceTime: number;
};

export type Thumbnail = {
  time: number;
  url: string;
};

export type ExportFormat = "webp" | "gif";

export type DropMarker = {
  id: string;
  side: "before" | "after";
};
