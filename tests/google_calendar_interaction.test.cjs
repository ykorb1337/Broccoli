'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const context=vm.createContext({Date,Intl,URL});vm.runInContext(fs.readFileSync('web/google-calendar-data.js','utf8'),context);const D=context.HotTurkeyGoogleData;
const event=(id,start,end,extra={})=>({id,start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()},...extra});
(async()=>{
 let now=0,calls=0;const cache=D.createEventCache(()=>now),start=new Date(2026,10,1),end=new Date(2026,11,1),meeting=event('one',new Date(2026,10,2,9),new Date(2026,10,2,10));
 const fetcher=async()=>{calls++;return {items:[meeting],synced_at:1,offline:false};};
 await cache.load(['a'],start,end,fetcher);assert.equal(calls,1);
 const day=new Date(2026,10,2);assert.equal(cache.peek(['a'],day,D.addDays(day,1))[0].items.length,1);
 await cache.load(['a'],day,D.addDays(day,1),fetcher);assert.equal(calls,1,'covered day uses the month cache');assert.equal(cache.peek(['b'],day,D.addDays(day,1)),null,'calendar scope must match');
 now=60001;assert.equal(cache.peek(['a'],day,D.addDays(day,1)),null,'expired event data must be revalidated');await cache.load(['a'],start,end,fetcher);assert.equal(calls,2);await cache.load(['a'],start,end,fetcher,true);assert.equal(calls,3,'explicit refresh reaches the server');
 let complete;const pending=cache.load(['b'],start,end,()=>new Promise(resolve=>complete=resolve));const coalesced=cache.load(['b'],start,end,fetcher);await Promise.resolve();cache.clear();complete({items:[meeting],offline:false});await Promise.all([pending,coalesced]);assert.equal(calls,3,'same pending range is coalesced');assert.equal(cache.peek(['b'],start,end),null,'a late pre-write response cannot refill the invalidated cache');
 const dates=[new Date(2026,10,1),new Date(2026,10,2)],marker=D.nowIndicator(dates,new Date(2026,10,2,16,30,0));assert.equal(marker.index,1);assert.equal(marker.minute,990);assert.equal(D.nowIndicator(dates,new Date(2026,10,3)),null);
 const calendar={primary:true,labels:[]},items=[{calendar,event:meeting},{calendar,event:event('two',new Date(2026,10,2,9,30),new Date(2026,10,2,10,30),{summary:'Lab'})},{calendar,event:{id:'deadline',summary:'DDL',start:{date:'2026-11-02'},end:{date:'2026-11-03'}}},{calendar,event:event('declined',new Date(2026,10,2,11),new Date(2026,10,2,12),{attendees:[{self:true,responseStatus:'declined'}]})}];
 const analysis=D.analytics(items,day,new Date(2026,10,2,10),[calendar]);assert.equal(analysis.total,5400,'clip to visible interval, count overlaps separately, exclude all-day and declined');assert.equal(analysis.rows.find(r=>r.name==='Labs').seconds,1800);
 const labeled={...calendar,labels:[{id:'label',name:'Research',backgroundColor:'#123456'}]};const values=D.analytics([{calendar:labeled,event:{...meeting,eventLabelId:'label',summary:'Lecture'}}],day,D.addDays(day,1),[labeled]);assert.equal(values.total,3600);assert.equal(values.rows.find(r=>r.name==='Research').seconds,3600);assert(!values.rows.some(r=>r.name==='Lectures'),'Google labels take precedence over title inference');
 const index=D.dayIndex(items,dates);assert.equal(index.get('2026-11-02').length,4);assert.equal(index.get('2026-11-01').length,0);
 assert.equal(D.descriptionText('<p>Notes &amp; links</p><script>bad()</script><div>Second<br>line</div>'),'Notes & links\nSecond\nline');
 const links=D.detailHTML('<a href="https://example.com/notes?a=1&amp;b=2">Course notes</a>\nhttps://example.org/read. <a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)>');
 assert(links.includes('href="https://example.com/notes?a=1&amp;b=2"'));assert(links.includes('>Course notes</a>'));assert(links.includes('href="https://example.org/read"'));assert(!links.includes('javascript:'));assert(!links.includes('<img'));assert.equal(D.detailURL('file:///etc/passwd'),null);assert.equal(D.detailURL('https://u:p@example.com'),null);assert.equal(D.detailURL('www.example.com'),'https://www.example.com/');
 // Continuous spans reserve lanes across all covered days, never duplicate
 // an event once per day, and do not include exclusive midnight endpoints.
 const week=Array.from({length:7},(_,i)=>new Date(2026,9,12+i));
 const holiday={calendar:{primary:true,backgroundColor:'#9fe1e7'},event:{id:'fall',summary:'Academic · Fall Break',start:{date:'2026-10-10'},end:{date:'2026-10-19'}}};
 const oneDay={calendar,event:{id:'columbus',start:{date:'2026-10-12'},end:{date:'2026-10-13'}}};
 const crossing={calendar,event:event('registration',new Date(2026,9,13,10,45),new Date(2026,9,14,20,30))};
 const layout=D.weekRows([holiday,oneDay,crossing],week);assert.equal(layout.filter(r=>r.item.event.id==='fall').length,1);assert.equal(layout[0].startDay,0);assert.equal(layout[0].endDay,7);assert.equal(layout[0].lane,0);assert.equal(layout.find(r=>r.item.event.id==='columbus').endDay,1);assert.equal(layout.find(r=>r.item.event.id==='registration').endDay,3);
 for(const a of layout)for(const b of layout)if(a!==b&&a.lane===b.lane)assert(a.endDay<=b.startDay||b.endDay<=a.startDay);
 const nextWeek=week.map(d=>D.addDays(d,7));assert.equal(D.weekRows([holiday],nextWeek).length,0);assert.equal(D.weekRows([holiday,oneDay,crossing],week,true).length,2);
 assert.equal(D.eventAppearance(holiday).color,'#9fe1e7','unlabeled all-day events inherit calendar color');assert.equal(D.eventAppearance({...holiday,event:{...holiday.event,summary:'DDL · Submission'}}).color,'#d50000');
 const withDeadLabels={...calendar,labels:[{id:'dead',backgroundColor:'#ff0000'},{id:'spaces',name:'  ',backgroundColor:'#ffff00'},{id:'named',name:'Labs',backgroundColor:'#0b8043'}]};
 const clean=D.analytics([{calendar:withDeadLabels,event:{...meeting,eventLabelId:'named'}}],day,D.addDays(day,1),[withDeadLabels]);assert(!clean.rows.some(r=>r.name==='未命名标签'||r.name===''));assert.equal(clean.rows.find(r=>r.name==='Labs').seconds,3600);assert.equal(D.analysisCategory({calendar:withDeadLabels,event:{...meeting,eventLabelId:'named'}}).key,clean.rows.find(r=>r.name==='Labs').key);
 const usedUnnamed=D.analytics([{calendar:withDeadLabels,event:{...meeting,eventLabelId:'dead'}}],day,D.addDays(day,1),[withDeadLabels]);assert.equal(usedUnnamed.rows.find(r=>r.name==='未命名标签').seconds,3600,'used unnamed labels must remain visible');
 console.log('Calendar cache, spans, exclusive endpoints, lanes, color inheritance, label cleanup and matching scenarios passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
