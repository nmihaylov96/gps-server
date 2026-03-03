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

    console.log("🔥 Saved to Firebase");
  } catch (err) {
    console.error(err);
  }
});

// ================= HEALTH CHECK =================

app.get("/", (req, res) => {
  res.send("MQTT → Firebase bridge running");
});

app.listen(PORT, () => {
  console.log("🌍 Server running on port", PORT);
});
