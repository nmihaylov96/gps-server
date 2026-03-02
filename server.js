const express = require("express");

const app = express();
app.use(express.json());

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

app.get("/", (req, res) => {
  res.send("SERVER WORKING");
});

app.get("/gps", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const battery = parseInt(req.query.battery || "0");

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).send("INVALID DATA");
    }

    await fetch(`${FIREBASE_URL}/trackers/tracker01.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat,
        lng,
        battery,
        timestamp: Date.now(),
      }),
    });

    console.log("Firebase updated:", lat, lng);

    res.send("OK");
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).send("ERROR");
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
