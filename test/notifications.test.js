const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Smoketest for the notification visual layer. infodisplay.js is a plain
 * browser <script>, so we evaluate it in a sandbox that fakes just enough
 * of `window`/`document` for it to load, then exercise the two pure helpers
 * that decide how a Signal K notification state is rendered: the CSS class
 * (shared hue ramp with ../signalk-status-tiles) and the severity tag word.
 *
 * This is intentionally a smoketest, not a DOM render test: it pins the
 * state→class mapping so the HUD palette and the severity ordering can't
 * silently drift.
 */

function loadHelpers() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'infodisplay.js'),
    'utf8',
  );
  const sandbox = {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: { getElementById: () => null, querySelector: () => null },
    WebSocket: class {},
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window;
}

test('notificationClass maps SK states onto the status-tiles hue ramp', () => {
  const { notificationClass } = loadHelpers();
  assert.equal(notificationClass('normal'), 'normal');
  assert.equal(notificationClass('nominal'), 'nominal');
  // alert is its own rung below warn — NOT collapsed into warn.
  assert.equal(notificationClass('alert'), 'alert');
  // warn and its `warning` spelling alias collapse to the amber rung.
  assert.equal(notificationClass('warn'), 'warn');
  assert.equal(notificationClass('warning'), 'warn');
  assert.equal(notificationClass('alarm'), 'alarm');
  assert.equal(notificationClass('emergency'), 'emergency');
});

test('notificationClass falls back to neutral for unknown/empty state', () => {
  const { notificationClass } = loadHelpers();
  assert.equal(notificationClass(undefined), 'normal');
  assert.equal(notificationClass(''), 'normal');
  assert.equal(notificationClass('something-weird'), 'normal');
});

test('notificationTag is silent for non-alarm states, loud for alarms', () => {
  const { notificationTag } = loadHelpers();
  // No tag when there's no judgment to shout.
  assert.equal(notificationTag('normal'), '');
  assert.equal(notificationTag('nominal'), '');
  // alert is its own word, distinct from warn (not folded in).
  assert.equal(notificationTag('alert'), 'ALERT');
  // Uppercase severity word for everything that pulses.
  assert.equal(notificationTag('warn'), 'WARN');
  assert.equal(notificationTag('warning'), 'WARN');
  assert.equal(notificationTag('alarm'), 'ALARM');
  assert.equal(notificationTag('emergency'), 'EMERGENCY');
});

test('matchesNotificationPattern: exact path, no wildcard', () => {
  const { matchesNotificationPattern } = loadHelpers();
  const p = 'notifications.electrical.batteries.bank1.stateOfCharge';
  assert.equal(matchesNotificationPattern(p, p), true);
  assert.equal(matchesNotificationPattern(p, 'notifications.electrical.batteries.bank2.stateOfCharge'), false);
});

test('matchesNotificationPattern: `*` stays within one dot-segment', () => {
  const { matchesNotificationPattern } = loadHelpers();
  // Any single segment (bank name) between batteries. and .temperature.
  const pat = 'notifications.electrical.batteries.*.temperature';
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.temperature', pat), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank2.temperature', pat), true);
  // `*` does NOT span dots: two segments between batteries and temperature.
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.cell1.temperature', pat), false);
  // `*` matches zero or more chars within its segment (so a bare segment
  // between the dots is fine), but the dots on either side are required.
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries..temperature', pat), true);
});

test('matchesNotificationPattern: `*` within a segment (partial)', () => {
  const { matchesNotificationPattern } = loadHelpers();
  const pat = 'notifications.electrical.batteries.bank*.stateOfCharge';
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.stateOfCharge', pat), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank12.stateOfCharge', pat), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.inverter.stateOfCharge', pat), false);
});

test('matchesNotificationPattern: `**` spans segments', () => {
  const { matchesNotificationPattern } = loadHelpers();
  // Trailing `**` matches anything at any depth under the prefix.
  const tail = 'notifications.electrical.batteries.**';
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1', tail), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.cell1.temperature', tail), true);
  // `**` is zero-or-more, so the bare prefix matches too.
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries', tail), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.charger.state', tail), false);
  // `**` in the middle spans an arbitrary run of segments.
  const mid = 'notifications.**.temperature';
  assert.equal(matchesNotificationPattern('notifications.temperature', mid), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.temperature', mid), true);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries.bank1.voltage', mid), false);
});

test('matchesNotificationPattern: `*` alone is one segment, `**` alone is anything', () => {
  const { matchesNotificationPattern } = loadHelpers();
  assert.equal(matchesNotificationPattern('x', '*'), true);
  assert.equal(matchesNotificationPattern('x.y', '*'), false);
  assert.equal(matchesNotificationPattern('anything.at.all', '**'), true);
  assert.equal(matchesNotificationPattern('', '**'), true);
});

test('matchesNotificationPattern: pattern must match the whole path', () => {
  const { matchesNotificationPattern } = loadHelpers();
  // No partial matching: a prefix pattern doesn't match a longer path.
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries', 'notifications.electrical'), false);
  assert.equal(matchesNotificationPattern('notifications.electrical.batteries', 'notifications.electrical.batteries'), true);
});

test('matchesNotificationPattern: empty/undefined pattern never matches', () => {
  const { matchesNotificationPattern } = loadHelpers();
  assert.equal(matchesNotificationPattern('notifications.x', ''), false);
  assert.equal(matchesNotificationPattern('notifications.x', undefined), false);
  assert.equal(matchesNotificationPattern('notifications.x', null), false);
});
