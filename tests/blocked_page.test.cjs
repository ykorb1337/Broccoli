'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node{
 constructor(tag='div'){this.tag=tag;this.children=[];this.hidden=false;this.open=false;this.dataset={};this.value='';this.events={};this.attributes={};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}addEventListener(type,fn){this.events[type]=fn;}setAttribute(key,value){this.attributes[key]=value;}focus(){this.focused=true;}
}
const ids=['error','heading','website','details','retry','agenda','agenda-days','options','tab-section','tab-actions','break-section','breaks'];
const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
for(const id of ['agenda','options','tab-section','break-section'])nodes[id].hidden=true;
const flatten=node=>[node,...node.children.flatMap(flatten)];
const requests=[],navigations=[];
const block={id:'a',name:'Study',locked:false,break:{type:'text'}};
const ctx={Date,URL,JSON,String,Number,Array,console,location:{hash:'#url=https://example.com/private?token=secret',replace:url=>navigations.push(url)},document:{createElement:tag=>new Node(tag),querySelector:selector=>selector.startsWith('#')?nodes[selector.slice(1)]:Object.values(nodes).flatMap(flatten).find(node=>selector===`[data-block="${node.dataset.block}"]`)},chrome:{runtime:{sendMessage:async message=>{
 requests.push(message);
 if(message.op==='check')return {blocked:true,blocks:[{id:'a',name:'Study'}]};
 if(message.op==='status')return {blocks:[block],tab_unblock_available:1};
 if(message.op==='blocked-agenda')return {days:[{date:'2026-11-08',items:[{title:'<img src=x onerror=bad()>',declined:false},{title:'Two',declined:true},{title:'Three'},{title:'Four'}]}]};
 if(message.op==='break')return {challenge:'abc'};
 if(message.op==='tab-unblock')return {method:'text',challenge:'abc'};
 return {error:'unsupported'};
}}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('extension/blocked.js','utf8'),ctx);
(async()=>{
 await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(nodes.website.textContent,'example.com','never show private URL query');
 assert.equal(nodes.details.textContent,'Study');assert.equal(nodes.options.hidden,false);assert.equal(nodes.options.open,false,'release and break controls start collapsed');
 assert.equal(nodes.agenda.hidden,false);const day=nodes['agenda-days'].children[0],content=day.children[1];assert.equal(content.children[0].children.length,3);assert.equal(content.children[0].children[0].textContent,'<img src=x onerror=bad()>');assert.equal(content.children[0].children[1].className,'declined');assert.equal(content.children[1].tag,'details');assert.equal(content.children[1].open,false);
 const breakRow=nodes.breaks.children[0];await breakRow.children[1].onclick();assert.equal(requests.at(-1).op,'break');assert.equal(requests.at(-1).data.id,'a');assert.equal(breakRow.children[0].className,'challenge');
 const tabRow=nodes['tab-actions'].children[0],button=tabRow.children.at(-1);await button.onclick();assert.equal(button.textContent,'验证并放行');const request=requests.at(-1);assert.equal(request.op,'tab-unblock');assert.equal(request.data.id,'a');assert.equal(request.data.minutes,5);assert.equal(navigations.length,0);
 console.log('Blocked page preserves collapsed break/release actions, hides URL secrets and safely renders a bounded agenda');
})().catch(error=>{console.error(error);process.exitCode=1;});
