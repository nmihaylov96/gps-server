const express = require("express");
const fetch = require("node-fetch");

const app = express();

const FIREBASE_URL =
  "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

app.get("/gps", async (req, res) => {
  try {
    const { lat, lng } = req.query;

    await fetch(`${FIREBASE_URL}/trackers/tracker01.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        time: Date.now(),
      }),
    });

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("ERROR");
  }
});

app.get("/", (req, res) => {
  res.send("SERVER WORKING");
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);
