self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      data: { entryId: data.entryId, communityId: data.communityId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { entryId, communityId } = event.notification.data || {};
  const url = entryId && communityId ? `/?entry=${entryId}&community=${communityId}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("postMessage" in client) {
            client.postMessage({ type: "notification-click", entryId, communityId });
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
