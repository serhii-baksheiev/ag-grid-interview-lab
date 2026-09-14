import { useEffect, useState } from 'react';
import type { GridApi } from 'ag-grid-community';
/**
 * Column visibility toggles. The grid stays the owner of visibility: every
 * render reads `column.isVisible()`, and the grid's `displayedColumnsChanged`
 * event (visibility, order, pinning, reset, restored state) triggers a re-render
 * so a checkbox never shows a value the grid has already moved away from.
 */
export function ColumnControls({ api }: { api: GridApi | undefined }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!api) return;
    const sync = () => refresh((n) => n + 1);
    api.addEventListener('displayedColumnsChanged', sync);
    return () => {
      // The grid unmounts alongside this control; a destroyed grid has dropped its listeners.
      if (!api.isDestroyed())
        api.removeEventListener('displayedColumnsChanged', sync);
    };
  }, [api]);
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
                onChange={(event) =>
                  api.setColumnsVisible(
                    [column.getColId()],
                    event.target.checked,
                  )
                }
              />
              {column.getColDef().headerName ?? column.getColId()}
            </label>
          ))}
      </div>
    </details>
  );
}
