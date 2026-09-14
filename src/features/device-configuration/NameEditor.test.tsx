import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { generateDevices } from '../../shared/data/generator';
import { NameEditor } from './NameEditor';
vi.mock('ag-grid-react', () => ({ useGridCellEditor: vi.fn() }));
afterEach(cleanup);
it('keeps typing whitespace visible but submits a parsed name and identifies invalid input', () => {
  const onValueChange = vi.fn();
  render(
    <NameEditor
      value="Sensor"
      data={generateDevices(1)[0]}
      onValueChange={onValueChange}
      parseValue={(value) => String(value).trim()}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Device name editor' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '  Reference sensor  ' } });
  expect(input).toHaveValue('  Reference sensor  ');
  expect(onValueChange).toHaveBeenLastCalledWith('Reference sensor');
  fireEvent.change(input, { target: { value: '   ' } });
  expect(input).toHaveAttribute('aria-invalid', 'true');
});
