// PlanMySeat school tracker.
// Reads schools.csv, shows each school with its form status, lets parents
// filter by area and board, and checks a child's age against each school's
// age reference date. Everything runs in the browser; nothing is sent anywhere.

// Minimum age (completed years on the school's age_reference_date) for each class.
// ASSUMPTION based on the common Maharashtra rule. Verify against the official
// notices and update here if anything differs. See CLAUDE.md.
const MIN_AGE = [
  { cls: 'Nursery', years: 3 },
  { cls: 'Jr KG', years: 4 },
  { cls: 'Sr KG', years: 5 },
  { cls: 'Class 1', years: 6 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const today = new Date();
today.setHours(0, 0, 0, 0);

let schools = [];
let birthDate = null;

const $ = (id) => document.getElementById(id);

// ---------- Reading schools.csv ----------

// Splits CSV text into rows of objects keyed by the header row.
// Handles quoted fields such as "First come, first served".
function parseCSV(text) {
  text = text.replace(/^﻿/, ''); // Excel adds an invisible mark at the start
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

// Accepts 2026-11-01 or 01/11/2026 (day first). Returns null if empty or unreadable.
function parseDate(value) {
  if (!value) return null;
  let m, y, mo, d;
  if ((m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, mo, d] = m;
  else if ((m = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, mo, y] = m;
  else return null;
  const date = new Date(+y, +mo - 1, +d);
  if (date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null; // e.g. 31 Feb
  return date;
}

function formatDate(date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function toSchool(row) {
  const get = (key) => row[key] || '';
  const readDate = (key) => {
    const date = parseDate(get(key));
    if (get(key) && !date) console.warn(`schools.csv: "${get('name')}" has an unreadable ${key}: "${get(key)}"`);
    return date;
  };
  const isSample = /^sample\b/i.test(get('name')) || get('verified_on').toUpperCase() === 'SAMPLE';
  return {
    name: get('name'),
    area: get('area'),
    board: get('board'),
    classes: get('classes').split(';').map((c) => c.trim()).filter(Boolean),
    opens: readDate('form_opens'),
    closes: readDate('form_closes'),
    selection: get('selection_method'),
    ageRef: readDate('age_reference_date'),
    link: get('official_link'),
    verified: isSample ? null : readDate('verified_on'),
    isSample,
  };
}

// ---------- Form status ----------

function formStatus(s) {
  if (s.closes && today > s.closes) return { key: 'closed', label: 'Closed' };
  if (!s.opens) return { key: 'tba', label: 'Dates not announced' };
  if (today < s.opens) return { key: 'soon', label: 'Opening soon' };
  return { key: 'open', label: 'Open now' };
}

function formDatesText(s) {
  if (s.opens && s.closes) return `${formatDate(s.opens)} to ${formatDate(s.closes)}`;
  if (s.opens) return `From ${formatDate(s.opens)} (closing date not announced)`;
  if (s.closes) return `Until ${formatDate(s.closes)}`;
  return 'Not announced yet';
}

// ---------- Age checker ----------

// Completed years and months on a given date.
function ageOn(birth, onDate) {
  let years = onDate.getFullYear() - birth.getFullYear();
  let months = onDate.getMonth() - birth.getMonth();
  if (onDate.getDate() < birth.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Returns { kind: 'yes' | 'no' | 'info', text } for one school.
function eligibility(s) {
  if (!s.ageRef) return { kind: 'info', text: 'Age reference date not announced yet.' };

  const age = ageOn(birthDate, s.ageRef);
  const ageText = age.years < 0
    ? `not yet born on ${formatDate(s.ageRef)}`
    : `${plural(age.years, 'year')} ${plural(age.months, 'month')} on ${formatDate(s.ageRef)}`;

  let band = null;
  for (const b of MIN_AGE) if (age.years >= b.years) band = b;
  const last = MIN_AGE[MIN_AGE.length - 1];

  if (!band) {
    return { kind: 'no', text: `Too young for ${MIN_AGE[0].cls} here: ${ageText} (needs ${MIN_AGE[0].years} years).` };
  }
  if (band === last && age.years > last.years) {
    return { kind: 'no', text: `Above ${last.cls} entry age here: ${ageText}.` };
  }
  const offered = s.classes.some((c) => c.toLowerCase() === band.cls.toLowerCase());
  if (offered) return { kind: 'yes', text: `Eligible for ${band.cls}: ${ageText}.` };
  return { kind: 'no', text: `Age fits ${band.cls}, which this school is not listing: ${ageText}.` };
}

// ---------- Showing the list ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function schoolCard(s) {
  const card = el('article', 'school');

  const top = el('div', 'school-top');
  top.append(el('h3', null, s.name));
  const status = formStatus(s);
  top.append(el('span', `status status-${status.key}`, status.label));
  card.append(top);

  card.append(el('p', 'school-sub', [s.area, s.board].filter(Boolean).join(' · ')));

  const facts = el('dl', 'facts');
  const addFact = (label, value) => {
    facts.append(el('dt', null, label), el('dd', null, value));
  };
  addFact('Classes', s.classes.join(', ') || 'Not listed');
  addFact('Form dates', formDatesText(s));
  addFact('Selection', s.selection || 'Not announced');
  addFact('Age counted on', s.ageRef ? formatDate(s.ageRef) : 'Not announced');
  card.append(facts);

  if (birthDate) {
    const result = eligibility(s);
    card.append(el('p', `eligibility ${result.kind}`, result.text));
  }

  const foot = el('p', 'school-foot');
  if (/^https?:\/\//i.test(s.link)) {
    const a = el('a', null, 'Official notice ↗');
    a.href = s.link;
    a.target = '_blank';
    a.rel = 'noopener';
    foot.append(a);
  } else {
    foot.append(el('span', null, 'Official link not added yet'));
  }
  if (s.isSample) foot.append(el('span', 'unverified', 'SAMPLE entry, not a real school'));
  else if (s.verified) foot.append(el('span', null, `Checked against official notice on ${formatDate(s.verified)}`));
  else foot.append(el('span', 'unverified', 'Not yet verified. Check the official notice.'));
  card.append(foot);

  return card;
}

function render() {
  const area = $('filter-area').value;
  const board = $('filter-board').value;
  const shown = schools.filter((s) => (!area || s.area === area) && (!board || s.board === board));

  const list = $('school-list');
  list.replaceChildren(...shown.map(schoolCard));
  if (!shown.length) list.append(el('p', 'empty', 'No schools match these filters.'));

  $('count').textContent = `Showing ${shown.length} of ${plural(schools.length, 'school')}`;

  if (birthDate) {
    const matches = shown.filter((s) => eligibility(s).kind === 'yes').length;
    $('age-message').textContent =
      `Born ${formatDate(birthDate)}: age matches a class at ${matches} of ${plural(shown.length, 'school')} shown below.`;
  }
}

function fillSelect(select, values) {
  [...new Set(values.filter(Boolean))].sort().forEach((v) => select.append(new Option(v, v)));
}

function showLoadError() {
  const msg = location.protocol === 'file:'
    ? 'This page needs a small local web server to read schools.csv. See "Check the page on your computer" in CLAUDE.md.'
    : 'Could not load the school list. Please refresh the page or try again later.';
  $('school-list').replaceChildren(el('p', 'error', msg));
}

async function load() {
  try {
    const res = await fetch('schools.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    schools = parseCSV(await res.text())
      .map(toSchool)
      .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical: no ranking
  } catch (err) {
    console.error('Could not load schools.csv:', err);
    showLoadError();
    return;
  }

  fillSelect($('filter-area'), schools.map((s) => s.area));
  fillSelect($('filter-board'), schools.map((s) => s.board));
  $('sample-banner').hidden = !schools.some((s) => s.isSample);
  render();
}

// ---------- Wiring up the page ----------

$('filter-area').addEventListener('change', render);
$('filter-board').addEventListener('change', render);

const birthInput = $('birth-date');
birthInput.max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

$('age-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const date = parseDate(birthInput.value);
  if (!date || date > today) {
    $('age-message').textContent = 'Please enter a valid date of birth.';
    return;
  }
  birthDate = date;
  $('age-clear').hidden = false;
  render();
});

$('age-clear').addEventListener('click', () => {
  birthDate = null;
  birthInput.value = '';
  $('age-message').textContent = '';
  $('age-clear').hidden = true;
  render();
});

load();
