import { useEffect, useRef, useState } from 'react';
import { useGridCellEditor, type CustomCellEditorProps } from 'ag-grid-react';
import type { Device } from '../../shared/types';
import { validateDevice } from './model';
type Props = Pick<
  CustomCellEditorProps<Device, string, unknown>,
  'value' | 'onValueChange' | 'parseValue' | 'data'
>;
export function NameEditor({ value, onValueChange, parseValue, data }: Props) {
  // Preserve raw typing (including spaces); AG Grid receives the parsed draft.
  const [text, setText] = useState(value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const error = validateDevice({ ...data, name: text.trim() }).name;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useGridCellEditor({
    getValidationErrors: () => (error ? [error] : null),
    // The grid asks for this element only while the editor is mounted.
    getValidationElement: () => input.current!,
  });
  return (
    <input
      ref={input}
      className="name-editor"
      aria-label="Device name editor"
      aria-invalid={!!error}
      title={error ?? '1–80 characters; surrounding spaces are trimmed'}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onValueChange(parseValue(event.target.value) as string);
      }}
    />
  );
}
