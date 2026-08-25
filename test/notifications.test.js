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
