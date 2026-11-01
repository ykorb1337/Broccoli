'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{},Map,Set,Array,Math,Boolean,String};vm.createContext(ctx);vm.runInContext(fs.readFileSync('web/tracking-day-data.js','utf8'),ctx);const D=ctx.window.HotTurkeyDayData;
const row=(id,timeline,start,end,extra={})=>({id,timeline,start,end,seconds:end-start,title:'Draft',group_name:'Editor',application:'Editor',bundle:'test.editor',color:'#123456',source:'recorded',...extra});
const edge={name:'Microsoft Edge',application:'Microsoft Edge',bundle:'com.microsoft.edgemac'};
const data={activities:[row('e1','applications',0,50,{...edge,group_name:edge.name,title:'Course page'}),row('e2','applications',80,100,{...edge,group_name:edge.name,title:'Calendar'}),row('t','applications',50,80,{application:'Typora',bundle:'test.typora',group_name:'Typora'}),row('d1','documents',0,50,{...edge,group_name:'course.invalid',url:'https://course.invalid/full/path',title:'Course page'}),row('d2','documents',80,100,{...edge,group_name:'calendar.invalid',url:'https://calendar.invalid/long',title:'Calendar'}),row('other','documents',0,50,{application:'Chrome',bundle:'com.google.Chrome',group_name:'unrelated.invalid',url:'https://unrelated.invalid'}),row('active','computer',0,100,{application:'',bundle:'',title:'Active',group_name:'Active'})],tag_ranges:[[20,30]]};
const model=D.create(data),edgeGroup=model.groups.get('applications').find(v=>v.name===edge.name);
assert.equal(edgeGroup.seconds,70);assert.equal(edgeGroup.ranges.length,2);
assert.deepEqual([...model.details('documents',edge).map(v=>v.id)],['d1','d2']);assert.equal(model.details('applications',edge)[0].title,'Course page');
const selected=model.summaries('documents',edgeGroup.ranges,edge);assert.equal(selected.find(v=>v.name==='course.invalid').selected_seconds,50);assert.equal(selected.find(v=>v.name==='unrelated.invalid').selected_seconds,0);
const normal={application:'Typora',bundle:'test.typora'};assert.equal(model.details('documents',normal).length,0);assert(model.summaries('documents',[[50,80]],normal).every(v=>v.selected_seconds===0));
assert.equal(model.summaries('computer',edgeGroup.ranges,edge)[0].selected_seconds,70);assert.equal(model.groups.get('computer')[0].seconds,100);
assert.equal(model.details('documents',null).length,3);assert.equal(model.details('applications',null).length,3);
const untagged=model.details('applications',edge,true);assert.equal(untagged.length,3);assert.equal(D.duration(untagged.map(v=>[v.start,v.end])),60);
const legacy=D.create({activities:[row('legacy','documents',0,100,{source:'legacy',application:'',bundle:'',group_name:'old.invalid'})]});assert.equal(legacy.groups.get('applications')[0].unknownBrowser,true);assert.equal(legacy.details('documents',edge).length,0);assert.equal(legacy.details('documents',{unknownBrowser:true}).length,1);
const many=Array.from({length:50000},(_,i)=>row('r'+i,'applications',i,i+1));const view=D.viewport(many,36*20000,480);assert(view.rows.length<=160);assert(view.first<=20000&&view.last>20000);assert.equal(view.before+view.rows.length*36+view.after,many.length*36);
const plot=D.plot(many,0,50000);assert(plot.length<=600);assert.equal(many.length,50000);const zoom=D.plot(many,10000,10010);assert.equal(new Set(zoom.map(v=>v.id)).size,10);
assert.equal(D.create({activities:[...data.activities],filtered_ids:['d1']}).details('documents',null).length,1);
const sortedRows=[row('ten','applications',30,50,{title:'Window 10'}),row('two','applications',0,10,{title:'Window 2'}),row('one','applications',20,25,{title:'Window 1'})],ids=rows=>[...rows.map(v=>v.id)];
assert.deepEqual(ids(D.sorted(sortedRows,{key:'title',direction:'asc'})),['one','two','ten']);
assert.deepEqual(ids(D.sorted(sortedRows,{key:'seconds',direction:'desc'})),['ten','two','one']);
assert.deepEqual(ids(D.sorted(sortedRows,{key:'end',direction:'asc'})),['two','one','ten']);
assert.deepEqual(ids(sortedRows),['ten','two','one'],'sorting must not mutate the day index');
const paths=[row('b','documents',0,5,{url:'https://z.invalid/',title:'A'}),row('a','documents',10,15,{url:'https://a.invalid/',title:'Z'})];
assert.deepEqual(ids(D.sorted(paths,{key:'title'})),['a','b'],'documents sort by the visible URL, not hidden page title');
const cached=D.create({activities:sortedRows}),order={key:'title',direction:'asc'};assert.equal(cached.details('applications',null,false,order),cached.details('applications',null,false,order));
const sparse=Array.from({length:5000},(_,i)=>[i*2,i*2+1]),before=JSON.stringify(sparse),visual=D.selectionPlot(sparse,0,10000);assert(visual.length<=600);assert.equal(D.duration(sparse),5000);assert.equal(JSON.stringify(sparse),before);
assert.deepEqual([...D.selectionPlot([[10,20],[30,40]],15,35).map(v=>[...v])],[[15,20],[30,35]]);
assert.equal(D.selectionPlot(sparse,3000,3010).length,5,'zoom restores separate selection ranges');
const searchRows=[
 row('edge-app','applications',0,100,{...edge,group_name:edge.name,title:'Microsoft Edge'}),
 row('word-app','applications',120,180,{application:'Word',bundle:'com.microsoft.Word',group_name:'Word',title:'Word'}),
 row('chrome-app','applications',0,100,{application:'Chrome',bundle:'com.google.Chrome',group_name:'Chrome',title:'Chrome'}),
 row('chat-app','applications',200,240,{application:'ChatGPT',bundle:'com.openai.chat',group_name:'ChatGPT',title:'ChatGPT'}),
 row('gpt-page','documents',10,30,{...edge,group_name:'chatgpt.com',url:'https://chatgpt.com/c/1',title:'GPT'}),
 row('gpt-page-2','documents',30,50,{...edge,group_name:'chatgpt.com',url:'https://chatgpt.com/c/2',title:'GPT'}),
 row('gpt-file','documents',130,160,{application:'Word',bundle:'com.microsoft.Word',group_name:'GPT report.docx',document:'/work/GPT report.docx',title:'GPT report.docx'}),
 row('other-page','documents',10,30,{application:'Chrome',bundle:'com.google.Chrome',group_name:'unrelated.invalid',title:'Other'})
];
const searchData={activities:searchRows,filtered_ids:['gpt-page','gpt-page-2','gpt-file','chat-app']},searchIndex=D.create(searchData),related=searchIndex.summaries('applications',[[20,40]],null,'documents');
assert.deepEqual([...related].map(g=>g.name).sort(),['ChatGPT','Microsoft Edge','Word'].sort());
const edgeResult=related.find(g=>g.name===edge.name),wordResult=related.find(g=>g.name==='Word');
assert.equal(edgeResult.seconds,40);assert.equal(edgeResult.selected_seconds,20);assert.deepEqual([...edgeResult.ranges.map(r=>[...r])],[[10,50]]);assert.equal(wordResult.seconds,30);assert(wordResult.documentMatch);
assert.equal(searchIndex.summaries('applications',[],null,null).length,4,'clearing search restores all applications');
const ownerOnly=D.create({activities:[row('lonely-doc','documents',0,10,{application:'Pages',bundle:'com.apple.iWork.Pages',title:'GPT notes'})],filtered_ids:['lonely-doc']});
assert.equal(ownerOnly.summaries('applications',[],null,'documents')[0].name,'Pages','known document ownership remains available without an app interval');
console.log('21 day correlation, sorting, caching, exact intervals and density checks passed');
