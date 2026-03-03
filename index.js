const mqtt = require('mqtt');
const admin = require('firebase-admin');

// === СМЕНИ ТОВА ===
const serviceAccount = require('./serviceAccountKey.json');   // свали от Firebase → Project Settings → Service accounts → Generate new private key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://твоят-проект-default-rtdb.europe-west1.firebasedatabase.app"  // ТВОЯТ URL
});

const db = admin.database();
const client = mqtt.connect('mqtt://test.mosquitto.org');

client.on('connect', () => {
  console.log('✅ Свързан към MQTT брокър');
  client.subscribe('gps/location', (err) => {
    if (!err) console.log('✅ 구독нат gps/location');
  });
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log('📍 Получени координати:', data);

    // Запис в Firebase (latest + история)
    db.ref('gps/latest').set(data);
    db.ref('gps/history').push(data);

  } catch (e) {
    console.error('Грешка при парсване:', e);
  }
});

client.on('error', (err) => console.error('MQTT error:', err));
