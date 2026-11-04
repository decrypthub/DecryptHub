// Private staging plus security-preserving publication, adapted from DSH fsio.ts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveIn } from './paths.mjs';
import { copyFileDaclWin32, replaceFileWin32 } from './fs-win32.mjs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function atomicWorkspaceWrite(root, file, content, { expectedHash, createOnly = false } = {}) {
  const rel = path.relative(root,file); resolveIn(root,rel); fs.mkdirSync(path.dirname(file),{recursive:true}); resolveIn(root,rel);
  const exists=fs.existsSync(file), mode=exists?fs.statSync(file).mode:0o600;
  if (createOnly && exists) throw Error('文件已被其他程序创建');
  const stage=resolveIn(root,path.relative(root,path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmpdir')));
  fs.mkdirSync(stage,{mode:0o700}); const temporary=path.join(stage,'content'); let fd, committed=false;
  try {
    fd=fs.openSync(temporary,'wx',0o600);
    if(exists && process.platform==='win32')copyFileDaclWin32(file,temporary);
    fs.writeFileSync(fd,content); fs.fsyncSync(fd); fs.fchmodSync(fd,mode); fs.closeSync(fd); fd=undefined;
    resolveIn(root,rel);
    if(expectedHash && (!fs.existsSync(file)||hash(fs.readFileSync(file))!==expectedHash))throw Error('写入前文件已被其他程序修改');
    if(!exists||createOnly)fs.linkSync(temporary,file);
    else if(process.platform==='win32')replaceFileWin32(file,temporary);
    else fs.renameSync(temporary,file);
    committed=true;
  } finally {
    if(fd!==undefined)fs.closeSync(fd);
    try { if(fs.existsSync(temporary))fs.unlinkSync(temporary); fs.rmdirSync(stage); }
    catch(error) { if(!committed)throw error; /* Committed content stays successful if private staging cleanup fails. */ }
  }
}
