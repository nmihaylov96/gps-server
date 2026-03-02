const express = require("express");
const fetch = require("node-fetch");

const app = express();

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

app.get("/", (req, res) => {
  res.send("SERVER WORKING");
});

app.get("/gps", async (req, res) => {
  try {
    console.log("RAW QUERY:", req.query);

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const battery = Number(req.query.battery || 0);

    if (isNaN(lat) || isNaN(lng)) {
      console.log("INVALID DATA");
      return res.status(400).send("INVALID DATA");
    }

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
    console.error("SERVER ERROR:", err);
    res.status(500).send("ERROR");
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
