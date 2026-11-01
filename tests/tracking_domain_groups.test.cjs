'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{},URL};vm.createContext(ctx);for(const file of ['web/public-suffixes.js','web/tracking-day-data.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);const D=ctx.window.HotTurkeyDayData,plain=v=>JSON.parse(JSON.stringify(v));
for(const [url,want] of [
 ['https://calendar.example.co.uk/month/10','example.co.uk'],['https://learn.example.co.uk/reading','example.co.uk'],
 ['https://a.user.github.io/file','user.github.io'],['https://b.other.github.io/file','other.github.io'],
 ['https://a.b.ck/page','a.b.ck'],['https://a.www.ck/page','www.ck'],
 ['https://www.食狮.com.cn/','xn--85x722f.com.cn'],['http://127.0.0.1:52529/a','127.0.0.1'],
 ['http://[::1]/a','[::1]'],['https://localhost/a','localhost'],['file:///work/a.md',''],['edge://newtab/','']
])assert.equal(D.rootDomain(url),want,url);
const row=(id,start,end,url,bundle='edge')=>({id,start,end,seconds:end-start,timeline:'documents',url,title:'Course',group_name:new URL(url).hostname,application:bundle,bundle,color:'#007aff'});
const rows=[row('a',0,10,'https://learn.example.co.uk/a'),row('b',20,30,'https://calendar.example.co.uk/b'),row('c',10,20,'https://other.org/a'),row('d',40,50,'https://learn.example.co.uk/c','chrome')];
const index=D.create({activities:rows,tag_ranges:[[0,5]]}),groups=index.details('documents',{bundle:'edge'},false,{key:'start'},true,false);
assert.equal(groups.length,3);assert.equal(groups[0].domain,'example.co.uk');assert.equal(groups[0].seconds,10);assert.deepEqual(plain(D.ranges(groups[0])),[[0,10]],'returning to the same domain starts a separate chronological row');
assert.equal(index.taggedSeconds(groups[0]),5);assert.equal(index.details('documents',{bundle:'edge'},false,{key:'start'},true,true).length,3,'detailed view restores every URL');
assert.equal(index.details('documents',null,false,{key:'start'},true,false).length,4,'separate visits and browsers are retained');
const example=D.groupDocuments([row('gpt3',120,180,'https://chatgpt.com/c/3'),row('geo',60,120,'https://www.geoguessr.com/game'),row('gpt2',30,60,'https://chatgpt.com/c/2'),row('gpt1',0,30,'https://chatgpt.com/c/1')]);
assert.deepEqual(plain(example.map(r=>[r.domain,r.start,r.end,r.seconds])),[['chatgpt.com',0,60,60],['geoguessr.com',60,120,60],['chatgpt.com',120,180,60]],'only neighboring visits merge and start-time order is preserved');
assert.equal(D.groupDocuments([row('x',0,10,'https://a.example.co.uk/x'),row('y',10,20,'https://b.example.co.uk/y')]).length,1,'adjacent subdomains share a root domain');
assert.equal(D.groupDocuments([row('x',0,10,'https://example.org/x'),row('y',11,20,'https://example.org/y')]).length,2,'actual gaps are never merged');
assert.deepEqual(plain(index.summaries('documents',[],{bundle:'edge'}).find(g=>g.name==='example.co.uk').ranges),[[0,10],[20,30]],'summary select-all must obey browser scope');
const visits=[row('gpt1',0,30,'https://chatgpt.com/c/1'),row('gpt2',30,60,'https://chatgpt.com/c/2'),row('geo',60,120,'https://geoguessr.com/game'),row('gpt3',120,180,'https://chatgpt.com/c/3')];
const visitIndex=D.create({activities:visits}),byDuration=visitIndex.details('documents',null,false,{key:'seconds',direction:'desc'},false,false,'all');
assert.deepEqual(plain(byDuration.map(r=>[r.domain,r.seconds])),[['chatgpt.com',120],['geoguessr.com',60]],'all visits merge by root domain and sort by duration');
assert.deepEqual(plain(D.ranges(byDuration[0])),[[0,60],[120,180]],'aggregate selection must not include the other website');
const byTime=visitIndex.details('documents',null,false,{key:'start',direction:'asc'},false,false,'adjacent');
assert.deepEqual(plain(byTime.map(r=>[r.domain,r.start,r.end])),[['chatgpt.com',0,60],['geoguessr.com',60,120],['chatgpt.com',120,180]],'the chronological mode has independent cached rows');
assert.equal(visitIndex.details('documents',null,false,{key:'seconds',direction:'desc'},false,false,'all'),byDuration,'switching modes reuses the correct cached view');
const adjacent=[row('x',0,10,'https://a.org'),row('y',10,20,'https://b.org'),row('z',25,30,'https://b.org')],bars=D.plot(adjacent,0,60);
assert.equal(bars[0].plot_end,bars[1].plot_start,'touching records have no artificial gap');assert.equal(bars[2].plot_start-bars[1].plot_end,5,'real idle gap is retained');
const dense=D.plot(Array.from({length:5000},(_,i)=>row('r'+i,i,i+1,'https://example.org')),0,5000);
assert(dense.length<=600);for(let i=1;i<dense.length;i++)assert(Math.abs(dense[i-1].plot_end-dense[i].plot_start)<1e-8,'pixel compaction does not introduce fake idle gaps');
assert.equal(index.recordAt('documents',25).id,'b');assert.equal(index.recordAt('documents',35),null);
console.log('12 suffix cases and scoped grouping, exact selection, hover hit-testing and continuous-bar checks passed');
