# Agent Note: DecryptHub MCP and official component management

Status: implemented

English | [中文](2026-11-05-decrypthub-mcp-management.zh.md)

## Problem

MCP transport services alone do not give users a way to configure custom tools or manage official analysis components. Finding a command, negotiating MCP and reaching a target device are different observations.

## Decision

One UI plugin supplies separate custom MCP settings and an official-component sidebar. Custom configuration reuses DSH Settings, credential references and the MCP manager. A separate owner-only service verifies official component installations while component protocols retain the browser/device boundary. Root-volatile official connection updates serialize retirement and mounting of the integration. The UI reports installation, transport and target facts separately. Unknown targets remain unconfirmed.

This extends the [MCP manager decision](2026-08-31-mcp-manager-plugin.md); it does not supersede its connection supervision or configuration ownership.

## Verification

Focused tests cover rejected imports, credential references, stale writes, cancellation, retaining an active version after verification failure, and rollback. A real Loader composition checks writable configuration, revision conflicts and owner access. An isolated Electron instance checks disabled imports and management navigation. Actual release downloads, phone connections and the embedded WDH workbench remain unverified.

## Alternatives considered

A second MCP transport implementation, imports of component internals, and treating CLI discovery as device readiness were rejected. An installer does not replace the browser, capture and debugging workbench.

## Consequences

Only packages satisfying source, platform, path and checksum constraints can change the active version; failure and cancellation retain the old pointer. Official management is owner-only. Configuration changes and unload must retire observations and processes so a previous workspace connection cannot serve a new workspace.
