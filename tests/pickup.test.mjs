import test from 'node:test';
import assert from 'node:assert/strict';
import { pickupCalendar, pickupMap } from '../dist/pickup.js';

test('calendar uses the Astana time window and excludes the pickup code', () => {
  const order = {
    id: 'FS-ABCDEF12', date: '2026-11-17', start: '18:00', end: '21:00', utcOffset: '+05:00',
    cafe: 'Пекарня, Астана', address: 'Central 5; entrance B\nSecond line',
    title: 'Яблочный пирог '.repeat(9),
  };
  const calendar = pickupCalendar(order, Date.UTC(2026, 10, 16));
  assert.match(calendar, /DTSTART:20261117T130000Z\r\nDTEND:20261117T160000Z/);
  assert.match(calendar, /LOCATION:Central 5\\; entrance B\\nSecond line/);
  assert.ok(!calendar.includes('ABCDEF12'), 'calendar should not expose a redeemable pickup code');
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.match(pickupMap(order), /openstreetmap\.org\/search\?query=/);
});
