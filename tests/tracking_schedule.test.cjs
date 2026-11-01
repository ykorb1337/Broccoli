'use strict';
const assert=require('node:assert/strict'),s=require('../web/tracking-schedule.js');
let count=0;
function check(name,run){run();count++;}
check('Sunday overnight stays in correct Monday',()=>{
 const week=s.days([{days:[6],start:1380,end:60}]);assert.deepEqual(week[6],[[1380,1440]]);assert.deepEqual(week[0],[[0,60]]);
});
check('Exact minute boundaries survive normalization',()=>{
 const rows=[{days:[0,1],start:547,end:1003}];assert.deepEqual(s.rows(s.days(rows)),rows);
});
check('Removing middle keeps independent ranges',()=>{
 const rows=s.edit([{days:[0],start:540,end:1020}],[0],720,780,false);assert.deepEqual(s.days(rows)[0],[[540,720],[780,1020]]);
});
check('Overlapping additions never duplicate time',()=>{
 const rows=s.edit([{days:[0],start:540,end:720}],[0],600,780,true);assert.deepEqual(s.days(rows)[0],[[540,780]]);
});
check('Painting a cell does not change other weekdays',()=>{
 const before=[{days:[0,1],start:540,end:720}],after=s.edit(before,[0],570,600,false);
 assert.deepEqual(s.days(after)[1],[[540,720]]);assert.deepEqual(before,[{days:[0,1],start:540,end:720}]);
});
check('Whole day and empty week are distinct',()=>{
 assert.deepEqual(s.days(s.edit([],[0],0,1440,true))[0],[[0,1440]]);
 assert.deepEqual(s.edit([{days:[0],start:0,end:1440}],[0],0,1440,false),[]);
});
check('Partial cell coverage is precise',()=>{
 const week=s.days([{days:[2],start:547,end:562}]);assert.equal(s.coverage(week,2,540,570),15);
});
check('Overnight removal affects both days only',()=>{
 const rows=s.edit([{days:[0,1,2],start:0,end:1440}],[0],1380,60,false),week=s.days(rows);
 assert.deepEqual(week[0],[[0,1380]]);assert.deepEqual(week[1],[[60,1440]]);assert.deepEqual(week[2],[[0,1440]]);
});
console.log(`${count} weekly tracking schedule checks passed`);
