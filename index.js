const mqtt = require('mqtt');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://dogtracker-19213-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

const client = mqtt.connect('mqtt://test.mosquitto.org:1883');

client.on('connect', () => {
  console.log('✅ Свързан към MQTT (test.mosquitto.org)');
  client.subscribe('a9g/tracker01', (err) => {
    if (!err) console.log('✅ 구독нат a9g/tracker01 – готов да получава GPS');
  });
});

client.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log('📍 Получени координати:', data);
    
    // Записваме точно където ти искаш
    db.ref('trackers/tracker01').set(data);
    console.log('✅ Записано в Firebase /trackers/tracker01');
  } catch (e) {
    console.error('Грешка при парсване:', e);
  }
});

client.on('error', (err) => {
  console.error('MQTT грешка:', err);
});
