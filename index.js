const mqtt = require('mqtt');
const admin = require('firebase-admin');

// ================= FIREBASE =================

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// ================= MQTT =================

const client = mqtt.connect('mqtt://test.mosquitto.org:1883', {
  clean: true,
  reconnectPeriod: 5000
});

client.on('connect', () => {
  console.log('✅ Свързан към публичния MQTT брокер');

  client.subscribe('a9g/tracker01', (err) => {
    if (err) {
      console.error('❌ Subscribe грешка:', err);
    } else {
      console.log('📡 Абониран за a9g/tracker01');
    }
  });
});

client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    console.log('📍 Получени данни:', data);

    await db.ref('trackers/tracker01').set({
      lat: data.lat,
      lng: data.lng,
      updatedAt: Date.now()
    });

    console.log('🔥 Записано във Firebase');
  } catch (err) {
    console.error('❌ Грешка при обработка:', err);
  }
});

client.on('error', (err) => {
  console.error('MQTT грешка:', err.message);
});
