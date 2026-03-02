const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

// Root test
app.get("/", (req, res) => {
  res.send("SERVER WORKING");
});

// GPS endpoint
app.get("/gps", async (req, res) => {
  try {
    console.log("RAW QUERY:", req.query);

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const battery = parseInt(req.query.battery || "0");

    // Правилна проверка
    if (isNaN(lat) || isNaN(lng)) {
      console.log("INVALID DATA RECEIVED");
      return res.status(400).send("INVALID DATA");
    }

    // Запис във Firebase
    const firebaseResponse = await fetch(
      `${FIREBASE_URL}/trackers/tracker01.json`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: lat,
          lng: lng,
          battery: battery,
          timestamp: Date.now(),
        }),
      }
    );

    const result = await firebaseResponse.text();

    console.log("Firebase response:", result);
    console.log("Firebase updated:", lat, lng);

    res.send("OK");
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).send("ERROR");
  }
});

// Render порт
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
