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
    await db.ref(`users/${uid}/trackers/tracker01`).update({
      lat, lng, timestamp, battery: 0,
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
