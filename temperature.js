const ds18b20 = require('ds18b20');
const MQTT_CHANNEL_TEMP = 'home/shop/aircon/temp';
const mqtt = require('mqtt')
const DEVICE_ID = '28-01192e131195';
const MQTT_SERVER = 'mqtt://192.168.1.55';

function cToF(celsius) {
  return (celsius * 9 / 5 + 32).toFixed(1);
}

var client = mqtt.connect(MQTT_SERVER, { reconnectPeriod: 5000 });

client.on('connect', function () {
  client.publish(MQTT_CHANNEL_TEMP, "Connected");
});

client.on('error', function (err) {
  console.error(err);
});

function reportTemp() {
  try {
    const temp = ds18b20.temperatureSync(DEVICE_ID, { parser: 'hex' });
    client.publish(MQTT_CHANNEL_TEMP, cToF(temp) + "");
  } catch (err) {
    console.error(err);
  }
}

// Run once at startup
reportTemp();

// Then do update every 30 seconds
setInterval(reportTemp, 30000);

process.stdin.resume();
