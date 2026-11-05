/** Downstream-only packages are bundled locally and never enter the upstream npm release family. */
export const PRIVATE_PRODUCT_PACKAGE_DIRECTORIES: readonly string[] = [
  'packages/client/ui-brand-decrypthub',
  'packages/client/ui-mcp',
  'packages/client/ui-settings-decrypthub-account',
  'packages/mcp/decrypthub-integrations',
  'packages/mcp/decrypthub-components',
]
