'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('extension/background.js','utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function fixture(browser='Edge',bytes=png){
 const requests=[],sent=[];
 const c={URL,Array,Uint8Array,String,Set,Map,Date,Promise,BROWSER:browser,api:{runtime:{getURL:path=>new URL(path,'chrome-extension://fixture/').href}},btoa:value=>Buffer.from(value,'binary').toString('base64'),fetch:async(url,options)=>{requests.push({url,options});return {ok:true,arrayBuffer:async()=>bytes};},native:async(op,data)=>{sent.push({op,data});return {ok:true};}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const websiteIconPending='),source.indexOf('function sync(){'))+'\nthis.collect=collectWebsiteIcons;',c);
 return {c,requests,sent,settle:async()=>{for(let n=0;n<12;n++)await Promise.resolve();}};
}
(async()=>{
 let h=fixture();h.c.collect(['example.org','example.org','file:///etc/passwd','bad?token=secret','localhost']);await h.settle();
 assert.equal(h.requests.length,1);const url=new URL(h.requests[0].url);assert.equal(url.protocol,'chrome-extension:');assert.equal(url.host,'fixture');assert.equal(url.pathname,'/_favicon/');assert.equal(url.searchParams.get('pageUrl'),'https://example.org/');assert.equal(h.requests[0].options.credentials,'omit');
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].op,'website-icons');assert.equal(h.sent[0].data.items[0].target,'example.org');assert.equal(h.sent[0].data.items[0].image,'data:image/png;base64,'+png.toString('base64'));
 h.c.collect(['example.org']);await h.settle();assert.equal(h.requests.length,1,'a successful local icon is not fetched on every policy sync');
 h=fixture('Firefox');h.c.collect(['example.org']);await h.settle();assert.equal(h.requests.length,0);
 h=fixture('Edge',Buffer.alloc(70000));h.c.collect(['example.org']);await h.settle();assert.equal(h.sent.length,0,'oversized or non-PNG bytes never cross the local bridge');
 h=fixture();h.c.collect(Array.from({length:100},(_,i)=>`site${i}.org`));await h.settle();assert.equal(h.requests.length,32,'a sync has a bounded cache lookup batch');
 console.log('5 local favicon-origin, deduplication, browser fallback, payload and batching checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
