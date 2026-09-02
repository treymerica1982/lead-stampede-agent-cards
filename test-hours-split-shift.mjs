const dayMap = { mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday' };
function normalizeTime(raw){const s=raw.trim().toLowerCase();const m=s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);if(!m)return s;let h=parseInt(m[1],10);const min=m[2]||'00';const p=m[3];if(p==='pm'&&h<12)h+=12;if(p==='am'&&h===12)h=0;return `${String(h).padStart(2,'0')}:${min}`;}

function OLD(hours){const specs=[];for(const[key,label]of Object.entries(dayMap)){const val=hours[key];if(!val||/closed/i.test(val))continue;const match=val.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);if(match){specs.push({'@type':'OpeningHoursSpecification',dayOfWeek:label,opens:normalizeTime(match[1]),closes:normalizeTime(match[2])});}}return specs;}

const RE=/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
function NEW(hours){const specs=[];for(const[key,label]of Object.entries(dayMap)){const val=hours[key];if(!val||typeof val!=='string'||/closed/i.test(val))continue;for(const part of val.split(/[,;]/)){const match=part.trim().match(RE);if(match){specs.push({'@type':'OpeningHoursSpecification',dayOfWeek:label,opens:normalizeTime(match[1]),closes:normalizeTime(match[2])});}}}return specs;}

const fixtures = {
  'Lost Pines (split shift)': {mon:'Closed',tue:'8:00am-12:00pm, 2:30pm-6:00pm',wed:'8:00am-12:00pm, 2:30pm-6:00pm',thu:'8:00am-12:00pm, 2:30pm-6:00pm',fri:'8:00am-1:00pm',sat:'9:00am-2:00pm',sun:'Closed'},
  'REGRESSION single range (v1.10 template)': {mon:'9am-5pm',tue:'9am-5pm',wed:'9am-5pm',thu:'9am-5pm',fri:'9am-5pm',sat:'Closed',sun:'Closed'},
  'REGRESSION dealership style': {mon:'9:00am-7:00pm',tue:'9:00am-7:00pm',wed:'9:00am-7:00pm',thu:'9:00am-7:00pm',fri:'9:00am-6:00pm',sat:'9:00am-6:00pm',sun:'Closed'},
  'REGRESSION en-dash': {mon:'8:30am–5:30pm',sun:'Closed'},
  'REGRESSION empty object (X28)': {},
  'REGRESSION with note key': {mon:'9am-5pm',note:'Closed holidays'},
  'semicolon separator': {mon:'8am-12pm; 2pm-6pm'},
  'three ranges': {mon:'7am-9am, 11am-1pm, 4pm-8pm'},
  'malformed tail': {mon:'9am-5pm, garbage'},
  'non-string value': {mon:123},
};

let regressions=0, fixed=0;
for (const [name,h] of Object.entries(fixtures)) {
  let o,n,oErr=null;
  try{o=OLD(h)}catch(e){oErr=e.message;o=null}
  n=NEW(h);
  const same = oErr===null && JSON.stringify(o)===JSON.stringify(n);
  const tag = name.startsWith('REGRESSION') ? (same?'IDENTICAL ✓':'CHANGED ✗') : (same?'unchanged':'improved');
  if(name.startsWith('REGRESSION') && !same) regressions++;
  if(!name.startsWith('REGRESSION') && !same) fixed++;
  console.log(`\n${name} — ${tag}`);
  console.log('  old:', oErr?`THREW: ${oErr}`:o.map(s=>`${s.dayOfWeek.slice(0,3)} ${s.opens}-${s.closes}`).join(' | ')||'(none)');
  console.log('  new:', n.map(s=>`${s.dayOfWeek.slice(0,3)} ${s.opens}-${s.closes}`).join(' | ')||'(none)');
}
console.log(`\n=== regressions: ${regressions} | behavior changes (intended): ${fixed} ===`);
