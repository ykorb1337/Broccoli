'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/appearance.js','utf8');
function setup(responses){
 const nodes=[{dataset:{activityTarget:'https://example.org/page'},classList:{add(){},remove(){}},style:{setProperty(){}},replaceChildren(image){this.image=image;}}],timers=[],calls=[];
 const context={URL,Map,Set,Array,document:{querySelectorAll:()=>nodes,createElement:()=>({})},icon:()=>({}),setTimeout:(fn,ms)=>{assert.equal(ms,3200);timers.push(fn);},api:async(path,data)=>{assert.equal(path,'tracking/website-icons');calls.push(data.targets);const value=responses.shift();if(value instanceof Error)throw value;return value;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' const websiteImages='),source.indexOf(" let pending=false,lastNative="))+ '\nthis.request=requestWebsites;this.pending=websitePending;',context);
 const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
 return {nodes,timers,calls,context,settle};
}
(async()=>{
 const image='data:image/png;base64,aGVsbG8=';
 let h=setup([{items:[{target:'example.org',image:null,retry_after:3}]},{items:[{target:'example.org',image}]}]);
 h.context.pending.add('example.org');await h.context.request(['example.org']);assert.equal(h.timers.length,1);assert(h.context.pending.has('example.org'));
 h.timers.shift()();await h.settle();assert.equal(h.calls.length,2);assert.equal(h.nodes[0].image.src,image);assert.equal(h.nodes[0].dataset.iconSource,'website');assert(!h.context.pending.has('example.org'));
 h=setup([{items:[{target:'example.org',image:null}]}]);await h.context.request(['example.org']);assert.equal(h.timers.length,0,'genuinely absent icons must not poll');assert.equal(h.nodes[0].textContent,'E');
 h=setup(Array.from({length:5},()=>new Error('offline')));await h.context.request(['example.org']);for(let n=0;n<4;n++){h.timers.shift()();await h.settle();}assert.equal(h.calls.length,5);assert.equal(h.timers.length,0,'transient failures have a bounded retry budget');assert(!h.context.pending.has('example.org'));
 h=setup([{items:[{target:'example.org',image:null,retry_after:3}]}]);h.context.pending.add('example.org');await h.context.request(['example.org']);h.nodes.length=0;h.timers.shift()();await h.settle();assert.equal(h.calls.length,1,'leaving the page cancels the delayed icon request');assert(!h.context.pending.has('example.org'));
 console.log('4 website icon retry, recovery, missing-cache and page-leave scenarios passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
