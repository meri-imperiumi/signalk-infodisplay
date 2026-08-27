const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Smoketest for the notification visual layer. infodisplay.js is a plain
 * browser <script>, so we evaluate it in a sandbox that fakes just enough
 * of `window`/`document` for it to load, then exercise the pure helpers
 * that decide how a Signal K notification state is rendered: the CSS class
 * and severity tag, the theme-class color rung, day/night mode switching,
 * reconnect backoff, the link console, and the element lifecycle of
 * handleNotification via minimal fake DOM elements.
 *
 * This is intentionally a smoketest, not a full DOM render test: it pins
 * the state→class/theme mapping, the connection-resilience parameters,
 * and the console's circular-buffer behavior so they can't silently drift.
 */

function loadHelpers(overrides = {}) {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'infodisplay.js'),
    'utf8',
  );
  const sandbox = {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: overrides.document || {
      getElementById: () => null,
      querySelector: () => null,
      documentElement: { setAttribute: () => {} },
    },
    WebSocket: class {},
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window;
}

test('notificationClass maps SK states onto the status-tiles palette', () => {
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

test('notificationTheme maps states onto the spec theme classes', () => {
  const { notificationTheme } = loadHelpers();
  // Fine states share the green rung.
  assert.equal(notificationTheme('normal'), 'theme-green');
  assert.equal(notificationTheme('nominal'), 'theme-green');
  // alert keeps its own rung below warn: teal, not orange.
  assert.equal(notificationTheme('alert'), 'theme-teal');
  assert.equal(notificationTheme('warn'), 'theme-orange');
  assert.equal(notificationTheme('warning'), 'theme-orange');
  assert.equal(notificationTheme('alarm'), 'theme-red');
  assert.equal(notificationTheme('emergency'), 'theme-red');
  // Unknown/empty states fall back to the normal rung's green.
  assert.equal(notificationTheme(undefined), 'theme-green');
  assert.equal(notificationTheme('something-weird'), 'theme-green');
});

test('setEnvironmentMode applies data-mode only for day/night', () => {
  const applied = [];
  const fakeDoc = {
    documentElement: {
      setAttribute: (name, value) => applied.push([name, value]),
    },
  };
  const { setEnvironmentMode } = loadHelpers({ document: fakeDoc });
  setEnvironmentMode('day');
  setEnvironmentMode('night');
  // Anything else (unset, auto) leaves the last known mode alone.
  setEnvironmentMode('auto');
  setEnvironmentMode(undefined);
  assert.deepEqual(applied, [
    ['data-mode', 'day'],
    ['data-mode', 'night'],
  ]);
});

test('backoffDelay doubles per failed attempt and caps at the max', () => {
  const { backoffDelay } = loadHelpers();
  assert.equal(backoffDelay(0), 1000);
  assert.equal(backoffDelay(1), 2000);
  assert.equal(backoffDelay(2), 4000);
  assert.equal(backoffDelay(4), 16000);
  // Capped: never grows past the max, no matter how long the outage.
  assert.equal(backoffDelay(5), 30000);
  assert.equal(backoffDelay(20), 30000);
  // Defensive: negative attempt counts clamp to the base delay.
  assert.equal(backoffDelay(-1), 1000);
});

test('formatUtcClock renders UTC as HH:MM:SSZ with no timezone word', () => {
  const { formatUtcClock } = loadHelpers();
  assert.equal(formatUtcClock(new Date('2026-08-25T04:30:15Z')), '04:30:15Z');
  // Sub-second precision is truncated, not rounded.
  assert.equal(formatUtcClock(new Date('2026-08-25T23:59:01.900Z')), '23:59:01Z');
});

/* Minimal fake DOM: enough element shape for the notification and
 * console code paths (append/appendChild, childNodes/firstChild,
 * removeChild, remove, class names, textContent). */
function fakeElement(tag) {
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    removed: false,
    children: [],
    append(...kids) {
      this.children.push(...kids);
    },
    appendChild(child) {
      this.children.push(child);
    },
    get childNodes() {
      return this.children;
    },
    get firstChild() {
      return this.children[0];
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
    },
    remove() {
      this.removed = true;
    },
  };
  return el;
}

function fakeDocument() {
  const byId = {
    notifications: fakeElement('div'),
    'link-console': fakeElement('div'),
  };
  return {
    documentElement: { setAttribute: () => {} },
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => fakeElement(tag),
  };
}

test('handleNotification renders, updates and removes elements granularly', () => {
  const doc = fakeDocument();
  const { handleNotification } = loadHelpers({ document: doc });
  const stack = doc.getElementById('notifications');
  const ntfPath = 'notifications.navigation.depth.belowKeel';

  // A fresh visual alarm creates one element with its theme and state classes
  handleNotification(ntfPath, { state: 'alarm', method: ['visual'], message: 'Shallow water!' });
  assert.equal(stack.children.length, 1);
  const el = stack.children[0];
  assert.equal(el.className, 'notification theme-red alarm');
  const [tagEl, msgEl] = el.children;
  assert.equal(tagEl.className, 'ntf-tag');
  assert.equal(tagEl.textContent, 'ALARM');
  assert.equal(msgEl.className, 'ntf-msg');
  assert.equal(msgEl.textContent, 'Shallow water!');

  // A delta for the same path updates the cached nodes in place: no new element
  handleNotification(ntfPath, { state: 'warn', method: ['visual'], message: 'Getting shallow' });
  assert.equal(stack.children.length, 1);
  assert.equal(el.className, 'notification theme-orange warn');
  assert.equal(tagEl.textContent, 'WARN');
  assert.equal(msgEl.textContent, 'Getting shallow');

  // Losing the visual method tears the element down and forgets the path
  handleNotification(ntfPath, { state: 'normal', method: ['sound'] });
  assert.equal(el.removed, true);

  // ...so a later visual notification for the same path creates a fresh element
  handleNotification(ntfPath, { state: 'alarm', method: ['visual'], message: 'Shallow water!' });
  assert.equal(stack.children.length, 2);
});

test('handleNotification skips non-visual notifications without an element', () => {
  const doc = fakeDocument();
  const { handleNotification } = loadHelpers({ document: doc });
  const stack = doc.getElementById('notifications');
  // No method at all, or a non-visual one: nothing is ever created.
  handleNotification('notifications.x', { state: 'alarm', message: 'loud only' });
  handleNotification('notifications.y', { state: 'warn', method: ['sound'], message: 'sound only' });
  assert.equal(stack.children.length, 0);
});

test('appendLinkRow logs UTC rows and prunes to a circular buffer', () => {
  const doc = fakeDocument();
  const { appendLinkRow } = loadHelpers({ document: doc });
  const consoleEl = doc.getElementById('link-console');
  for (let i = 0; i < 7; i += 1) {
    appendLinkRow(`EVENT ${i}`, 'OK', 'ok');
  }
  // Only the newest LINK_LOG_MAX_LINES rows survive.
  assert.equal(consoleEl.children.length, 5);
  const messages = consoleEl.children.map((row) => row.children[1].textContent);
  assert.deepEqual(messages, ['EVENT 2', 'EVENT 3', 'EVENT 4', 'EVENT 5', 'EVENT 6']);
  // Row layout: timestamp | message | [ STATUS ]
  const newest = consoleEl.children[4].children;
  assert.match(newest[0].textContent, /^\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(newest[0].className, 'console-ts');
  assert.equal(newest[1].className, 'console-msg');
  assert.equal(newest[2].textContent, '[ OK ]');
  assert.equal(newest[2].className, 'console-status ok');
});

test('clearLinkConsole empties the console when the link is healthy', () => {
  const doc = fakeDocument();
  const win = loadHelpers({ document: doc });
  const consoleEl = doc.getElementById('link-console');
  win.appendLinkRow('LINK LOST', 'FAIL', 'fail');
  win.appendLinkRow('RECONNECTING', 'RETRY', 'warn');
  assert.equal(consoleEl.children.length, 2);
  // A healthy connection leaves no trace on screen (the :empty rule
  // hides the frame once there are no rows left).
  win.clearLinkConsole();
  assert.equal(consoleEl.children.length, 0);
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
