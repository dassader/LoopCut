type ProgressBarProps = {
  value: number;
};

export function ProgressBar({ value }: ProgressBarProps) {
  return (
    <div className="progressTrack">
      <div className="progressFill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

