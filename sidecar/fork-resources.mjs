import fs from 'node:fs';
import path from 'node:path';
import { attachment } from './attachments.mjs';
import { resolveIn, atomicJson } from './paths.mjs';
import crypto from 'node:crypto';
function fileHash(file) {
  const hash = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), block = Buffer.allocUnsafe(65536);
  try { let count; while ((count = fs.readSync(fd, block, 0, block.length, null))) hash.update(block.subarray(0, count)); return hash.digest('hex'); }
  finally { fs.closeSync(fd); }
}
function copyOnce(source, destination) {
  try { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); }
  catch (error) {
    const info = fs.lstatSync(destination, { throwIfNoEntry: false });
    if (error.code !== 'EEXIST' || !info?.isFile() || info.nlink !== 1 || fileHash(source) !== fileHash(destination)) throw error;
  }
}

// Forked events retain stable attachment IDs and spill references. Materialize
// the referenced immutable resources rather than keeping broken parent paths.
export function copyForkResources(source, destination, events) {
  const images = new Set(), refs = new Set();
  for (const event of events) {
    for (const image of event.images || []) images.add(typeof image === 'string' ? image : image.id);
    for (const entry of event.attachments || []) if (entry.kind === 'attachment') images.add(entry.id);
    for (const match of String(event.content || '').matchAll(/\bctx_[a-f0-9]{10}\b/g)) refs.add(match[0]);
  }
  for (const id of images) {
    const original = attachment(source, id), directory = resolveIn(destination, '.attachments/' + id);
    fs.mkdirSync(directory, { recursive: true });
    copyOnce(original.file, resolveIn(directory, 'content'));
    const { file, ...metadata } = original, metaFile = resolveIn(directory, 'meta.json');
    if (fs.existsSync(metaFile)) { if (JSON.stringify(JSON.parse(fs.readFileSync(metaFile, 'utf8'))) !== JSON.stringify(metadata)) throw Error('继承的附件元数据不一致'); }
    else atomicJson(metaFile, metadata);
  }
  for (const ref of refs) {
    const original = resolveIn(source, '.ctx/' + ref + '.txt');
    if (!fs.existsSync(original)) continue; // Historical/user-mentioned references may already be absent.
    const info = fs.lstatSync(original);
    if (!info.isFile() || info.nlink > 1) throw Error('继承的上下文引用不是普通文件：' + ref);
    fs.mkdirSync(path.join(destination, '.ctx'), { recursive: true });
    copyOnce(original, resolveIn(destination, '.ctx/' + ref + '.txt'));
  }
}
