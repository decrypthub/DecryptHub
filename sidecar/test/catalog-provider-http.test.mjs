import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chat } from '../llm.mjs';
import { catalogEntries } from '../provider-catalog.mjs';
test('catalog Gemini performs a real HTTP tool loop and replays its provider-owned thought signature', async t => {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    requests.push({url:req.url,body:JSON.parse(text)});
    res.writeHead(200,{'content-type':'text/event-stream'});
    const parts=requests.length===1 ? [{functionCall:{name:'echo',args:{text:'fixture value'}},thoughtSignature:Buffer.from('fixture-signature').toString('base64')}] : [{text:'complete fixture'}];
    res.end('data: '+JSON.stringify({candidates:[{index:0,content:{role:'model',parts},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,totalTokenCount:13}})+'\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>{server.closeAllConnections();server.close();});
  const model=catalogEntries().find(provider=>provider.id==='google').models.find(model=>model.id==='gemini-2.5-flash'); assert.ok(model);
  const settings={provider:'openai',activeProviderId:'fixture-google',activeThinking:'off',openai:{apiKey:'fixture-only',catalogProviderId:'google',api:model.api,model:model.id,baseUrl:'http://127.0.0.1:'+server.address().port,thinking:{levels:['off'],transport:'effort'},maxTokens:64}};
  const tools=[{name:'echo',description:'Echo fixture',schema:{type:'object',properties:{text:{type:'string'}},required:['text']}}], messages=[{role:'user',content:'Echo a fixture and finish.'}];
  const first=await chat(settings,messages,tools,{managedRetry:true,signal:AbortSignal.timeout(15000)}); assert.equal(first.toolCalls.length,1); assert.equal(first.toolCalls[0].name,'echo');
  const call=first.toolCalls[0]; messages.push({role:'assistant',content:first.content,reasoning_content:first.reasoning,tool_calls:[{id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}],_nativeReplay:first.nativeReplay},{role:'tool',tool_call_id:call.id,name:call.name,content:'fixture value'});
  const second=await chat(settings,messages,tools,{managedRetry:true,signal:AbortSignal.timeout(15000)}); assert.equal(second.content,'complete fixture'); assert.equal(requests.length,2);
  assert.match(requests[0].url,/streamGenerateContent/); assert.ok(JSON.stringify(requests[1].body).includes(Buffer.from('fixture-signature').toString('base64'))); assert.match(JSON.stringify(requests[1].body),/functionResponse/);
});
