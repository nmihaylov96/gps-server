const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

app.get("/", (req, res) => {
  res.send("SERVER WORKING");
});

// ESP ще праща тук:
// https://gps-server-x1m1.onrender.com/gps?lat=..&lng=..&battery=..
app.get("/gps", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const battery = parseInt(req.query.battery || "0");

    if (!lat || !lng) {
      return res.status(400).send("INVALID DATA");
    }

    await fetch(`${FIREBASE_URL}/trackers/tracker01.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: lat,
        lng: lng,
        battery: battery,
        timestamp: Date.now(),
      }),
    });

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("ERROR");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
