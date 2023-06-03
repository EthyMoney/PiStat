import ds18b20 from 'ds18b20';
const MQTT_CHANNEL_TEMP = 'home/shop/aircon/temp';
import mqtt from 'mqtt';
const DEVICE_ID = '28-01192e131195';
const MQTT_SERVER = 'mqtt://192.168.1.55';

function cToF(celsius) {
  return (celsius * 9 / 5 + 32).toFixed(1);
}

const client = mqtt.connect(MQTT_SERVER, { reconnectPeriod: 5000 });

// mqtt event handlers
client.on('connect', function () {
  client.publish(MQTT_CHANNEL_TEMP, "Connected");
  console.log("Connected to MQTT server")
  // Run temp check once right at startup
  reportTemp(true);
});
client.on('reconnect', function () {
  console.log('Reconnecting to the MQTT server...');
});
client.on('close', function () {
  console.log('Disconnected from the MQTT server.');
});
client.on('offline', function () {
  console.log('The client has gone offline.');
});
client.on('end', function () {
  console.log('Client connection ended.');
});

function reportTemp(firstRun) {
  try {
    const temp = ds18b20.temperatureSync(DEVICE_ID, { parser: 'hex' });
    client.publish(MQTT_CHANNEL_TEMP, cToF(temp) + "");
    if (firstRun) console.log("Reported temp: " + temp.toFixed(1) + "C" + " (" + cToF(temp) + "F)");
  } catch (err) {
    console.error(err);
  }
}

// Then do update every 30 seconds
setInterval(reportTemp, 30000);

process.stdin.resume();
