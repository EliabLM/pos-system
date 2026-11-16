// CC-POS-13: business day helpers (America/Bogota), independent of process TZ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const compiled = await build({
  entryPoints: [resolve('src/lib/time.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const time = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

// 20:00 Bogota on 2026-11-15 is 01:00 UTC on 2026-11-16.
const at2000 = new Date('2026-11-16T01:00:00.000Z');
const at2330 = new Date('2026-11-16T04:30:00.000Z');
const at0030Next = new Date('2026-11-16T05:30:00.000Z');
const within = (date, range) => date >= range.gte && date <= range.lte;

const zones = ['UTC', 'America/Bogota', 'Asia/Tokyo', 'America/Los_Angeles'];

for (const tz of zones) {
  test(`P0 zona horaria (TZ=${tz}): 20:00 Bogotá pertenece al día de Bogotá`, () => {
    process.env.TZ = tz;
    assert.equal(time.businessDayKey(at2000), '2026-11-15');
    assert.equal(time.businessDayCompact(at2000), '20261115');
    assert.equal(time.businessDayKey(new Date('2026-11-16T04:59:59.999Z')), '2026-11-15');
    assert.equal(time.businessDayKey(new Date('2026-11-16T05:00:00.000Z')), '2026-11-16');
  });

  test(`P0 zona horaria (TZ=${tz}): "hoy" incluye 23:30 y excluye 00:30 del día siguiente`, () => {
    process.env.TZ = tz;
    const today = time.businessDayRange(at2330);
    assert.equal(today.gte.toISOString(), '2026-11-15T05:00:00.000Z');
    assert.equal(today.lte.toISOString(), '2026-11-16T04:59:59.999Z');
    assert.ok(within(at2330, today));
    assert.ok(!within(at0030Next, today));
    // Date-only strings are business days taken literally.
    assert.deepEqual(time.businessDayRange('2026-11-15'), today);
    assert.ok(within(at2330, time.businessDayRange('2026-11-15', '2026-11-15')));
    assert.ok(within(at0030Next, time.businessDayRange('2026-11-16')));
  });
}

test('P0 zona horaria: mes, días relativos y claves de periodo', () => {
  process.env.TZ = 'UTC';
  // 2026-12-01 00:30 Bogota (05:30Z) is December, not November.
  const dec = new Date('2026-12-01T05:30:00.000Z');
  assert.equal(time.startOfBusinessMonth(dec).toISOString(), '2026-12-01T05:00:00.000Z');
  assert.equal(time.endOfBusinessMonth(at2330).toISOString(), '2026-12-01T04:59:59.999Z');
  // Last day of November at 23:30 Bogota stays in November.
  const nov30 = new Date('2026-12-01T04:30:00.000Z');
  assert.equal(time.businessPeriodKey(nov30, 'month'), '2026-11-01');
  assert.equal(time.businessPeriodKey(at2330, 'day'), '2026-11-15');
  assert.equal(time.businessPeriodKey(at2330, 'hour'), '2026-11-15 23:00');
  // 2026-11-15 is a Sunday: its week starts Monday 2026-11-09.
  assert.equal(time.businessPeriodKey(at2330, 'week'), '2026-11-09');
  assert.equal(time.businessPeriodKey(at0030Next, 'week'), '2026-11-16');
  assert.equal(time.businessPeriodKey(new Date('2027-01-01T04:00:00.000Z'), 'year'), '2026-01-01');
  assert.equal(time.addBusinessDays(at2330, -1).toISOString(), '2026-11-15T04:30:00.000Z');
  assert.equal(time.formatBusinessDate(at2330), '15/11/2026');
  assert.throws(() => time.businessDayRange('no-es-fecha'));
});
