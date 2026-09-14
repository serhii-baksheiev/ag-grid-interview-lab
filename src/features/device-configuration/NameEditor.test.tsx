import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useGridCellEditor } from 'ag-grid-react';
import { afterEach, expect, it, vi } from 'vitest';
import { generateDevices } from '../../shared/data/generator';
import { fieldError } from './model';
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

it('reports the same error text fieldError computes for a blank name', () => {
  const data = generateDevices(1)[0]!;
  render(
    <NameEditor
      value="Sensor"
      data={data}
      onValueChange={vi.fn()}
      parseValue={(value) => String(value).trim()}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Device name editor' });
  fireEvent.change(input, { target: { value: '   ' } });
  const { getValidationErrors } = vi
    .mocked(useGridCellEditor)
    .mock.calls.at(-1)![0];
  expect(getValidationErrors!()).toEqual([fieldError(data, 'name', '')]);
});

it('reports the same error text fieldError computes for an over-long name', () => {
  const data = generateDevices(1)[0]!;
  const overLong = 'a'.repeat(81);
  render(
    <NameEditor
      value="Sensor"
      data={data}
      onValueChange={vi.fn()}
      parseValue={(value) => String(value).trim()}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Device name editor' });
  fireEvent.change(input, { target: { value: overLong } });
  const { getValidationErrors } = vi
    .mocked(useGridCellEditor)
    .mock.calls.at(-1)![0];
  expect(getValidationErrors!()).toEqual([
    fieldError(data, 'name', overLong.trim()),
  ]);
});
