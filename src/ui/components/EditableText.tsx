import { useEffect, useRef, useState, type ChangeEvent } from 'react';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}

export default function EditableText({ value, onCommit, placeholder, multiline, className }: Props) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focused.current = false;
    if (draft !== value) onCommit(draft);
  };

  const common = {
    value: draft,
    placeholder,
    className: `editable ${className ?? ''}`,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: commit,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
  };

  return multiline ? (
    <textarea rows={2} {...common} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
