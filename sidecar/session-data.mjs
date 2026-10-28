// Never use a session's workspace binding as a deletion target.
import fs from 'node:fs';
import path from 'node:path';
import { pathKey } from './paths.mjs';

function verifyDirectory(parent, target) {
  if (fs.existsSync(parent) && pathKey(fs.realpathSync.native(parent)) !== pathKey(parent)) throw Error('拒绝删除被链接替换的数据目录');
  const info = fs.lstatSync(target, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || pathKey(fs.realpathSync.native(target)) !== pathKey(target))) throw Error('拒绝删除被链接替换的会话目录');
  return target;
}
export function sessionDataPaths(userDataDir, session) {
  if (!/^(?:main|s(?:[a-f0-9]{6}|[a-f0-9]{32}))$/.test(session.id) || !!session.primary !== (session.id === 'main')) throw Error('会话身份无效');
  const root = fs.realpathSync.native(userDataDir), parent = path.join(root, 'projects');
  const target = path.join(parent, session.primary ? 'default' : session.id);
  if (pathKey(path.resolve(session.projectDir)) !== pathKey(path.join(path.resolve(userDataDir), 'projects', path.basename(target)))) throw Error('会话数据目录不匹配');
  // Older persistent profiles live outside projects/. Their exact locations are
  // derived from the stable session identity, never from a browser-provided path.
  const profile = session.primary ? path.join(root, 'chrome-profile') : path.join(root, 'profiles', session.id);
  return [verifyDirectory(path.dirname(profile), profile), verifyDirectory(parent, target)];
}
export async function deleteSessionData(userDataDir, session) {
  for (const target of sessionDataPaths(userDataDir, session)) {
    verifyDirectory(path.dirname(target), target);
    if (!fs.existsSync(target)) continue;
    // fs.rm unlinks descendant symlinks/junctions, rather than traversing their targets.
    await fs.promises.rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  }
}

export async function waitForSessionWriters(session) {
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([session.completion, session.titleJob, session.launching, session.debugStarting, ...[...session.subagents.jobs.values()].map(job => job.done)]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('会话任务仍在退出，请稍后重试删除')), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}
