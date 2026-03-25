/* global importScripts, firebase, self, clients */
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAFkyY1Lrigj2dAQ0t9amDbwGLcdzyiRXU',
  authDomain: 'm14u-js.firebaseapp.com',
  projectId: 'm14u-js',
  storageBucket: 'm14u-js.firebasestorage.app',
  messagingSenderId: '102126601252',
  appId: '1:102126601252:web:dada5103b4d382e1f604b1',
  measurementId: 'G-SG98J8L065',
});

const messaging = firebase.messaging();

async function forwardToClients(payload) {
  const windowClients = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  windowClients.forEach((client) => {
    client.postMessage({
      type: 'FCM_EVENT',
      payload,
    });
  });

  return windowClients;
}

messaging.onBackgroundMessage(async (payload) => {
  const data = payload?.data || {};
  const windows = await forwardToClients(data);

  const hasVisibleClient = windows.some((client) => client.visibilityState === 'visible');
  const isHostPresenceEvent = data.type === 'member_join' || data.type === 'member_leave';

  if (!hasVisibleClient && isHostPresenceEvent) {
    const title = data.title || 'Room activity';
    const body = data.type === 'member_join'
      ? `${data.memberName || 'A member'} joined your room`
      : `${data.memberName || 'A member'} left your room`;

    await self.registration.showNotification(title, {
      body,
      tag: `room-${data.roomCode}-${data.type}`,
      renotify: false,
    });
  }
});
