'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('extension/content.js','utf8');
function page(visibility=''){
 const gates=new Set(),root={style:{visibility},append(node){gates.add(node);}};
 const document={documentElement:root,createElement(){const node={textContent:'',remove(){gates.delete(node);}};return node;},querySelectorAll:()=>[],addEventListener(){}};
 return {document,root,gates};
}
function inject(shared,id){
 let reply,reject;const response=new Promise((ok,bad)=>{reply=ok;reject=bad;});const navigations=[];
 const location={hostname:'example.com',href:'https://example.com/',replace:url=>navigations.push(url)};
 const window={};window.top=window;
 const context={document:shared.document,location,window,chrome:{runtime:{id,getURL:path=>'chrome-extension://'+id+'/'+path,sendMessage:()=>response,onMessage:{addListener(){}}}},MutationObserver:class{observe(){}},setTimeout(){},setInterval(){},console};
 vm.runInNewContext(source,context);return {reply,reject,navigations};
}
const flush=()=>new Promise(setImmediate);
(async()=>{
 const shared=page(),a=inject(shared,'old'),b=inject(shared,'new');
 a.reply({blocked:false});b.reply({blocked:false});await flush();
 assert.equal(shared.root.style.visibility,'','two allowed checks must not leave the page hidden');
 assert.equal(shared.gates.size,0);
 const pending=page(),c=inject(pending,'old'),d=inject(pending,'new');
 assert.equal(pending.gates.size,2,'each instance owns a separate initial check gate');
 c.reply({blocked:false});await flush();assert.equal(pending.gates.size,1,'one instance cannot reveal another pending check');
 d.reply({blocked:false});await flush();assert.equal(pending.gates.size,0);
 const site=page('collapse'),e=inject(site,'one');e.reply({blocked:false});await flush();assert.equal(site.root.style.visibility,'collapse','preserve site-owned inline visibility');
 const failed=page(),f=inject(failed,'one');f.reject(Error('disconnected'));await flush();assert.equal(failed.gates.size,0,'disconnect cleans only our gate');
 const blocked=page(),g=inject(blocked,'one');g.reply({blocked:true,blocks:[{id:'a',name:'Study'}]});await flush();assert.equal(g.navigations.length,1);assert.equal(blocked.gates.size,1,'blocked page stays concealed until redirect');
 console.log('Content visibility: duplicate instances, pending checks, site styles, disconnect and blocking passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
