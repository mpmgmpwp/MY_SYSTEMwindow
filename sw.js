importScripts("db.js");

const CACHE_NAME = "system-app-cache-v2";
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
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
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

  // Best-effort surprise quest issuance. periodicsync wake-ups are already at
  // browser-determined, unpredictable times (Chrome/Android only) — adding a
  // chance-based skip on top means not every wake produces a quest, so when
  // one does land it's genuinely "did not know it was coming."
  if (Math.random() < 0.35) {
    await issueSurpriseQuest(state);
  }
}

const SW_FALLBACK_POOL = [
  { title: "緊急：10分間の運動", statTag: "STR", rewardExp: 15, rewardStat: 1, penaltyExp: -20, penaltyStat: -1 },
  { title: "緊急：5分間の姿勢リセットと深呼吸", statTag: "FOC", rewardExp: 10, rewardStat: 1, penaltyExp: -15, penaltyStat: -1 },
  { title: "緊急：水を一杯飲む", statTag: "VIT", rewardExp: 8, rewardStat: 1, penaltyExp: -10, penaltyStat: -1 },
  { title: "緊急：15分間の学習", statTag: "INT", rewardExp: 12, rewardStat: 1, penaltyExp: -15, penaltyStat: -1 },
];

function swUid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function issueSurpriseQuest(state) {
  const picked = SW_FALLBACK_POOL[Math.floor(Math.random() * SW_FALLBACK_POOL.length)];
  const now = new Date();
  const deadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const newQuest = {
    id: swUid(), title: picked.title, type: "once", statTag: picked.statTag,
    deadlineTime: `${String(deadline.getHours()).padStart(2, "0")}:${String(deadline.getMinutes()).padStart(2, "0")}`,
    deadlineDate: todayStr(deadline),
    rewardExp: picked.rewardExp, rewardStat: picked.rewardStat,
    penaltyExp: picked.penaltyExp, penaltyStat: picked.penaltyStat,
    rewardItem: null, status: "active", lastCompletedDate: null,
    streak: 0, failCount: 0, createdDate: todayStr(now),
    scalingEnabled: false, origin: "system", isPenaltyQuest: false,
    chainLevel: 0, parentQuestId: null,
  };
  state.quests = state.quests || [];
  state.quests.push(newQuest);
  await systemSetState(state);
  await self.registration.showNotification("SYSTEM: 新規クエスト発行", {
    body: newQuest.title,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "system-new-quest-" + newQuest.id,
  });
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
