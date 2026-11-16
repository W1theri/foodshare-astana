import { expires, pickupTime } from './domain.js';

function calendarText(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replace(/\r\n?|\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function calendarDate(date) {
  return new Date(date).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function fold(line) {
  const encoder = new TextEncoder();
  let width = 0;
  let result = '';
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (width + bytes > 75) {
      result += '\r\n ';
      width = 1;
    }
    result += char;
    width += bytes;
  }
  return result;
}

export function pickupCalendar(order, now = Date.now()) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FoodShare//Pickup//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:' + crypto.randomUUID() + '@foodshare', 'DTSTAMP:' + calendarDate(now),
    'DTSTART:' + calendarDate(pickupTime(order)), 'DTEND:' + calendarDate(expires(order)),
    'SUMMARY:' + calendarText('FoodShare pickup at ' + order.cafe),
    'LOCATION:' + calendarText(order.address),
    'DESCRIPTION:' + calendarText(order.title + '\nOpen My pickups in FoodShare for your ticket.'),
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export function pickupMap(offer) {
  const latitude = offer.lat;
  const longitude = offer.lng;
  const url = new URL('https://www.openstreetmap.org/search');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    url.searchParams.set('query', offer.address.replace(/^Demo location near /i, '') + ', Astana, Kazakhstan');
    return url.href;
  }
  url.pathname = '/';
  url.searchParams.set('mlat', latitude);
  url.searchParams.set('mlon', longitude);
  url.hash = `map=16/${latitude}/${longitude}`;
  return url.href;
}
