---
kind: upgrade-guide
description: "DecryptHub history and project memory tools require a registered workspace membership."
---

# DecryptHub project history and memory require workspace membership

English | [中文](guide.zh.md)

## Change

Previously, a chat without a workspace could list unrelated history, and old project memories without a recorded owner could appear in other workspaces. Both tools now use the registered workspace of the current session. Existing project memory keeps its scope when updated by ID. The settings page still lists memories whose ownership needs review.

## Migration

1. Open a chat from the intended workspace before using `session_list`, `session_read`, or writing project memory.
2. Review old entries in Settings under Memory. To restore a project entry with an unknown owner, review the fact and save it from a chat in the intended workspace.
3. Check that history and project memories show up in that workspace and remain hidden from other workspaces.
