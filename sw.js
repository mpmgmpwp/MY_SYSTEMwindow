importScripts("db.js");

const CACHE_NAME = "system-app-cache-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./db.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});

// Best-effort background check. Periodic Background Sync only fires on
// Chrome/Android for installed, sufficiently-engaged PWAs — it will not
// fire on iOS Safari. This is a bonus path, not the primary reminder
// mechanism (see the app's in-page checks and README).
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "system-daily-check") {
    event.waitUntil(checkQuestsAndNotify());
  }
});

// Allow the page to ask the SW to run the same check manually (used by the
// "通知テスト" button in Settings).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SYSTEM_TEST_NOTIFY") {
    event.waitUntil(checkQuestsAndNotify(true));
  }
});

async function checkQuestsAndNotify(forceTest = false) {
  const state = await systemGetState();
  if (!state) return;

  if (forceTest) {
    await self.registration.showNotification("SYSTEM", {
      body: "通知は正常に届いています。",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "system-test",
    });
    return;
  }

  const now = new Date();
  const leadMs = ((state.settings && state.settings.reminderLeadHours) || 3) * 60 * 60 * 1000;
  const dueSoon = (state.quests || []).filter((q) => {
    if (q.status !== "active") return false;
    if (q.type === "daily" && q.lastCompletedDate === todayStr(now)) return false;
    const deadline = questDeadline(q, now);
    if (!deadline) return false;
    const diffMs = deadline.getTime() - now.getTime();
    return diffMs > 0 && diffMs <= leadMs;
  });

  const overdue = (state.quests || []).filter((q) => {
    if (q.status !== "active") return false;
    if (q.type === "daily" && q.lastCompletedDate === todayStr(now)) return false;
    const deadline = questDeadline(q, now);
    return deadline && deadline.getTime() < now.getTime();
  });

  if (overdue.length > 0) {
    await self.registration.showNotification("警告：未達成のクエストがあります", {
      body: `${overdue.length}件のクエストが期限切れです。ペナルティが発生する可能性があります。`,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "system-overdue",
    });
  } else if (dueSoon.length > 0) {
    await self.registration.showNotification("クエスト期限が近づいています", {
      body: dueSoon.map((q) => q.title).join(" / "),
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "system-duesoon",
    });
  }
}

function todayStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function questDeadline(quest, now) {
  if (quest.type === "daily") {
    const [h, m] = (quest.deadlineTime || "23:59").split(":").map(Number);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  }
  if (quest.type === "once" && quest.deadlineDate) {
    const [h, m] = (quest.deadlineTime || "23:59").split(":").map(Number);
    const [y, mo, da] = quest.deadlineDate.split("-").map(Number);
    return new Date(y, mo - 1, da, h, m, 0);
  }
  return null;
}
