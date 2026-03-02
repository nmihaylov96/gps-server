const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const FIREBASE_URL = "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app";

app.post("/gps", async (req, res) => {
    try {
        const { lat, lng } = req.body;

        await fetch(`${FIREBASE_URL}/trackers/tracker01.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, time: Date.now() })
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

app.listen(3000, () => console.log("Server running"));
