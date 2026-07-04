// db.js — shared between index.html and sw.js (loaded via importScripts there)
// IndexedDB is used instead of localStorage because a Service Worker cannot
// read localStorage at all, and background notification checks only run
// inside the Service Worker.

const SYSTEM_DB_NAME = "system-app-db";
const SYSTEM_DB_STORE = "state";
const SYSTEM_DB_KEY = "main";

function systemOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYSTEM_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SYSTEM_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function systemGetState() {
  const db = await systemOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYSTEM_DB_STORE, "readonly");
    const req = tx.objectStore(SYSTEM_DB_STORE).get(SYSTEM_DB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function systemSetState(state) {
  const db = await systemOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYSTEM_DB_STORE, "readwrite");
    tx.objectStore(SYSTEM_DB_STORE).put(state, SYSTEM_DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
