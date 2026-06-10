const express = require("express");
const mqtt    = require("mqtt");
const admin   = require("firebase-admin");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential:  admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});
const db = admin.database();
console.log("✅ Firebase connected");

// ─── GEOFENCE НАСТРОЙКИ ───────────────────────────────
// Тези се пазят в паметта — после ще ги четем от Firebase
const geofences = {};  // { uid: { lat, lng, radius, outside } }

// ─── ПОМОЩНА ФУНКЦИЯ: разстояние в метри ─────────────
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

// ─── ИЗПРАТИ PUSH ИЗВЕСТИЕ ────────────────────────────
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
        },
      },
    });
    console.log("📱 Push известие изпратено!");
  } catch (err) {
    console.error("❌ Push грешка:", err.message);
  }
}

// ─── MQTT ─────────────────────────────────────────────
const client = mqtt.connect("mqtt://test.mosquitto.org:1883", {
  reconnectPeriod: 5000,
  clientId: "render-bridge-01"
});

client.on("connect", () => {
  console.log("✅ MQTT Connected to mosquitto");
  client.subscribe("a9g/tracker01", (err) => {
    if (err) console.error("Subscribe error:", err);
    else     console.log("📡 Subscribed to a9g/tracker01");
  });
});

client.on("reconnect", () => console.log("🔄 MQTT reconnecting..."));
client.on("error",     (err) => console.error("MQTT error:", err));

client.on("message", async (topic, message) => {
  const raw = message.toString();
  console.log(`📨 MQTT [${topic}]: ${raw}`);

  let lat, lng;

  try {
    const data = JSON.parse(raw);
    if (data.lat !== undefined && data.lng !== undefined) {
      lat = data.lat;
      lng = data.lng;
    }
  } catch (e) {}

  if (lat === undefined) {
    const latMatch = raw.match(/lat:([\d.\-]+)/);
    const lngMatch = raw.match(/lng:([\d.\-]+)/);
    if (latMatch && lngMatch) {
      lat = parseFloat(latMatch[1]);
      lng = parseFloat(lngMatch[1]);
    }
  }

  if (lat === undefined || lng === undefined) {
    console.error("❌ Не мога да прочета lat/lng от:", raw);
    return;
  }

  const timestamp = Date.now();
  const uid = "cZihoAQ1oFcvhogwBkgR7JBemAB2";

  try {
    // Запиши позицията
    await db.ref(`users/${uid}/trackers/tracker01`).update({
      lat, lng, timestamp, battery: 0,
      name: "Моето куче"
    });

    await db.ref(`users/${uid}/trackers/tracker01/history/${timestamp}`).set({
      lat, lng
    });

    // Изтрий стари записи
    const historyRef = db.ref(`users/${uid}/trackers/tracker01/history`);
    const snapshot   = await historyRef.orderByKey().once("value");
    const keys       = Object.keys(snapshot.val() || {});
    if (keys.length > 100) {
      const oldKeys = keys.sort().slice(0, keys.length - 100);
      for (const key of oldKeys) {
        await db.ref(`users/${uid}/trackers/tracker01/history/${key}`).remove();
      }
    }

    // ─── ПРОВЕРИ GEOFENCE ─────────────────────────────
    const geofenceSnap = await db.ref(`users/${uid}/trackers/tracker01/geofence`).once("value");
    const geofence = geofenceSnap.val();

    if (geofence && geofence.active) {
      const distance = calculateDistance(
        geofence.lat, geofence.lng,
        lat, lng
      );

      console.log(`📏 Разстояние от зона: ${Math.round(distance)}м (лимит: ${geofence.radius}м)`);

      if (distance > geofence.radius && !geofence.outside) {
        // Излязло от зоната — изпрати известие
        console.log("⚠️ Излязло от зона!");

        // Вземи FCM токена
        const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
        const fcmToken  = tokenSnap.val();

        if (fcmToken) {
          await sendPushNotification(
            fcmToken,
            "⚠️ DogTracker Alert!",
            "Кучето е излязло от зоната!"
          );
        }

        // Маркирай като извън зоната
        await db.ref(`users/${uid}/trackers/tracker01/geofence`).update({
          outside: true
        });

      } else if (distance <= geofence.radius && geofence.outside) {
        // Върнало се в зоната
        console.log("✅ Върна се в зоната");
        await db.ref(`users/${uid}/trackers/tracker01/geofence`).update({
          outside: false
        });

        const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
        const fcmToken  = tokenSnap.val();

        if (fcmToken) {
          await sendPushNotification(
            fcmToken,
            "✅ DogTracker",
            "Кучето се върна в зоната!"
          );
        }
      }
    }

    console.log(`🔥 Firebase → lat:${lat} lng:${lng}`);
  } catch (err) {
    console.error("Firebase write error:", err);
  }
});

app.post("/gps", async (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined)
    return res.status(400).json({ error: "Missing lat or lng" });
  try {
    const timestamp = Date.now();
    const uid = "cZihoAQ1oFcvhogwBkgR7JBemAB2";
    await db.ref(`users/${uid}/trackers/tracker01`).update({
      lat, lng, timestamp, battery: 0
    });
    await db.ref(`users/${uid}/trackers/tracker01/history/${timestamp}`).set({ lat, lng });
    console.log(`🔥 HTTP → lat:${lat} lng:${lng}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("GPS Bridge running ✅"));
app.listen(PORT, () => console.log(`🌍 Port ${PORT}`));
