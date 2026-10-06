/* firebase-messaging-sw.js — Web Push service worker.
 * Served at the site root so browsers can wake it to show notifications
 * even when the tab/app is closed (Gmail/Instagram style).
 *
 * The Firebase web config below is PUBLIC (safe to expose).
 *
 * The Firebase setup is wrapped in try/catch so that if the Firebase scripts
 * cannot be loaded (ad blocker, network filter, offline), the worker still
 * evaluates and registers instead of throwing
 * "ServiceWorker script evaluation failed".
 */
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  firebase.initializeApp({
    apiKey: "AIzaSyC0f13VfYnKe6rcltOiauhWH8_nDMWdj5k",
    authDomain: "ce0001.firebaseapp.com",
    projectId: "ce0001",
    storageBucket: "ce0001.firebasestorage.app",
    messagingSenderId: "539364596262",
    appId: "1:539364596262:web:459c2f777d1167d08064e7",
  });

  const messaging = firebase.messaging();

  // Fires when a push arrives while the site is closed or in the background.
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || "Notification", {
      body: n.body || "",
      icon: "/logo192.png",
      data: payload.data || {},
    });
  });
} catch (e) {
  console.error("[firebase-messaging-sw] Firebase init failed:", e);
}

// Focus/open the app when the user taps the notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});