import test from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from '@js-temporal/polyfill';
import { analyzeSource, analyzeCase, exportCalendar, formatInstant, normalizeZone, foldCalendarLine } from '../src/model.js';
const source = (overrides = {}) => ({ id:'a', label:'Rules page', quote:'October 31, 2026 at 21:00 UTC', url:'https://example.com/rules', date:'2026-10-31', time:'21:00', zone:'UTC', weekday:'Saturday', ...overrides });
const scenario = (sources, overrides = {}) => ({ title:'Synthetic deadline', localZone:'America/Toronto', bufferMinutes:60, sources, ...overrides });
const has = (r, code) => r.issues.some(i => i.code === code);

test('UTC conversion and local day rollover are explicit', () => {
  const r=analyzeSource(source(), 'Asia/Tokyo');
  assert.equal(r.status,'resolved'); assert.equal(r.instant,'2026-10-31T21:00:00Z');
  assert.match(r.displayLocal,/Sun, Nov 1, 2026, 06:00/);
});
test('fixed offsets are literal, including 30- and 45-minute offsets', () => {
  for (const [zone,instant] of [['+05:30','2026-10-31T15:30:00Z'], ['+05:45','2026-10-31T15:15:00Z'], ['-03:30','2026-11-01T00:30:00Z']]) {
    assert.equal(analyzeSource(source({zone})).instant,instant);
  }
});
test('region zones follow seasonal offsets', () => {
  assert.equal(analyzeSource(source({date:'2026-07-10',time:'12:00',weekday:'',zone:'America/New_York'})).instant,'2026-07-10T16:00:00Z');
  assert.equal(analyzeSource(source({date:'2026-01-10',time:'12:00',weekday:'',zone:'America/New_York'})).instant,'2026-01-10T17:00:00Z');
});
test('missing source zone never falls back to the display or device zone', () => {
  for (const local of ['UTC','Asia/Tokyo','America/Toronto']) {
    const r=analyzeSource(source({zone:''}),local); assert.equal(r.status,'unresolved'); assert.equal(r.instant,null); assert.ok(has(r,'missing-zone'));
  }
});
test('zone clarification preserves original source and records decision', () => {
  const s=source({zone:'',resolution:{zone:'Asia/Kathmandu',note:'Organizer clarification'}}); const before=JSON.stringify(s);
  const r=analyzeSource(s); assert.equal(r.instant,'2026-10-31T15:15:00Z'); assert.ok(has(r,'zone-clarified')); assert.equal(JSON.stringify(s),before);
});
test('ambiguous abbreviations are rejected rather than guessed', () => {
  for(const zone of ['CST','EST','PST','IST','local','Mars/Olympus','UTC+5','+24:00','+05:60','+5:30']) {
    const r=analyzeSource(source({zone})); assert.equal(r.status,'invalid',zone); assert.equal(r.instant,null,zone);
  }
});
test('valid zone aliases and literal UTC are accepted', () => {
  for(const zone of ['UTC','utc','Z','Etc/UTC','Etc/GMT+5','US/Eastern','+00:00']) assert.equal(analyzeSource(source({zone})).status,'resolved',zone);
});
test('invalid dates, leap dates, 24:00 and overflowing times are rejected', () => {
  for (const [date,time] of [['2026-02-29','12:00'],['2026-04-31','12:00'],['2026-13-01','12:00'],['0000-01-01','12:00'],['26-01-01','12:00'],['2026-01-01','24:00'],['2026-01-01','23:60'],['2026-01-01','3:00'],['2026-01-01','12:00:30'],['','']]) {
    const r=analyzeSource(source({date,time,weekday:''})); assert.equal(r.status,'invalid',`${date} ${time}`); assert.ok(has(r,'invalid-date-time'));
  }
  assert.equal(analyzeSource(source({date:'2028-02-29',weekday:''})).status,'resolved');
});
test('northern hemisphere one-hour DST gap is never shifted', () => {
  const r=analyzeSource(source({date:'2026-03-08',time:'02:30',zone:'America/New_York',weekday:''}));
  assert.equal(r.status,'unresolved'); assert.equal(r.instant,null); assert.equal(r.candidates.length,0); assert.ok(has(r,'dst-gap'));
});
test('DST fold returns two exact candidates and no implicit instant', () => {
  const r=analyzeSource(source({date:'2026-11-01',time:'01:30',zone:'America/Toronto',weekday:''}));
  assert.equal(r.status,'unresolved'); assert.equal(r.instant,null); assert.ok(has(r,'dst-fold'));
  assert.deepEqual(r.candidates.map(x=>x.instant),['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z']);
});
test('both explicit fold decisions work, preserve original and record choice', () => {
  for(const [fold,instant] of [['earlier','2026-11-01T05:30:00Z'],['later','2026-11-01T06:30:00Z']]) {
    const s=source({date:'2026-11-01',time:'01:30',zone:'America/Toronto',weekday:'',resolution:{fold}}); const before=JSON.stringify(s);
    const r=analyzeSource(s); assert.equal(r.instant,instant); assert.equal(r.status,'resolved'); assert.ok(has(r,'fold-resolved')); assert.equal(JSON.stringify(s),before);
  }
});
test('a fold decision never resolves a nonexistent gap', () => {
  const r=analyzeSource(source({date:'2026-03-08',time:'02:30',zone:'America/Toronto',weekday:'',resolution:{fold:'later'}}));
  assert.equal(r.instant,null); assert.ok(has(r,'dst-gap'));
});
test('Lord Howe 30-minute transitions are handled without one-hour assumptions', () => {
  const fold=analyzeSource(source({date:'2026-04-05',time:'01:45',zone:'Australia/Lord_Howe',weekday:''}));
  assert.ok(has(fold,'dst-fold')); assert.equal(fold.candidates[1].epochMs-fold.candidates[0].epochMs,30*60000);
  const gap=analyzeSource(source({date:'2026-10-04',time:'02:15',zone:'Australia/Lord_Howe',weekday:''})); assert.ok(has(gap,'dst-gap'));
});
test('whole skipped dates are detected', () => {
  const r=analyzeSource(source({date:'2011-12-30',time:'12:00',zone:'Pacific/Apia',weekday:''})); assert.ok(has(r,'dst-gap')); assert.equal(r.instant,null);
});
test('European and southern-hemisphere folds are detected', () => {
  for (const [date,time,zone] of [['2026-10-25','01:30','Europe/London'],['2026-04-05','02:30','Australia/Sydney']]) assert.ok(has(analyzeSource(source({date,time,zone,weekday:''})),'dst-fold'));
});
test('weekday mismatch blocks until explicitly resolved', () => {
  const r=analyzeSource(source({weekday:'Friday'})); assert.equal(r.status,'unresolved'); assert.ok(has(r,'weekday-conflict')); assert.equal(r.instant,null);
  const resolved=analyzeSource(source({weekday:'Friday',resolution:{weekday:'date'}})); assert.equal(resolved.status,'resolved'); assert.ok(has(resolved,'weekday-resolved')); assert.equal(resolved.source.weekday,'Friday');
});
test('invalid weekday is not treated as an acknowledgment', () => {
  const r=analyzeSource(source({weekday:'Funday',resolution:{weekday:'date'}})); assert.equal(r.status,'unresolved'); assert.ok(has(r,'invalid-weekday'));
});
test('missing fields or invalid display zone fail safely', () => {
  assert.equal(analyzeSource().status,'invalid'); assert.equal(analyzeSource(source(),'broken').status,'invalid');
  assert.equal(analyzeCase().status,'empty'); assert.equal(analyzeCase({sources:'broken'}).status,'empty');
});
test('source disagreements retain each exact value and label conservative plan separately', () => {
  const s1=source();const s2=source({id:'b',date:'2026-11-01',time:'01:00',weekday:''});
  const c=scenario([s1,s2]); const before=JSON.stringify(c); const r=analyzeCase(c);
  assert.equal(r.status,'conflict'); assert.equal(r.spreadMinutes,240); assert.equal(r.planningInstant,'2026-10-31T20:00:00Z'); assert.equal(r.canExport,false); assert.equal(JSON.stringify(c),before);
});
test('one unresolved source blocks target and export despite other resolved sources', () => {
  const r=analyzeCase(scenario([source(),source({id:'b',zone:''})])); assert.equal(r.status,'blocked'); assert.equal(r.planningInstant,null); assert.equal(r.canExport,false);
});
test('agreement is based on instants rather than identical local strings', () => {
  const r=analyzeCase(scenario([source(),source({id:'b',time:'17:00',zone:'America/Toronto'})])); assert.equal(r.status,'agreement'); assert.equal(r.spreadMinutes,0); assert.equal(r.canExport,true);
});
test('planning buffer is elapsed minutes across DST and year boundaries', () => {
  const c=scenario([source({date:'2026-01-01',time:'00:15',weekday:'',zone:'UTC'})],{bufferMinutes:30}); assert.equal(analyzeCase(c).planningInstant,'2025-12-31T23:45:00Z');
  const d=scenario([source({date:'2026-11-01',time:'02:15',weekday:'',zone:'America/Toronto'})],{bufferMinutes:90}); assert.equal(analyzeCase(d).planningInstant,'2026-11-01T05:45:00Z');
});
test('invalid planning buffer is not coerced into a valid target', () => {
  for (const bufferMinutes of [-1,10081,0.5,'',null,'invalid',Infinity,NaN]) {
    const r=analyzeCase(scenario([source()],{bufferMinutes})); assert.equal(r.status,'blocked'); assert.equal(r.canExport,false); assert.equal(r.planningInstant,null);
  }
  assert.equal(analyzeCase(scenario([source()],{bufferMinutes:0})).planningInstant,'2026-10-31T21:00:00Z');
});
test('ICS uses UTC, escaped source evidence, a planning label and no injection', () => {
  const c=scenario([source({quote:'Line 1\r\nEND:VEVENT\nBEGIN:VEVENT; comma, slash\\',resolution:{note:'Confirmed by source'}})],{title:'Launch, safely; now\nEND:VCALENDAR'});
  const text=exportCalendar(c,{now:'2026-10-18T12:00:00Z'});
  assert.match(text,/DTSTART:20261031T200000Z\r\n/);assert.match(text,/DTEND:20261031T200100Z/); assert.match(text,/DTSTAMP:20261018T120000Z/);
  assert.match(text,/SUMMARY:Planning target: Launch\\, safely\\; now\\nEND:VCALENDAR/);
  assert.equal(text.split('\r\n').filter(x=>x==='BEGIN:VEVENT').length,1);
  assert.equal(text.split('\r\n').filter(x=>x==='END:VCALENDAR').length,1);
  assert.ok(text.endsWith('\r\n')); assert.match(text,/STATUS:TENTATIVE/);
});
test('calendar export rejects empty, conflicting, unresolved and invalid cases', () => {
  for (const c of [scenario([]),scenario([source(),source({id:'b',time:'22:00'})]),scenario([source({zone:''})]),scenario([source()],{bufferMinutes:-1})]) assert.throws(()=>exportCalendar(c),RangeError);
});
test('ICS Unicode folding stays within 75 UTF-8 octets and round-trips', () => {
  const long='DESCRIPTION:'+('A café 🕰️ 東京; '.repeat(80)); const folded=foldCalendarLine(long);
  for(const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line,'utf8')<=75);
  assert.equal(folded.replace(/\r\n /g,''),long);
});
test('ICS UID stable for the same saved plan, different for changed target', () => {
  const uid=c=>exportCalendar(c).match(/UID:(.*)/)[1]; const c=scenario([source()]);
  assert.equal(uid(c),uid(c)); assert.notEqual(uid(c),uid({...c,bufferMinutes:30}));
});
test('immutable inputs are accepted throughout model and export', () => {
  const s=Object.freeze(source({resolution:Object.freeze({})})); const c=Object.freeze(scenario(Object.freeze([s])));
  assert.equal(analyzeCase(c).canExport,true); assert.ok(exportCalendar(c));
});
test('property: 1,176 zone/date/time round-trips preserve minute and ordered candidates', () => {
  const zones=['UTC','America/New_York','Europe/London','Europe/Paris','Australia/Lord_Howe','Australia/Sydney','Pacific/Apia','Asia/Kathmandu','Asia/Kolkata','Pacific/Chatham','America/St_Johns','Africa/Casablanca'];
  const dates=['2026-01-01','2026-03-08','2026-04-05','2026-07-15','2026-10-04','2026-10-25','2026-11-01'];
  const times=['00:00','00:30','01:00','01:30','01:45','02:00','02:15','02:30','03:00','04:00','06:15','12:00','18:45','23:59'];
  let count=0;
  for(const zone of zones) for(const date of dates) for(const time of times) {
    const r=analyzeSource(source({date,time,zone,weekday:''})); count++;
    for(const c of r.candidates) {
      const z=Temporal.Instant.from(c.instant).toZonedDateTimeISO(zone);
      assert.equal(z.toPlainDate().toString(),date); assert.equal(z.toPlainTime().toString({smallestUnit:'minute'}),time);
    }
    if(r.candidates.length===2) assert.ok(r.candidates[0].epochMs<r.candidates[1].epochMs);
    if(r.status==='resolved') assert.equal(r.candidates.length,1);
    else assert.ok(has(r,'dst-fold')||has(r,'dst-gap'));
  }
  assert.equal(count,1176);
});
test('property: source order never changes conservative target or consensus', () => {
  const sources=Array.from({length:12},(_,i)=>source({id:String(i),time:`${String(i+1).padStart(2,'0')}:00`}));
  for(let i=0;i<12;i++) { const rotated=[...sources.slice(i),...sources.slice(0,i)]; const r=analyzeCase(scenario(rotated)); assert.equal(r.planningInstant,'2026-10-31T00:00:00Z'); assert.equal(r.spreadMinutes,660); assert.equal(r.status,'conflict'); }
});
test('property: display zone does not change instant, candidate set, or consensus', () => {
  const s=source({date:'2026-11-01',time:'01:30',zone:'America/Toronto',weekday:''});
  const expected=analyzeSource(s,'UTC').candidates.map(x=>x.instant);
  for(const zone of ['Pacific/Auckland','Asia/Tokyo','America/Los_Angeles','+05:45']) assert.deepEqual(analyzeSource(s,zone).candidates.map(x=>x.instant),expected);
});
test('property: 1,000 deterministic fixed-offset results match independent UTC arithmetic', () => {
  let seed=31415926;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<1000;i++) {
    const year=2000+(random()%80),month=1+(random()%12),day=1+(random()%28),hour=random()%24,minute=random()%60;
    const offset=(random()%1681)-840,sign=offset<0?'-':'+';
    const zone=sign+String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')+':'+String(Math.abs(offset)%60).padStart(2,'0');
    const date=[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
    const time=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
    const r=analyzeSource(source({date,time,zone,weekday:''}));
    assert.equal(r.epochMs,Date.UTC(year,month-1,day,hour,minute)-offset*60000,`${date} ${time} ${zone}`);
  }
});
