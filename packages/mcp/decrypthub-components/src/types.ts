/** Product component observations; installation, transport and target facts remain separate. */
import type { McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Code-owned component identifiers. */
export type ComponentId = 'wdh' | 'adh' | 'idh'
/** A fresh read from an official CLI; an MCP transport is not evidence that a target is online. */
export interface ComponentInventory {
  schemaVersion: 1
  component: ComponentId
  version: string | null
  checkedAt: string
  error: string | null
  connections: { endpoint: string; online: boolean; version: string | null; error: string | null }[]
  targets: {
    id: string
    name: string
    endpoint: string
    online: boolean
    pid?: string | number | null | undefined
    package?: string | null | undefined
    bundle?: string | undefined
  }[]
  browser?: { available: boolean; state: 'not-observed' } | undefined
}
/** Verified local component metadata, without commands supplied by a remote catalog. */
export interface InstalledComponent {
  id: ComponentId
  version: string
  entry: string
  runtime: 'node' | 'python'
  source: 'bundled' | 'managed'
}
/** One agent-owned WDH connection. */
export interface WdhConnectionView {
  agentId: SessionId
  workspace: string
  status: McpConnectionStatus
}
/** One cancellable installation transaction. */
export interface ComponentOperation {
  kind?: 'component' | 'browser'
  phase: 'checking' | 'downloading' | 'verifying' | 'installing' | 'installed' | 'cancelled' | 'failed'
  received: number
  total: number
  version?: string
  error?: string
}
/** Official component card metadata and actual local availability. */
export interface ComponentView {
  id: ComponentId
  installed: InstalledComponent | null
  localCommand: string | null
  /** First `--version` line from the local CLI when no managed install is present. */
  localVersion: string | null
  previousVersion: string | null
  latestVersion: string | null
  catalogError: string | null
  localError: string | null
  operation: ComponentOperation | null
}
/** One refreshable catalog snapshot. */
export interface ComponentsSnapshot {
  /** Last explicit probes, each carrying its observation time; never inferred from installation. */
  inventories?: Partial<Record<ComponentId, ComponentInventory>>
  components: ComponentView[]
  /** Tools the WDH component last reported while a session had it connected. */
  wdhTools: number | null
  wdh: WdhConnectionView[]
  configuration: OfficialConfiguration | null
  browser: BrowserKernelView
}

/** A doctor observation confirms file discovery, not a running browser. */
export interface BrowserKernelView {
  state: 'unchecked' | 'found' | 'missing' | 'failed'
  version: string | null
}

/** Persisted product connection choices and their concurrency token. */
export interface OfficialConfiguration {
  revision: number
  writable: boolean
  wdh: { enabled: boolean; browser: 'system' | 'cloak' }
  adh: OfficialDeviceConfiguration
  idh: OfficialDeviceConfiguration
}
/** Device daemon address is separate from the local MCP process. */
export interface OfficialDeviceConfiguration { enabled: boolean; command: string; args: string[]; endpoint: string; devices: string[] }
/** Categories a Harness home import can copy: conversations are the only stable unit. */
export type ImportKind = 'sessions'
/** One preview row. */
export interface ImportItem { readonly id: ImportKind; readonly count: number; readonly seconds: number; readonly detail: string }
/** Outcome of copying one category. */
export interface ImportResult { readonly id: ImportKind; readonly status: 'imported' | 'skipped' | 'empty'; readonly detail: string }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A verified active component changed; providers refresh their next connection.
     * @param id - activated component.
     * @mode emit
     */
    'decrypthub-components/activated'(id: ComponentId): void
  }
}
