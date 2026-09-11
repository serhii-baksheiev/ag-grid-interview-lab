import {
  AllCommunityModule,
  ModuleRegistry,
  enableDevValidations,
} from 'ag-grid-community';
// Explicit Community baseline. Trim modules here if bundle size becomes a product constraint.
ModuleRegistry.registerModules([AllCommunityModule]);
if (import.meta.env.DEV) enableDevValidations();
