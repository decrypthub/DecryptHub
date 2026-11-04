// 后台任务登记。身份和输出环在这里，进程本身仍由 executor 持有。
// 访问按 owner 围栏：id 可猜测，所以靠「是不是这条会话的任务」而不是靠保密。

const jobs = new Map();

export function trackJob(proc, { owner, projectDir, label } = {}) {
  if (!proc?.id) throw new Error('任务没有 id');
  const record = jobs.get(proc.id) || {
    id: proc.id,
    owner: owner || projectDir || 'local',
    projectDir: projectDir || '',
    label: String(label || ''),
    proc,
  };
  record.owner = owner || record.owner;
  record.projectDir = projectDir || record.projectDir;
  record.label = label || record.label;
  record.proc = proc;
  jobs.set(proc.id, record);
  return record;
}

export function findJob(id, owner) {
  const record = jobs.get(String(id || ''));
  if (!record || record.owner !== owner) return null;
  return record;
}

export function killTracked(id, owner) {
  const record = findJob(id, owner);
  if (!record) return null;
  record.proc.kill?.();
  return record;
}

/** 会话或项目收尾时停掉仍在跑的任务。按项目目录匹配，覆盖该项目下每个会话。 */
export function killTrackedProject(projectDir) {
  if (!projectDir) return;
  for (const record of jobs.values()) {
    if (record.projectDir === projectDir && record.proc.status === 'running') record.proc.kill?.();
  }
}
