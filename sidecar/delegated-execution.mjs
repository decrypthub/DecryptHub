// A child's permission is captured at delegation. It can never open an
// approval dialog or reuse a later widening of its parent's permission.
import { executor } from './executor.mjs';
import { resolveIn } from './paths.mjs';
import { SessionTerminals } from './terminals.mjs';
import { killAllJobs } from './workspace.mjs';

export function delegatedResources(record, parent, projectDir) {
  const mode = record.access || 'read-only'; // Historical research children keep their old boundary.
  const workspace = { id: record.workspaceId, root: record.workRoot || parent.workRoot, revision: record.workspaceRevision };
  const verify = () => {
    if (workspace.id !== parent.workspaceId || workspace.root !== parent.workRoot) throw Error('子代理属于另一个工作区，不能在当前目录恢复');
    resolveIn(workspace.root, '.');
  };
  const terminalOwner = {
    mode, workspace, projectDir, closing: false,
    mgr: { projectsBusy: false, workspaces: { verify } },
    approve: async () => false,
    emit: () => {},
  };
  const terminals = new SessionTerminals(terminalOwner);
  return {
    mode, workspace, terminals,
    async execute(spec, signal) {
      signal?.throwIfAborted(); verify();
      if (mode === 'read-only') throw Error('委派的只读权限禁止执行代码');
      const isolated = mode !== 'full-access';
      if (isolated && !(await executor.probe()).available) throw Error('子代理的执行隔离不可用，且委派不允许申请额外权限；请由主代理处理此命令');
      if (isolated && spec.network?.length) throw Error('子代理不能申请新的网络授权；请由主代理处理需要联网的操作');
      signal?.throwIfAborted(); verify();
      return executor.start(spec, { signal, isolated, workspace, dataDir: projectDir, protectedRoot: parent.protectedRoot, network: isolated ? [] : spec.network || [] });
    },
    async close() { terminalOwner.closing = true; killAllJobs(projectDir); await terminals.closeAll(); },
  };
}
