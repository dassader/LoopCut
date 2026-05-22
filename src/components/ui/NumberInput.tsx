import { type KeyboardEvent, useEffect, useState } from "react";

type NumberInputProps = {
  max?: number;
  min?: number;
  normalize?: (value: number) => number;
  onCommit: (value: number) => void;
  step?: number | string;
  value: number;
};

const formatNumberInputValue = (value: number) => (Number.isFinite(value) ? `${value}` : "");

export function NumberInput({ max, min, normalize, onCommit, step, value }: NumberInputProps) {
  const [draft, setDraft] = useState(formatNumberInputValue(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraft(formatNumberInputValue(value));
    }
  }, [isEditing, value]);

  const resetDraft = () => {
    setDraft(formatNumberInputValue(value));
  };

  const commitDraft = () => {
    if (!draft.trim()) {
      resetDraft();
      return;
    }

    const parsed = Number(draft);

    if (!Number.isFinite(parsed)) {
      resetDraft();
      return;
    }

    const nextValue = normalize ? normalize(parsed) : parsed;
    onCommit(nextValue);
    setDraft(formatNumberInputValue(nextValue));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      resetDraft();
      event.currentTarget.blur();
    }
  };

  return (
    <input
      max={max}
      min={min}
      onBlur={() => {
        setIsEditing(false);
        commitDraft();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setIsEditing(true)}
      onKeyDown={onKeyDown}
      step={step}
      type="number"
      value={draft}
    />
  );
}
