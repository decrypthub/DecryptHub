import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';
import { History } from '../history.mjs';
import { readHistoryStorage } from '../history-store.mjs';
import { compressFrame, decompressFrame, scanZstdFrames } from '../history-zstd.mjs';
import { ChangeStore, contentHash } from '../changes.mjs';
import { editWorkspace } from '../workspace.mjs';
import { patchWorkspace } from '../workspace-patch.mjs';
import { historyWindow, sessionSnapshot } from '../session-snapshots.mjs';
import { SessionSearchIndex } from '../session-search-index.mjs';
import { registerAttachment } from '../attachments.mjs';
import { exportSessionArchive } from '../session-export.mjs';
import { catalogEntries, configureCatalogCredentials, credentialStore } from '../provider-catalog.mjs';
import { ProviderAuthorization } from '../provider-authorization.mjs';
import { SkillCatalogCache } from '../skill-cache.mjs';
import { filesystemSkills, readFilesystemSkill, SKILL_TOOLS } from '../skill-files.mjs';
import { dependencyPaths } from '../workspace-dependencies.mjs';
import { readFileDaclWin32, copyFileDaclWin32 } from '../fs-win32.mjs';
import { historyEvents } from '../../ui/src/conversation.js';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-completion-')), handles = [];
  const workspace = path.join(root, 'workspace'), data = path.join(root, 'data'); fs.mkdirSync(workspace); fs.mkdirSync(data);
  t.after(async () => { for (const handle of handles.reverse()) await handle.close?.(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('dh-completion-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, data, file: path.join(data, '.agent-history.json'), own: value => (handles.push(value), value) };
}
async function until(condition) { for (let i=0; i<100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 25)); } assert.fail('Timed out waiting for lifecycle state'); }
test('v4 uncompressed predecessors remain immutable while first write publishes a verified compressed successor', t => {
  const f = fixture(t), id = 'a'.repeat(32), name = 'history-' + 'b'.repeat(32) + '.jsonl'; fs.mkdirSync(path.join(f.data, '.history'));
  const source = path.join(f.data, '.history', name), bytes = Buffer.from(JSON.stringify({ type:'decrypthub-history-jsonl',version:4,eventVersion:3,id,createdAt:1 })+'\n'+JSON.stringify({seq:0,event:{t:'user',content:'old',at:1}})+'\n');
  fs.writeFileSync(source,bytes); fs.writeFileSync(f.file,JSON.stringify({v:4,storage:'decrypthub-history-jsonl',generation:name,id}));
  const h=f.own(History.load(f.file,'')); h.onAppend=()=>assert.equal(h.save(f.file),true,h.lastSaveError?.message); h.append({t:'assistant',content:'new'});
  const current=readHistoryStorage(f.file); assert.equal(current.marker.v,5); assert.ok(current.generation.endsWith('.zst')); assert.equal(current.raw.events.length,2); assert.deepEqual(fs.readFileSync(source),bytes);
  assert.equal(scanZstdFrames(fs.readFileSync(current.generation)).frames.length,2);
});
test('checksummed frames recover complete rows from a torn last frame and reject complete corruption', t => {
  const f=fixture(t), h=new History({events:[{t:'user',content:'base'}]}); assert.equal(h.save(f.file),true,h.lastSaveError?.message);
  const source=readHistoryStorage(f.file), original=fs.readFileSync(source.generation), frame=compressFrame(JSON.stringify({seq:1,event:{t:'assistant',content:'recovered 中文'}})+'\n');
  fs.appendFileSync(source.generation,frame.subarray(0,frame.length-2)); const torn=readHistoryStorage(f.file); assert.equal(torn.tornTail,true); assert.equal(torn.raw.events[1].content,'recovered 中文'); assert.equal(torn.committedBytes,original.length);
  const restored=f.own(History.load(f.file,'')); restored.onAppend=()=>assert.equal(restored.save(f.file),true,restored.lastSaveError?.message); restored.append({t:'turn-end',stop:'completed'}); restored.close();
  assert.equal(readHistoryStorage(f.file).raw.events.length,3); assert.equal(readHistoryStorage(f.file).tornTail,false);
  const damaged=fs.readFileSync(source.generation); damaged[damaged.length-1]^=1; fs.writeFileSync(source.generation,damaged); assert.throws(()=>History.load(f.file,''),/读取|损坏|checksum|decompress/i);
});
test('one append batch has a single durable publication and invalid batches do not admit a prefix', t => {
  const f=fixture(t), h=f.own(new History({system:''})); let writes=0; h.onAppend=()=>{writes++;assert.equal(h.save(f.file),true,h.lastSaveError?.message);};
  h.appendBatch([{t:'user',content:'one'},{t:'assistant',content:'two'},{t:'turn-end',stop:'completed'}]); assert.equal(writes,1); assert.equal(readHistoryStorage(f.file).raw.events.length,3);
  assert.throws(()=>h.appendBatch([{t:'user',content:'not admitted'},{t:'unknown'}])); assert.equal(h.events.length,3);
});
test('edits and patches larger than 4MB keep a small version index, paged previews and exact undo', t => {
  const f=fixture(t), file=path.join(f.workspace,'large.txt'), original='line 中文\n'.repeat(500000)+'TARGET\n', changed=original.replace('TARGET','UPDATED'); fs.writeFileSync(file,original);
  let changes=new ChangeStore(f.data); const ctx={workRoot:f.workspace,projectDir:f.data,protectedRoot:f.data,workspaceId:'workspace',workspaceKind:'folder',mode:'full-access',readHashes:new Map([[file,contentHash(original)]]),changes};
  const result=editWorkspace(ctx,{path:'large.txt',old_string:'TARGET',new_string:'UPDATED'}); assert.equal(result.isError,undefined,result.text); assert.equal(fs.readFileSync(file,'utf8'),changed); assert.ok(fs.statSync(changes.file).size<10000);
  changes=new ChangeStore(f.data); const entry=changes.list('workspace')[0], preview=changes.detail(entry.id,'workspace',{offset:80000,maxChars:100}); assert.equal(preview.after.length,100); assert.equal(preview.windows.after.truncated,true);
  changes.undo(entry.id,{id:'workspace',root:f.workspace}); assert.equal(fs.readFileSync(file,'utf8'),original);
  ctx.changes=changes; ctx.readHashes.set(file,contentHash(original)); const patch=patchWorkspace(ctx,'*** Begin Patch\n*** Update File: large.txt\n@@\n-TARGET\n+PATCHED\n*** End Patch'); assert.equal(patch.isError,undefined,patch.text); assert.match(fs.readFileSync(file,'utf8'),/PATCHED\n$/);
});
test('corrupt saved versions refuse undo without touching the current file', t => {
  const f=fixture(t), file=path.join(f.workspace,'file.txt'), changes=new ChangeStore(f.data); fs.writeFileSync(file,'before'); const entry=changes.write(f.workspace,file,'after',{workspaceId:'w'});
  fs.writeFileSync(path.join(f.data,'.changes',entry.beforeRef.hash),'tampered'); assert.throws(()=>changes.undo(entry.id,{id:'w',root:f.workspace}),/损坏/); assert.equal(fs.readFileSync(file,'utf8'),'after');
});
test('atomic Windows edit and undo preserve every target DACL entry', {skip:process.platform!=='win32'}, t => {
  const f=fixture(t), file=path.join(f.workspace,'acl.txt'), changes=new ChangeStore(f.data); fs.writeFileSync(file,'before'); copyFileDaclWin32(file,file); const dacl=readFileDaclWin32(file);
  const acl=descriptor=>descriptor.subarray(descriptor.readUInt32LE(16));
  const entry=changes.write(f.workspace,file,'after',{workspaceId:'w'}); assert.deepEqual(acl(readFileDaclWin32(file)),acl(dacl)); changes.undo(entry.id,{id:'w',root:f.workspace}); assert.deepEqual(acl(readFileDaclWin32(file)),acl(dacl));
});
test('passive browsing keeps cold sessions cold and pages at stable raw sequence positions', t => {
  const f=fixture(t), events=[]; for(let i=0;i<210;i++)events.push({t:'user',content:'task '+i,turnId:'t'+i},{t:'assistant',content:'answer '+i,turnId:'t'+i},{t:'turn-end',turnId:'t'+i,stop:'completed'});
  fs.writeFileSync(f.file,JSON.stringify({v:3,events})); const session={id:'cold',projectDir:f.data,agent:null,eventRevision:3,workspace:{id:'w',root:f.workspace},modelSelection:null,mgr:{},requestSettings:()=>({}),planMode:{snapshot:()=>({active:false})},publicState:()=>({mode:'read-only'})};
  const latest=sessionSnapshot(session); assert.equal(session.agent,null); assert.equal(latest.startSeq,480); assert.equal(latest.events[0].content,'task 160'); assert.equal(fs.readdirSync(f.data).length,1);
  const older=historyWindow(events,{beforeSeq:latest.startSeq}); assert.equal(older.endSeq,480); assert.equal(older.startSeq,330); assert.equal(historyEvents(older.events,'',null,'',older.startSeq)[0].seq,330);
});
test('search cursors bind request, scope, index lifetime and relevant corpus generation', async t => {
  const f=fixture(t), index=f.own(new SessionSearchIndex(path.join(f.data,'search.sqlite'))); await index.ready();
  const upsert=(id,text)=>index.upsert({sessionId:id,cwd:f.workspace,live:false,persisted:true,createdAt:1},[{seq:0,type:'user/message',surface:'current',time:1,text}]);
  for(const id of ['a','b','c'])upsert(id,'needle'); const args={limit:1}; const first=index.query('needle',['a','b','c'],[],args), second=index.query('needle',['a','b','c'],[],{...args,cursor:first.nextCursor}); assert.notEqual(first.items[0].sessionId,second.items[0].sessionId);
  assert.throws(()=>index.query('different',['a','b','c'],[],{...args,cursor:first.nextCursor}),error=>error.code==='SESSION_QUERY_INVALID_CURSOR');
  upsert('a','needle changed'); assert.throws(()=>index.query('needle',['a','b','c'],[],{...args,cursor:first.nextCursor}),error=>error.code==='SESSION_QUERY_STALE_CURSOR');
});
test('ZIP export includes logical raw history, descendants and referenced attachments without activating an Agent', async t => {
  const f=fixture(t), upload=registerAttachment(f.data,{name:'sample.txt',data:Buffer.from('attachment bytes')}); fs.writeFileSync(f.file,JSON.stringify({v:3,events:[{t:'user',content:'hello',attachments:[upload]}]}));
  const id=crypto.randomUUID(), child=path.join(f.data,'.subagents',id); fs.mkdirSync(child,{recursive:true}); fs.writeFileSync(path.join(f.data,'.subagents.json'),JSON.stringify([{id}])); fs.writeFileSync(path.join(child,'.agent-history.json'),JSON.stringify({v:3,events:[{t:'assistant',content:'child answer'}]}));
  const session={id:'root',projectDir:f.data,agent:null,subagents:{jobs:new Map(),resumable:new Map()}}; const destination=path.join(f.root,'export.zip'); const result=await exportSessionArchive(session,destination); assert.equal(result.entries,3); assert.equal(session.agent,null);
  const files=unzipSync(fs.readFileSync(destination)); assert.ok(files['session.v3.jsonl']); assert.ok(files['subagents/'+id+'/session.v3.jsonl']); assert.equal(Buffer.from(Object.values(files).find(bytes=>Buffer.from(bytes).toString()==='attachment bytes')).toString(),'attachment bytes');
  await assert.rejects(exportSessionArchive(session,destination),/已存在/); const controller=new AbortController(); controller.abort(); await assert.rejects(exportSessionArchive(session,path.join(f.root,'cancel.zip'),{signal:controller.signal})); assert.ok(!fs.existsSync(path.join(f.root,'cancel.zip')));
});
test('catalog metadata exposes native protocols and provider-owned supported login methods', () => {
  const catalog=catalogEntries(); for(const [id,api] of [['google','google-generative-ai'],['amazon-bedrock','bedrock-converse-stream'],['mistral','mistral-conversations']])assert.ok(catalog.find(p=>p.id===id).models.some(m=>m.api===api));
  assert.ok(catalog.find(p=>p.id==='github-copilot').methods.some(method=>method.id==='oauth')); assert.ok(!catalog.find(p=>p.id==='openai').methods.some(method=>method.id==='oauth'));
});
test('credential writes serialize refresh and preserve the prior grant on persistence failure', async () => {
  const id='fixture-credential', writes=[]; configureCatalogCredentials({values:{['prov.'+id]:JSON.stringify({type:'oauth',access:'one',refresh:'r',expires:1})},save:async(slot,value)=>writes.push(JSON.parse(value).access)});
  const store=credentialStore(id); await Promise.all([store.modify(id,async current=>({...current,access:current.access+'A'})),store.modify(id,async current=>({...current,access:current.access+'B'}))]); assert.deepEqual(writes,['oneA','oneAB']);
  configureCatalogCredentials({save:async()=>{throw Error('disk unavailable');}}); await assert.rejects(store.modify(id,async current=>({...current,access:'lost'})),/disk unavailable/); assert.equal((await store.read(id)).access,'oneAB');
});
test('provider API-key interaction completes only after storage confirmation and cancellation withdraws its prompt', async () => {
  const route={id:'fixture-login',catalogId:'google'}, notices=[]; let saved=0; configureCatalogCredentials({save:async()=>{saved++;}});
  const auth=new ProviderAuthorization({settings:()=>({providers:[route]}),emit:value=>notices.push(value)}); const initial=auth.start(route.id,'api_key'); await until(()=>auth.status(initial.id).prompt); const prompt=auth.status(initial.id).prompt;
  auth.answer(initial.id,prompt.id,'fixture-only-key'); await until(()=>auth.status(initial.id).status==='completed'); assert.equal(saved,1); assert.ok(!JSON.stringify(notices).includes('fixture-only-key'));
  const pending=auth.start(route.id,'api_key'); await until(()=>auth.status(pending.id).prompt); auth.cancel(pending.id); await until(()=>auth.status(pending.id).status==='cancelled'); assert.equal(auth.status(pending.id).prompt,undefined); auth.close();
});
test('filesystem skill catalogs invalidate after stable writes and bundled resource paths stay inside the bundled root', async t => {
  const f=fixture(t), directory=path.join(f.workspace,'.agents/skills/example'); fs.mkdirSync(directory,{recursive:true}); const file=path.join(directory,'SKILL.md'), text=description=>'---\nname: example\ndescription: '+description+'\n---\nbody'; fs.writeFileSync(file,text('one'));
  const cache=f.own(new SkillCatalogCache()), ctx={workRoot:f.workspace,skillCatalogCache:cache}; assert.equal(filesystemSkills(ctx).find(x=>x.name==='example').description,'one'); await new Promise(resolve=>setTimeout(resolve,250)); fs.writeFileSync(file,text('two'));
  await until(()=>filesystemSkills(ctx).find(x=>x.name==='example')?.description==='two'); const bundled=filesystemSkills(ctx).find(x=>x.name==='office-render'); assert.ok(bundled); const loaded=readFilesystemSkill(bundled); assert.match(loaded.content,/Installed LibreOffice Kit/);
  const tool=SKILL_TOOLS.find(tool=>tool.name==='skill_resource_read'), extensions={list:()=>[bundled],read:()=>loaded}; assert.match((await tool.run({name:bundled.name,path:'../office/references/sidecar.md'},{extensions})).text,/Missing Office sidecar/); await assert.rejects(tool.run({name:bundled.name,path:'../../../../outside'},{extensions}),/越界/);
});
test('workspace dependency paths are relocatable and reject foreign payload platforms', () => {
  const manifest={platform:process.platform,arch:process.arch,python:'3.12.14',node:'24.21.0',pnpm:'12.16.1',pythonPackages:{'python-docx':'1.2.0'}}; const resources=dependencyPaths(path.resolve('owned'),manifest); assert.ok(path.isAbsolute(resources.python)); assert.deepEqual(resources.versions,{python:'3.12.14',node:'24.21.0',pnpm:'12.16.1',source:'verified-bundled-manifest'}); assert.throws(()=>dependencyPaths(path.resolve('owned'),{...manifest,arch:process.arch==='x64'?'arm64':'x64'}),/不兼容/);
});
