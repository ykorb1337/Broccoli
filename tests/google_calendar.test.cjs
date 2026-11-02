'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const c=vm.createContext({Intl,Date});vm.runInContext(fs.readFileSync('web/google-calendar-data.js','utf8'),c);const D=c.HotTurkeyGoogleData;
const base=new Date(2026,10,1,12),r=D.range(base,'week');assert.equal(D.dayKey(r.start),'2026-10-26');assert.equal(D.dayKey(r.end),'2026-11-02');
assert.equal(D.range(base,'month').days,42);assert.equal(D.dayKey(D.move(new Date(2026,0,31),'month',1)),'2026-02-01');
const event={id:'night',start:{dateTime:'2026-11-01T23:00:00-05:00'},end:{dateTime:'2026-11-02T01:00:00-05:00'}};
// Use local components to make these checks independent of the test machine's zone.
event.start.dateTime=new Date(2026,10,1,23).toISOString();event.end.dateTime=new Date(2026,10,2,1).toISOString();
let s=D.segments([{event}],new Date(2026,10,1));assert.equal(s[0].startMinute,1380);assert.equal(s[0].endMinute,1440);
s=D.segments([{event}],new Date(2026,10,2));assert.equal(s[0].startMinute,0);assert.equal(s[0].endMinute,60);
const all={start:{date:'2026-11-01'},end:{date:'2026-11-02'}};assert(D.onDay(all,new Date(2026,10,1)));assert(!D.onDay(all,new Date(2026,10,2)));assert.equal(D.segments([{event:all}],new Date(2026,10,1)).length,0);
const item={calendar:{accessRole:'reader'},event};assert(!D.editable(item));item.calendar.accessRole='owner';assert(D.editable(item));item.event={...event,eventType:'birthday'};assert(!D.editable(item));item.calendar.accessRole='writerWithoutPrivateAccess';item.event={...event,visibility:'private'};assert(!D.editable(item));
assert.equal(D.input({dateTime:'2026-11-01T14:00:00Z'},'America/New_York'),'2026-11-01T09:00');
assert.equal((D.range(base,'day').end-D.range(base,'day').start)/3600000,24+(D.addDays(new Date(2026,10,1),1).getTimezoneOffset()-new Date(2026,10,1).getTimezoneOffset())/60);
console.log('9 Google calendar view, midnight, all-day, access, zone and DST scenarios passed');
