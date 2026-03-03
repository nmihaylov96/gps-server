const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());   // важно – за да чете JSON ако ползваш POST по-късно

// === Инициализация на Admin SDK ===
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

app.get("/", (req, res) => {
  res.send("OK");
});

app.get("/gps", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const battery = Number(req.query.battery || 0);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).send("INVALID");
    }

    const data = {
      lat,
      lng,
      battery,
      timestamp: Date.now()
    };

    await db.ref("trackers/tracker01").set(data);

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("ERROR");
  }
});

const PORT = process.env.PORT || 3000;   // Render предпочита 3000+ вместо 80
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
