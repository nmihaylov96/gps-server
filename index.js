const express = require("express");
const mqtt    = require("mqtt");
const admin   = require("firebase-admin");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ── Firebase ──────────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential:  admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});
const db = admin.database();
console.log("✅ Firebase connected");

// ── Helpers ───────────────────────────────────────────────────────────────────
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function sendPushNotification(fcmToken, title, body) {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "geofence_alerts",
          defaultSound: true,
          defaultVibrateTimings: true,
          notificationPriority: "PRIORITY_HIGH",
        },
      },
    });
    console.log(`📱 Push изпратен: ${title}`);
  } catch (err) {
    console.error("❌ Push грешка:", err.message);
  }
}

// ── Device Info Handler ───────────────────────────────────────────────────────
// Слуша topic: a9g/{serial}/info
// Payload: imei:123,iccid:456,operator:A1
async function handleDeviceInfo(serialNumber, raw) {
  console.log(`📋 Device info за ${serialNumber}: ${raw}`);

  const imeiMatch     = raw.match(/imei:([^,]+)/);
  const iccidMatch    = raw.match(/iccid:([^,]+)/);
  const operatorMatch = raw.match(/operator:([^,]+)/);

  const imei     = imeiMatch     ? imeiMatch[1].trim()     : null;
  const iccid    = iccidMatch    ? iccidMatch[1].trim()    : null;
  const operator = operatorMatch ? operatorMatch[1].trim() : null;

  // Запиши само полета, които реално са получени (не "unknown")
  const updates = {};
  if (imei     && imei     !== "unknown") updates.imei         = imei;
  if (iccid    && iccid    !== "unknown") updates.iccid        = iccid;
  if (operator && operator !== "unknown") updates.sim_provider = operator;

  // Добави лог запис за boot събитие
  const bootLog = {
    type:      "boot",
    timestamp: Date.now(),
    imei:      imei     || "unknown",
    iccid:     iccid    || "unknown",
    operator:  operator || "unknown",
  };

  try {
    if (Object.keys(updates).length > 0) {
      await db.ref(`trackers/${serialNumber}`).update(updates);
      console.log(`✅ Device info записан за ${serialNumber}:`, updates);
    }

    // Запиши в device_logs/{serial}/{timestamp}
    await db.ref(`device_logs/${serialNumber}/${bootLog.timestamp}`).set(bootLog);
    console.log(`📝 Boot лог записан за ${serialNumber}`);
  } catch (err) {
    console.error("❌ Device info write error:", err.message);
  }
}

// ── Account History ───────────────────────────────────────────────────────────
// Записва в trackers/{serial}/account_history при всяко ново сдвояване
async function logAccountPairing(serialNumber, uid) {
  try {
    const existing = await db.ref(`trackers/${serialNumber}/account_history`).once("value");
    const history  = existing.val() || {};

    // Провери дали този uid вече е логнат като последен
    const entries  = Object.values(history);
    const lastEntry = entries.sort((a, b) => b.paired_at - a.paired_at)[0];
    if (lastEntry && lastEntry.uid === uid) return; // вече логнат

    await db.ref(`trackers/${serialNumber}/account_history/${Date.now()}`).set({
      uid,
      paired_at: Date.now(),
    });
    console.log(`📋 Account history: ${serialNumber} → ${uid}`);
  } catch (err) {
    console.error("❌ Account history error:", err.message);
  }
}

// ── Geofence проверка ─────────────────────────────────────────────────────────
async function checkGeofence(uid, serialNumber, lat, lng) {
  const geofenceSnap = await db.ref(`users/${uid}/trackers/${serialNumber}/geofence`).once("value");
  const geofence = geofenceSnap.val();
  if (!geofence || !geofence.active) return;

  const distance = calculateDistance(geofence.lat, geofence.lng, lat, lng);
  console.log(`📏 Разстояние: ${Math.round(distance)}м (лимит: ${geofence.radius}м)`);

  if (distance > geofence.radius && !geofence.outside) {
    const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
    const fcmToken  = tokenSnap.val();
    if (fcmToken) await sendPushNotification(fcmToken, "⚠️ DogTracker Alert!", "Кучето е излязло от зоната!");
    await db.ref(`users/${uid}/trackers/${serialNumber}/geofence`).update({ outside: true });

    // Лог за geofence нарушение
    await db.ref(`device_logs/${serialNumber}/${Date.now()}`).set({
      type: "geofence_exit", timestamp: Date.now(), uid,
    });
  } else if (distance <= geofence.radius && geofence.outside) {
    const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
    const fcmToken  = tokenSnap.val();
    if (fcmToken) await sendPushNotification(fcmToken, "✅ DogTracker", "Кучето се върна в зоната!");
    await db.ref(`users/${uid}/trackers/${serialNumber}/geofence`).update({ outside: false });
  }
}

// ── История cleanup ───────────────────────────────────────────────────────────
async function trimHistory(uid, serialNumber) {
  const historyRef = db.ref(`users/${uid}/trackers/${serialNumber}/history`);
  const snapshot   = await historyRef.orderByKey().once("value");
  const keys       = Object.keys(snapshot.val() || {});
  if (keys.length > 100) {
    const oldKeys = keys.sort().slice(0, keys.length - 100);
    for (const key of oldKeys) {
      await db.ref(`users/${uid}/trackers/${serialNumber}/history/${key}`).remove();
    }
  }
}

// ── Offline Alert ─────────────────────────────────────────────────────────────
const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000;

async function checkOfflineTrackers() {
  console.log("🔍 Проверка за офлайн тракери...");
  try {
    const trackersSnap = await db.ref("trackers").once("value");
    const trackers = trackersSnap.val();
    if (!trackers) return;

    for (const [serialNumber, trackerData] of Object.entries(trackers)) {
      const uid = trackerData?.owner_uid;
      if (!uid) continue;

      const trackerSnap = await db.ref(`users/${uid}/trackers/${serialNumber}`).once("value");
      const tracker = trackerSnap.val();
      if (!tracker) continue;

      const lastSeen = tracker.lastSeen;
      if (!lastSeen) continue;

      const now             = Date.now();
      const diffMs          = now - lastSeen;
      const diffMin         = Math.floor(diffMs / 60000);
      const isOffline       = diffMs > OFFLINE_THRESHOLD_MS;
      const offlineNotified = tracker.offlineNotified ?? false;

      if (isOffline && !offlineNotified) {
        console.log(`📴 ${serialNumber} офлайн от ${diffMin} мин — изпращам push`);
        const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
        const fcmToken  = tokenSnap.val();
        if (fcmToken) {
          await sendPushNotification(
            fcmToken,
            "📴 Тракерът е офлайн",
            `Няма сигнал от ${diffMin} минути. Провери устройството!`
          );
        }
        await db.ref(`users/${uid}/trackers/${serialNumber}`).update({ offlineNotified: true });

        // Лог за offline събитие
        await db.ref(`device_logs/${serialNumber}/${Date.now()}`).set({
          type: "offline", timestamp: Date.now(), offline_minutes: diffMin, uid,
        });

      } else if (!isOffline && offlineNotified) {
        console.log(`✅ ${serialNumber} обратно онлайн — нулирам offlineNotified`);
        await db.ref(`users/${uid}/trackers/${serialNumber}`).update({ offlineNotified: false });

        // Лог за online събитие
        await db.ref(`device_logs/${serialNumber}/${Date.now()}`).set({
          type: "online", timestamp: Date.now(), uid,
        });
      }
    }
  } catch (err) {
    console.error("❌ Грешка при offline проверка:", err.message);
  }
}

setInterval(checkOfflineTrackers, 5 * 60 * 1000);
setTimeout(checkOfflineTrackers, 10000);

// ── MQTT ──────────────────────────────────────────────────────────────────────
const client = mqtt.connect("mqtt://test.mosquitto.org:1883", {
  reconnectPeriod: 5000,
  clientId: "render-bridge-01"
});

client.on("connect", () => {
  console.log("✅ MQTT Connected to mosquitto");
  // Слушай и GPS и device info topics
  client.subscribe("a9g/+",      (err) => { if (!err) console.log("📡 Subscribed to a9g/+"); });
  client.subscribe("a9g/+/info", (err) => { if (!err) console.log("📡 Subscribed to a9g/+/info"); });
});

client.on("reconnect", () => console.log("🔄 MQTT reconnecting..."));
client.on("error",     (err) => console.error("MQTT error:", err));

client.on("message", async (topic, message) => {
  const raw   = message.toString();
  const parts = topic.split("/");
  console.log(`📨 MQTT [${topic}]: ${raw}`);

  // a9g/{serial}/info — device info при boot
  if (parts.length === 3 && parts[2] === "info") {
    const serialNumber = parts[1];
    await handleDeviceInfo(serialNumber, raw);
    return;
  }

  // a9g/{serial} — нормален GPS update
  if (parts.length !== 2) return;
  const serialNumber = parts[1];

  const trackerSnap = await db.ref(`trackers/${serialNumber}/owner_uid`).once("value");
  const uid = trackerSnap.val();
  if (!uid) {
    console.error(`❌ Тракер ${serialNumber} няма owner — не е сдвоен`);
    return;
  }

  // Лог pairing history
  await logAccountPairing(serialNumber, uid);

  let lat, lng, battery;

  try {
    const data = JSON.parse(raw);
    if (data.lat !== undefined && data.lng !== undefined) {
      lat = data.lat; lng = data.lng; battery = data.bat ?? 0;
    }
  } catch (e) {}

  if (lat === undefined) {
    const latMatch = raw.match(/lat:([\d.\-]+)/);
    const lngMatch = raw.match(/lng:([\d.\-]+)/);
    const batMatch = raw.match(/bat:([\d.\-]+)/);
    if (latMatch && lngMatch) {
      lat     = parseFloat(latMatch[1]);
      lng     = parseFloat(lngMatch[1]);
      battery = batMatch ? parseFloat(batMatch[1]) : 0;
    }
  }

  if (lat === undefined || lng === undefined) {
    console.error("❌ Не мога да прочета lat/lng от:", raw);
    return;
  }

  const timestamp = Date.now();

  try {
    const prevSnap = await db.ref(`users/${uid}/trackers/${serialNumber}`).once("value");
    const prev = prevSnap.val();
    let speed = 0;
    if (prev && prev.lat && prev.lng && prev.timestamp) {
      const dist     = calculateDistance(prev.lat, prev.lng, lat, lng);
      const timeDiff = (timestamp - prev.timestamp) / 1000;
      if (timeDiff > 0) speed = (dist / timeDiff) * 3.6;
    }

    await db.ref(`users/${uid}/trackers/${serialNumber}`).update({
      lat, lng, timestamp, battery, speed,
      lastSeen: timestamp,
      offlineNotified: false,
      name: prev?.name ?? "Моето куче"
    });

    await db.ref(`users/${uid}/trackers/${serialNumber}/history/${timestamp}`).set({ lat, lng });
    await trimHistory(uid, serialNumber);
    await checkGeofence(uid, serialNumber, lat, lng);

    console.log(`🔥 Firebase → ${serialNumber} | uid:${uid} | lat:${lat} lng:${lng} bat:${battery}%`);
  } catch (err) {
    console.error("Firebase write error:", err);
  }
});

// ── HTTP endpoint ─────────────────────────────────────────────────────────────
app.post("/gps", async (req, res) => {
  const { lat, lng, battery, serialNumber } = req.body;
  if (!lat || !lng || !serialNumber)
    return res.status(400).json({ error: "Missing lat, lng or serialNumber" });

  try {
    const trackerSnap = await db.ref(`trackers/${serialNumber}/owner_uid`).once("value");
    const uid = trackerSnap.val();
    if (!uid) return res.status(404).json({ error: "Tracker not found or not paired" });

    await logAccountPairing(serialNumber, uid);

    const timestamp = Date.now();
    const prevSnap  = await db.ref(`users/${uid}/trackers/${serialNumber}`).once("value");
    const prev      = prevSnap.val();
    let speed = 0;
    if (prev && prev.lat && prev.lng && prev.timestamp) {
      const dist     = calculateDistance(prev.lat, prev.lng, lat, lng);
      const timeDiff = (timestamp - prev.timestamp) / 1000;
      if (timeDiff > 0) speed = (dist / timeDiff) * 3.6;
    }

    await db.ref(`users/${uid}/trackers/${serialNumber}`).update({
      lat, lng, timestamp,
      battery: battery ?? 0,
      speed,
      lastSeen: timestamp,
      offlineNotified: false,
      name: prev?.name ?? "Моето куче"
    });

    await db.ref(`users/${uid}/trackers/${serialNumber}/history/${timestamp}`).set({ lat, lng });
    await trimHistory(uid, serialNumber);
    await checkGeofence(uid, serialNumber, lat, lng);

    console.log(`🔥 HTTP → ${serialNumber} | lat:${lat} lng:${lng} bat:${battery}%`);
    res.json({ ok: true });
  } catch (err) {
    console.error("Firebase write error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("GPS Bridge running ✅"));
app.listen(PORT, () => console.log(`🌍 Port ${PORT}`));
