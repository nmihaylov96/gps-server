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

let lastPosition = null;

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

function calculateSpeed(lat1, lon1, lat2, lon2, timeMs) {
  const distance = calculateDistance(lat1, lon1, lat2, lon2);
  const timeHours = timeMs / 3600000;
  const speedKmh = (distance / 1000) / timeHours;
  return Math.round(speedKmh * 10) / 10;
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
          priority: "max",
          defaultVibrateTimings: true,
        },
      },
    });
    console.log("📱 Push известие изпратено!");
  } catch (err) {
    console.error("❌ Push грешка:", err.message);
  }
}

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

  let lat, lng, battery = 0;

  try {
    const data = JSON.parse(raw);
    if (data.lat !== undefined && data.lng !== undefined) {
      lat     = data.lat;
      lng     = data.lng;
      battery = data.battery || 0;
    }
  } catch (e) {}

  if (lat === undefined) {
    const latMatch = raw.match(/lat:([\d.\-]+)/);
    const lngMatch = raw.match(/lng:([\d.\-]+)/);
    const batMatch = raw.match(/bat:(\d+)/);
    if (latMatch && lngMatch) {
      lat     = parseFloat(latMatch[1]);
      lng     = parseFloat(lngMatch[1]);
      battery = batMatch ? parseInt(batMatch[1]) : 0;
    }
  }

  if (lat === undefined || lng === undefined) {
    console.error("❌ Не мога да прочета lat/lng от:", raw);
    return;
  }

  const timestamp = Date.now();
  const uid = "cZihoAQ1oFcvhogwBkgR7JBemAB2";

  // Изчисли скорост
  let speed = 0;
  if (lastPosition) {
    const timeDiff = timestamp - lastPosition.timestamp;
    if (timeDiff > 0 && timeDiff < 300000) {
      speed = calculateSpeed(
        lastPosition.lat, lastPosition.lng,
        lat, lng, timeDiff
      );
    }
  }
  lastPosition = { lat, lng, timestamp };

  try {
    await db.ref(`users/${uid}/trackers/tracker01`).update({
      lat, lng, timestamp, battery, speed,
      name: "Моето куче"
    });

    await db.ref(`users/${uid}/trackers/tracker01/history/${timestamp}`).set({
      lat, lng
    });

    const historyRef = db.ref(`users/${uid}/trackers/tracker01/history`);
    const snapshot   = await historyRef.orderByKey().once("value");
    const keys       = Object.keys(snapshot.val() || {});
    if (keys.length > 100) {
      const oldKeys = keys.sort().slice(0, keys.length - 100);
      for (const key of oldKeys) {
        await db.ref(`users/${uid}/trackers/tracker01/history/${key}`).remove();
      }
    }

    const geofenceSnap = await db.ref(`users/${uid}/trackers/tracker01/geofence`).once("value");
    const geofence = geofenceSnap.val();

    if (geofence && geofence.active) {
      const distance = calculateDistance(
        geofence.lat, geofence.lng, lat, lng
      );
      console.log(`📏 Разстояние: ${Math.round(distance)}м (лимит: ${geofence.radius}м)`);

      if (distance > geofence.radius && !geofence.outside) {
        console.log("⚠️ Излязло от зона!");
        const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
        const fcmToken  = tokenSnap.val();
        if (fcmToken) {
          await sendPushNotification(fcmToken, "⚠️ DogTracker Alert!", "Кучето е излязло от зоната!");
        }
        await db.ref(`users/${uid}/trackers/tracker01/geofence`).update({ outside: true });

      } else if (distance <= geofence.radius && geofence.outside) {
        console.log("✅ Върна се в зоната");
        const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
        const fcmToken  = tokenSnap.val();
        if (fcmToken) {
          await sendPushNotification(fcmToken, "✅ DogTracker", "Кучето се върна в зоната!");
        }
        await db.ref(`users/${uid}/trackers/tracker01/geofence`).update({ outside: false });
      }
    }

    if (battery > 0 && battery <= 20) {
      const tokenSnap = await db.ref(`users/${uid}/fcmToken`).once("value");
      const fcmToken  = tokenSnap.val();
      if (fcmToken) {
        await sendPushNotification(
          fcmToken,
          "🔋 Ниска батерия!",
          `Батерията на тракера е ${battery}%. Заредете го скоро!`
        );
      }
    }

    console.log(`🔥 Firebase → lat:${lat} lng:${lng} bat:${battery}% speed:${speed}км/ч`);
  } catch (err) {
    console.error("Firebase write error:", err);
  }
});

app.post("/gps", async (req, res) => {
  const { lat, lng, battery = 0 } = req.body;
  if (lat === undefined || lng === undefined)
    return res.status(400).json({ error: "Missing lat or lng" });
  try {
    const timestamp = Date.now();
    const uid = "cZihoAQ1oFcvhogwBkgR7JBemAB2";
    await db.ref(`users/${uid}/trackers/tracker01`).update({
      lat, lng, timestamp, battery, speed: 0
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
