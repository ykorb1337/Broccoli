'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('web/app.js','utf8'),hooks={};let clicks=0,button;
const context={modal:{addEventListener:(name,fn)=>hooks[name]=fn},$:()=>button};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const keyboardSubmitActions='),source.indexOf('function showModalError(')),context);
function key(action,kind='input',extra={}){
 button={dataset:{action},disabled:false,click(){clicks++;}};
 const before=clicks;let prevented=false;
 hooks.keydown({key:'Enter',target:{tagName:kind==='textarea'?'TEXTAREA':'INPUT',closest:()=>['button','select','editable'].includes(kind),matches:()=>['date','time','datetime-local','checkbox','radio'].includes(kind)},preventDefault(){prevented=true;},...extra});
 return {clicked:clicks>before,prevented};
}
let checks=0;
for(const action of ['save-editor','save-interval','apply-block-import','auth-submit']){assert.deepEqual(key(action),{clicked:true,prevented:true});checks++;}
for(const kind of ['textarea','button','select','editable','date','time','datetime-local','checkbox','radio']){assert.equal(key('save-editor',kind).clicked,false);checks++;}
assert.equal(key('save-editor','textarea',{metaKey:true}).clicked,true);checks++;
for(const extra of [{isComposing:true},{keyCode:229},{repeat:true},{ctrlKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true},{key:'Escape'}]){assert.equal(key('save-editor','input',extra).clicked,false);checks++;}
for(const action of ['save-device','apply-lock','confirm-import','device-emergency-submit']){assert.equal(key(action).clicked,false);checks++;}
console.log(`${checks} modal keyboard, composition, repeat and explicit device/lock confirmation checks passed`);
