const stateUrls = {};
const notifications = {};

function getUrlForState(state) {
  if (!stateUrls[state]) {
    return stateUrls.default;
  }
  return stateUrls[state];
}

function switchState(state) {
  const current = document.getElementById('current');
  const next = document.getElementById('next');
  const stateUrl = getUrlForState(state);
  if (current.getAttribute('src') === stateUrl) {
    // Already open!
    return;
  }
  if (next.getAttribute('src') === stateUrl) {
    next.id = 'current';
    current.id = 'next';
    return;
  }
  window.onmessage = null;
  next.onerror = (err) => {
    console.error(err);
    next.onload = null;
    next.onerror = null;
    // Try again
    switchState(state);
  };
  next.onload = () => {
    next.onload = null;
    next.onerror = null;
    // Cross-fade
    next.id = 'current';
    current.id = 'next';
    current.setAttribute('src', 'about:blank');
  };
  next.setAttribute('src', stateUrl);
}

function isNotificationVisual(notification) {
  if (notification.method && notification.method.indexOf('visual') === -1) {
    return false;
  }
  if (!notification.method && notification.state === 'normal') {
    return false;
  }
  return true;
}

function handleNotification(path, notification) {
  let element;
  if (notifications[path]) {
    // We have an element for this
    element = notifications[path];
  } else if (!isNotificationVisual(notification)) {
    // No element, but the alert doesn't have a visual component. We can skip this one
    return;
  } else {
    // New notification, create element
    const body = document.querySelector('body');
    element = document.createElement('dialog');
    notifications[path] = element;
    body.appendChild(element);
  }
  element.className = notification.state;
  element.innerHTML = `<p>${notification.message}</p>`;
  if (isNotificationVisual(notification)) {
    element.show();
  } else {
    element.close();
    // TODO: Destroy element?
  }
}

function getConfig(callback) {
  fetch('/signalk/v2/api/infodisplay')
    .then((res) => res.json())
    .then((config) => {
      Object.keys(config).forEach((state) => {
        stateUrls[state] = config[state];
      });
      callback();
    });
}

function connect() {
  const socket = new WebSocket(`${(window.location.protocol === 'https:' ? 'wss' : 'ws')}://${window.location.host}/signalk/v1/stream?subscribe=none&sendCachedValues=true`);
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      context: 'vessels.self',
      subscribe: [
        {
          path: 'navigation.state',
        },
        {
          path: 'notifications.*',
          policy: 'instant',
        },
      ],
    }));
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.updates || !data.updates.length) {
      return;
    }
    data.updates.forEach((u) => {
      if (!u.values || !u.values.length) {
        return;
      }
      u.values.forEach((v) => {
        if (v.path === 'navigation.state') {
          switchState(v.value);
          return;
        }
        if (v.path.indexOf('notifications.') === 0) {
          handleNotification(v.path, v.value);
        }
      });
    });
  });
  socket.addEventListener('close', () => {
    // Auto-reconnect in 1sec
    setTimeout(() => {
      connect();
    }, 1000);
  });
  socket.addEventListener('error', () => {
    socket.close();
  });
}

function onPageReady() {
  window.removeEventListener('load', onPageReady, false);
  getConfig(() => {
    switchState('default');
    connect();
  });
}

window.addEventListener('load', onPageReady, false);
