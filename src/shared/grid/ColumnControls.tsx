import { useState } from 'react';
import type { GridApi } from 'ag-grid-community';
export function ColumnControls({ api }: { api: GridApi | undefined }) {
  const [, refresh] = useState(0);
  return (
    <details className="column-controls" onToggle={() => refresh((n) => n + 1)}>
      <summary>Columns</summary>
      <div>
        {api
          ?.getColumns()
          ?.filter((c) => !c.getColId().startsWith('ag-'))
          .map((column) => (
            <label key={column.getColId()}>
              <input
                type="checkbox"
                checked={column.isVisible()}
                onChange={(event) => {
                  api.setColumnsVisible(
                    [column.getColId()],
                    event.target.checked,
                  );
                  refresh((n) => n + 1);
                }}
              />
              {column.getColDef().headerName ?? column.getColId()}
            </label>
          ))}
      </div>
    </details>
  );
}
