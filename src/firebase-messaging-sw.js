/* global importScripts, firebase, self, clients, __FIREBASE_WEB_CONFIG__ */
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

firebase.initializeApp(__FIREBASE_WEB_CONFIG__);

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
