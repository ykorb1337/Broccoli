'use strict';
const assert=require('node:assert/strict'),chart=require('../web/tracking-chart.js');
const base={name:'Usage',chart_type:'bar',show_average:false,buckets:['2026-10-28','2026-10-29'],series:[{name:'Editor',color:'#007aff',unit:'seconds',total:120,average:60,values:[120,0]}]};
const copy=()=>JSON.parse(JSON.stringify(base));let count=0;
function test(name,fn){fn();count++;}
test('Every value has its exact bucket and numeric geometry',()=>{const p=chart.geometry(base);assert.equal(p.points[0].points.length,2);assert.equal(p.points[0].points[0].value,120);assert.equal(p.points[0].points[1].value,0);assert.equal(p.points[0].points[1].height,0);});
test('A missing clock reading remains a gap',()=>{const r=copy();r.series[0].values=[null,60];const p=chart.geometry(r);assert.equal(p.points[0].points[0],null);assert.equal(p.points[0].points[1].value,60);});
test('Grouped bars do not overlap another series',()=>{const r=copy();r.series.push({...r.series[0],name:'Browser'});const p=chart.geometry(r),a=p.points[0].points[0],b=p.points[1].points[0];assert(a.left+a.width<=b.left+1e-8);});
test('Average line uses the reported zero-inclusive average',()=>{const r=copy();r.show_average=true;const svg=chart.svg(r);assert(svg.includes('mt-chart-average'));assert(svg.includes('平均 0:01:00'));});
test('Line chart does not bridge null dates',()=>{const r=copy();r.chart_type='line';r.buckets=['A','B','C'];r.series[0].values=[60,null,120];const svg=chart.svg(r);assert.equal((svg.match(/class="mt-chart-line"/g)||[]).length,2);assert.equal((svg.match(/<circle /g)||[]).length,2);});
test('Text and attributes are escaped',()=>{const r=copy();r.name='<script>alert(1)</script>';r.series[0].name='" onclick="bad';const svg=chart.svg(r);assert(!svg.includes('<script>'));assert(!svg.includes('aria-label="" onclick='));});
test('Native rgba palette stays readable in dark appearance',()=>{const svg=chart.svg(base,{background:'rgba(28,28,30,1.0000)',muted:'rgba(180,180,184,1.0000)'});assert(svg.includes('fill="rgba(28,28,30,1.0000)"'));assert(svg.includes('fill="rgba(180,180,184,1.0000)"'));});
test('Invalid colors cannot create a remote image reference',()=>{const r=copy();r.series[0].color='url(https://invalid.example)';const svg=chart.svg(r,{line:'url(https://invalid.example)'});assert(!svg.includes('https://'));});
test('Large reports have finite bounded canvas dimensions',()=>{const r=copy();r.buckets=Array.from({length:366},(_,i)=>String(i));r.series=Array.from({length:100},(_,i)=>({...base.series[0],name:String(i),values:r.buckets.map(()=>60)}));const p=chart.geometry(r);assert(p.width<=12000);assert(Number.isFinite(p.maximum));});
test('Clock, duration, attendance and missing values use distinct formatting',()=>{assert.equal(chart.format(null),'—');assert.equal(chart.format(3600,'clock'),'1:00:00');assert.equal(chart.format(1.5,'days'),'1.5 天');assert.equal(chart.format(90061),'25:01:01');});
test('Empty reports show an explicit empty state',()=>{const r=copy();r.series=[];assert(chart.html(r).includes('暂无统计记录'));});
console.log(`${count} statistics chart geometry, gaps, palette and export-source checks passed`);
