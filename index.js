const express = require("express");
const mqtt = require("mqtt");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================= FIREBASE =================

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// ================= MQTT =================

const client = mqtt.connect("mqtt://test.mosquitto.org:1883", {
  reconnectPeriod: 5000
});

client.on("connect", () => {
  console.log("✅ MQTT Connected");
  client.subscribe("a9g/tracker01");
});

client.on("message", async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    await db.ref("trackers/tracker01").set({
      lat: data.lat,
      lng: data.lng,
      updatedAt: Date.now()
    });

    console.log("🔥 Saved to Firebase via MQTT");
  } catch (err) {
    console.error("MQTT Error:", err);
  }
});

// ================= HTTP ENDPOINT (FOR A9G) =================

app.post("/gps", async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      return res.status(400).send("Invalid data");
    }

    await db.ref("trackers/tracker01").set({
      lat,
      lng,
      updatedAt: Date.now()
    });

    console.log("🔥 Saved to Firebase via HTTP");

    res.status(200).send("OK");
  } catch (err) {
    console.error("HTTP Error:", err);
    res.status(500).send("Server error");
  }
});

// ================= HEALTH CHECK =================

app.get("/", (req, res) => {
  res.send("GPS → Firebase bridge running");
});

app.listen(PORT, () => {
  console.log("🌍 Server running on port", PORT);
});
