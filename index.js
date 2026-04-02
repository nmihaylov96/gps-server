const express = require("express");
const mqtt    = require("mqtt");
const admin   = require("firebase-admin");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================= FIREBASE =================

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential:  admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// ================= MQTT =================

const client = mqtt.connect("mqtt://test.mosquitto.org:1883", {
  reconnectPeriod: 5000,
  clientId: "render-bridge-01"   // уникален ID за брокера
});

client.on("connect", () => {
  console.log("✅ MQTT Connected to test.mosquitto.org");
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

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("❌ Invalid JSON:", raw);
    return;
  }

  if (data.lat === undefined || data.lng === undefined) {
    console.error("❌ Missing lat/lng in payload");
    return;
  }

  try {
    await db.ref("trackers/tracker01").set({
      lat:       data.lat,
      lng:       data.lng,
      updatedAt: Date.now()
    });
    console.log(`🔥 Firebase updated → lat:${data.lat} lng:${data.lng}`);
  } catch (err) {
    console.error("Firebase write error:", err);
  }
});

// ================= HTTP ENDPOINT (резервен) =================

app.post("/gps", async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    await db.ref("trackers/tracker01").set({
      lat,
      lng,
      updatedAt: Date.now()
    });

    console.log(`🔥 Firebase updated via HTTP → lat:${lat} lng:${lng}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("HTTP Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================= HEALTH CHECK =================

app.get("/", (req, res) => {
  res.send("GPS → Firebase bridge running ✅");
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
