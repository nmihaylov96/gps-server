const express = require("express");
const fetch = require("node-fetch");

const app = express();

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

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
    await fetch(`${FIREBASE_URL}/trackers/tracker01.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, battery, timestamp: Date.now() }),
    });
    res.send("OK");
  } catch {
    res.status(500).send("ERROR");
  }
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log("OK"));
