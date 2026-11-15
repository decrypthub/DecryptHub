/** Product-owned packages are packed locally and excluded from upstream npm publication. */
export const PRIVATE_PRODUCT_PACKAGE_DIRECTORIES: readonly string[] = [
  'packages/bundle/mcp-bundle',
  'packages/bundle/memory-bundle',
  'packages/client/ui-brand-decrypthub',
  'packages/client/ui-decrypthub-settings',
  'packages/client/ui-mcp',
  'packages/client/ui-settings-decrypthub-account',
  'packages/host/product-memory',
  'packages/host/product-persona',
  'packages/host/product-runtime',
  'packages/mcp/decrypthub-components',
  'packages/mcp/decrypthub-integrations',
  'packages/skill/tool-skill-manage',
  'packages/session/tool-product-sessions',
]
