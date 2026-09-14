import { describe, expect, it } from 'vitest';
import type { ColDef } from 'ag-grid-community';
import { generateDevices, locations } from '../../shared/data/generator';
import type { Device } from '../../shared/types';
import { fieldError, parseNumber } from './model';
import { configurationColumns } from './columns';
import { NameEditor } from './NameEditor';

function columns() {
  return configurationColumns();
}

function columnFor(field: keyof Device): ColDef<Device> {
  const column = columns().find((candidate) => candidate.field === field);
  if (!column)
    throw new Error(`no configuration column declares field "${field}"`);
  return column;
}

function editableFields() {
  return columns()
    .filter((column) => column.editable !== false)
    .map((column) => column.field);
}

// A minimal stand-in for the ICellEditorParams object AG Grid's provided
// number/select editors pass to `cellEditorParams.getValidationErrors`
// (confirmed against ag-grid-community 36.1.0's `AgNumberCellEditor` /
// `AgSelectCellEditor` `getValidationErrors()` in main.esm.mjs: each calls
// `getValidationErrors({ value, cellEditorParams: params, internalErrors })`
// where `params` is the full editor params, including `data`).
function callValidation(
  field: keyof Device,
  value: unknown,
  internalErrors: string[] | null,
  data: Device,
) {
  const column = columnFor(field);
  const fn = column.cellEditorParams?.getValidationErrors;
  if (typeof fn !== 'function')
    throw new Error(`${String(field)} column declares no getValidationErrors`);
  return fn({ value, cellEditorParams: { data }, internalErrors });
}

describe('device configuration column validation', () => {
  const device = () => generateDevices(1, 42)[0]!;

  it('gives exactly the columns this contract names an editable, validated state', () => {
    expect(editableFields()).toEqual([
      'name',
      'location',
      'enabled',
      'samplingInterval',
      'warningThreshold',
      'criticalThreshold',
    ]);
  });

  it('keeps the accessible NameEditor on the name column', () => {
    expect(columnFor('name').cellEditor).toBe(NameEditor);
  });

  it('never invalidates the enabled column, which declares no validation', () => {
    const column = columnFor('enabled');
    expect(column.cellEditorParams?.getValidationErrors).toBeUndefined();
    expect(fieldError(device(), 'enabled', true)).toBeUndefined();
    expect(fieldError(device(), 'enabled', false)).toBeUndefined();
  });

  it('offers every known location as a select option', () => {
    expect(columnFor('location').cellEditorParams?.values).toEqual(locations);
  });

  it('validates location with the domain rule and nothing extra', () => {
    const data = device();
    expect(callValidation('location', '', null, data)).toEqual([
      fieldError(data, 'location', ''),
    ]);
    expect(callValidation('location', locations[0], null, data)).toBeNull();
  });

  describe.each([
    ['samplingInterval', 0, 30] as const,
    ['warningThreshold', 1000, 20] as const,
    ['criticalThreshold', -5, 60] as const,
  ])('%s numeric column', (field, invalidValue, validValue) => {
    it('declares agNumberCellEditor with validation wired in', () => {
      expect(columnFor(field).cellEditor).toBe('agNumberCellEditor');
      expect(
        typeof columnFor(field).cellEditorParams?.getValidationErrors,
      ).toBe('function');
    });

    it('reports exactly the domain error for an invalid parsed value, and only that', () => {
      const data = device();
      expect(callValidation(field, invalidValue, null, data)).toEqual([
        fieldError(data, field, parseNumber(invalidValue)),
      ]);
    });

    it('treats an empty/NaN input as invalid, matching fieldError', () => {
      const data = device();
      expect(callValidation(field, NaN, null, data)).toEqual([
        fieldError(data, field, parseNumber(NaN)),
      ]);
    });

    it('accepts a valid value with no errors', () => {
      const data = device();
      // warningThreshold/criticalThreshold need a companion value that keeps
      // the pair ordered so only the field under test is being probed.
      const companion: Partial<Device> =
        field === 'warningThreshold'
          ? { criticalThreshold: validValue + 10 }
          : field === 'criticalThreshold'
            ? { warningThreshold: validValue - 10 }
            : {};
      const withCompanion = { ...data, ...companion };
      expect(callValidation(field, validValue, null, withCompanion)).toBeNull();
    });

    it('preserves internalErrors already found by the provided editor', () => {
      const data = device();
      expect(
        callValidation(
          field,
          invalidValue,
          ['Must be greater than or equal to 1.'],
          data,
        ),
      ).toEqual([
        'Must be greater than or equal to 1.',
        fieldError(data, field, parseNumber(invalidValue)),
      ]);
    });
  });
});
