// Calendar accounting only. No provider requests and no estimates from prompt length.
export const USAGE_TIME_ZONE = 'Europe/Moscow';
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});
const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: USAGE_TIME_ZONE, timeZoneName: 'shortOffset'
});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: USAGE_TIME_ZONE, day: 'numeric', month: 'long'
});
const dayMs = 86_400_000;

function localParts(epoch) {
  const parts = Object.fromEntries(calendar.formatToParts(new Date(epoch)).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}
function localMidnight(year, month, day) {
  const calendarTime = Date.UTC(year, month - 1, day);
  let guess = calendarTime;
  for (let i = 0; i < 2; i++) {
    const zone = offsetFormat.formatToParts(new Date(guess)).find(p => p.type === 'timeZoneName').value;
    const match = zone.match(/GMT([+-])(\d+)(?::(\d+))?/);
    const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60_000 : 0;
    guess = calendarTime - offset;
  }
  return guess;
}
export function periodRange(period = 'day', now = Date.now()) {
  const { year, month, day } = localParts(now);
  let firstDay = day, nextDay = day + 1, firstMonth = month, nextMonth = month;
  if (period === 'week') {
    const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    firstDay -= weekday;
    nextDay = firstDay + 7;
  } else if (period === 'month') {
    firstDay = 1; nextDay = 1; nextMonth = month + 1;
  } else if (period !== 'day') throw new Error('Unknown usage period');
  const start = localMidnight(year, firstMonth, firstDay);
  const end = localMidnight(year, nextMonth, nextDay);
  const label = period === 'day' ? dateFormat.format(start) : dateFormat.format(start) + ' — ' + dateFormat.format(end - 1);
  return { start, end, label, timeZone: USAGE_TIME_ZONE };
}
export function appendUsage(records, record) {
  if (!record.id || !record.employeeId || !Number.isFinite(record.completedAt)) throw new Error('Invalid usage identity or time');
  for (const key of ['inputTokens', 'outputTokens']) {
    if (record[key] !== null && (!Number.isSafeInteger(record[key]) || record[key] < 0)) throw new Error('Invalid token count');
  }
  record = { ...record, requestedMode: record.requestedMode ?? null, effectiveMode: record.effectiveMode ?? null };
  for (const field of ['requestedMode', 'effectiveMode']) {
    if (![null, 'standard', 'fast'].includes(record[field])) throw new Error('Invalid usage mode');
  }
  const existing = records.find(item => item.id === record.id);
  if (existing) {
    for (const field of ['employeeId', 'connectionId', 'completedAt', 'inputTokens', 'outputTokens', 'requestedMode', 'effectiveMode']) {
      if ((existing[field] ?? null) !== (record[field] ?? null)) throw new Error('Conflicting usage event');
    }
    return false;
  }
  records.push(Object.freeze({ ...record }));
  return true;
}
function emptyTotals() {
  return { input: 0, output: 0, inputKnown: 0, outputKnown: 0, inputUnknown: 0, outputUnknown: 0, requests: 0, incompleteRequests: 0 };
}
function groupedTotals() {
  return { ...emptyTotals(), byMode: { standard: emptyTotals(), fast: emptyTotals(), unknown: emptyTotals() } };
}
function countInto(total, event) {
  total.requests++;
  if (event.inputTokens === null) total.inputUnknown++;
  else { total.input += event.inputTokens; total.inputKnown++; }
  if (event.outputTokens === null) total.outputUnknown++;
  else { total.output += event.outputTokens; total.outputKnown++; }
  if (event.inputTokens === null || event.outputTokens === null) total.incompleteRequests++;
}
export function aggregateUsage(employees, records, period = 'day', now = Date.now(), modeField = 'effectiveMode') {
  const range = periodRange(period, now), totals = groupedTotals(), seen = new Set();
  const rows = new Map(employees.map(employee => [employee.id, { employee, ...groupedTotals() }]));
  for (const event of records) {
    if (seen.has(event.id) || event.completedAt < range.start || event.completedAt >= range.end) continue;
    seen.add(event.id);
    if (!rows.has(event.employeeId)) {
      rows.set(event.employeeId, { employee: { id: event.employeeId, name: 'Архивный сотрудник', email: '', color: 0 }, ...groupedTotals() });
    }
    const mode = ['standard', 'fast'].includes(event[modeField]) ? event[modeField] : 'unknown';
    const row = rows.get(event.employeeId);
    countInto(totals, event);
    countInto(totals.byMode[mode], event);
    countInto(row, event);
    countInto(row.byMode[mode], event);
  }
  return { range, totals, rows: [...rows.values()].sort((a, b) => (b.input + b.output) - (a.input + a.output) || a.employee.name.localeCompare(b.employee.name, 'ru')) };
}
export function demoUsage(employees, connections, now = Date.now()) {
  const records = [], today = periodRange('day', now).start;
  for (let daysAgo = 0; daysAgo < 35; daysAgo++) {
    employees.forEach((employee, index) => {
      if (index >= 6 && index !== 8) return;
      const completedAt = daysAgo ? today - daysAgo * dayMs + (9 + index) * 3_600_000 : Math.max(today, now - (index + 1) * 60_000);
      const input = 12_000 + ((index * 1379 + daysAgo * 859) % 38_000);
      const output = 1800 + ((index * 347 + daysAgo * 193) % 6800);
      const unknownShare = index === 1 ? 0.1 : 0;
      const standardInput = Math.floor(input * 0.6), standardOutput = Math.floor(output * 0.6);
      const unknownInput = Math.floor(input * unknownShare), unknownOutput = Math.floor(output * unknownShare);
      const parts = [
        { mode: 'standard', input: standardInput, output: standardOutput },
        { mode: 'fast', input: input - standardInput - unknownInput, output: output - standardOutput - unknownOutput }
      ];
      if (unknownShare) parts.push({ mode: null, input: unknownInput, output: unknownOutput });
      for (const part of parts) appendUsage(records, {
        id: 'demo-seed-' + daysAgo + '-' + employee.id + '-' + (part.mode || 'unknown'), employeeId: employee.id,
        connectionId: connections[(daysAgo + index) % connections.length].id,
        completedAt, receivedAt: completedAt, source: 'demo',
        requestedMode: part.mode === 'standard' && index % 3 !== 0 ? 'standard' : 'fast', effectiveMode: part.mode,
        inputTokens: part.input, outputTokens: part.output
      });
    });
  }
  appendUsage(records, {
    id: 'demo-missing-output', employeeId: employees[1].id, connectionId: connections[0].id,
    completedAt: Math.max(today, now - 10_000), receivedAt: now, source: 'demo',
    inputTokens: 1024, outputTokens: null, requestedMode: 'fast', effectiveMode: 'fast'
  });
  return records;
}
