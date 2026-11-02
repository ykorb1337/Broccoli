'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const c={Intl,Date,URL,Map,Set,document:{addEventListener(){}},addEventListener(){},esc:value=>String(value).replace(/</g,'&lt;').replace(/"/g,'&quot;')};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('web/google-calendar-data.js','utf8'),c);vm.runInContext(fs.readFileSync('web/google-calendar-picker.js','utf8'),c);const p=c.HotTurkeyGooglePicker;
const field=p.field('gc-start','2026-11-01T09:30',false);assert(field.includes('type="hidden"'));assert(field.includes('开始日期'));assert(field.includes('开始时间'));assert(field.includes('09:30'));
assert(!p.field('gc-end','2026-11-01',true).includes('结束时间'));assert(p.zone('gc-zone','America/New_York').includes('纽约'));assert(p.zone('gc-zone','Asia/Shanghai').includes('北京'));
assert(p.field('gc-start','2026-11-01T09:30',false,true).includes('disabled'));assert(p.zone('gc-zone','UTC',true).includes('disabled'));assert.equal(p.close(),false);
console.log('5 calendar date/time controls, all-day, searchable zone labels, read-only and close scenarios passed');
