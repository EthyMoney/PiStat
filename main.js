/*
Program: Pi Air Conditioner Controller
Author: Logan (GitHub: EthyMoney)
Version: 1.0.0b (Beta)
Started: 5/13/2020
*/

//##################################################################
//                     Setup and Declarations
//##################################################################

// Instance constants
const MQTT_CLIENT_IDENTIFIER = 9; //set this to whatever you want, I was just using it as a way to distinguish this mqtt client from others
const FAN_RELAY_PIN = 23;
const COMPRESSOR_RELAY_PIN = 24;
const MQTT_CONTROL_CHANNEL = 'pi9_aircon';
const MQTT_TEMPERATURE_CHANNEL = 'pi9_aircon/temp';
const MQTT_BROKER_ENDPOINT = 'mqtt://192.168.1.28';

// Imports
import chalk from 'chalk';
import mqtt from 'mqtt';
import schedule from 'node-schedule';
const rpio = require('rpio');

// System runtime values
let currentTemp = 70; //needs to get set by sensor
let setTemp = 76; //default
let compressorOn = false;
let fanOn = false;
let cycleTime = '';
let systemEnabled = false;
let currentDuty = 'OFF';
let startTime = new Date(); //start counting the cycle time

// Configure rpio and set relay pins
rpio.init({ gpiomem: false });
rpio.init({ mapping: 'gpio' });
rpio.open(FAN_RELAY_PIN, rpio.OUTPUT);
rpio.open(COMPRESSOR_RELAY_PIN, rpio.OUTPUT);

// Configure the LCD output (20 columns by 4 rows)
const init = new Buffer.from([0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06]);
const LCD_LINE1 = 0x80, LCD_LINE2 = 0xc0, LCD_LINE3 = 0x94, LCD_LINE4 = 0xD4;
const LCD_ENABLE = 0x04, LCD_BACKLIGHT = 0x08;

// Connect to MQTT broker and start listening on the control channel
const client = mqtt.connect(MQTT_BROKER_ENDPOINT);
client.on('connect', function () {
  client.subscribe([MQTT_CONTROL_CHANNEL, MQTT_TEMPERATURE_CHANNEL], function (err) {
    if (err) {
      console.log(err);
    }
  });
});

// Set the system updater to run on a schedule of every 3 minutes
schedule.scheduleJob('*/3 * * * *', update);

// Update once right away at startup
update();

// Report that we are ready for action!
console.log(`AirCon Client ${MQTT_CLIENT_IDENTIFIER} is running and listening for commands! :)`);



//##################################################################
//                     Unit Control Management
//##################################################################

// Perform an elegant startup of the unit
async function cool() {
  //start the fan first, then compressor after delay, then update status
  fanStart();
  publishReport();
  setTimeout(function () {
    motorCheckup();
    //make sure the fan is on AND the current status hasn't been changed back to idle/off while we waited
    if (fanOn) {
      compressorStart();
      publishReport();
    }
  }, 15000); //15sec delay between fan and compressor startup
}

// Perform an elegant shutdown of the unit
async function shutdown() {
  //stop the compressor first, then fan after a defrost delay, then update status
  compressorStop();
  publishReport();
  setTimeout(function () {
    motorCheckup();
    //make sure the current status hasn't been changed back to cooling while we waited
    if (!compressorOn) {
      fanStop();
      publishReport();
    }
  }, 180000); //3min defrost
}

// Retrieve the status of the relays to know what our fan and compressor motors are doing
function motorCheckup() {
  compressorOn = rpio.read(COMPRESSOR_RELAY_PIN) ? true : false;
  fanOn = rpio.read(FAN_RELAY_PIN) ? true : false;
  // Emergency compressor safety (prevents compressor from running without airflow from the fan)
  // This should never really happen in this code, but just in case something leads to this condition...
  if (compressorOn && !fanOn) {
    compressorStop();
    systemEnabled = false;
    client.publish('------------  COMPRESSOR E-STOP TRIGGERED! System shutting down to prevent damage!  ------------');
    console.log(chalk.red('COMPRESSOR E-STOP SHUTDOWN TRIGGERED! SYSTEM REVIEW REQUIRED'));
  }
}

// Update all system values to current and set the operational modes
function update() {
  // Check in on our compressor and fan motors
  motorCheckup();

  // See if we're enabled to run, then verify running operation
  if (systemEnabled) {
    // Check temp and adjust operation if needed
    if (currentDuty == 'Idle') {
      if (currentTemp > setTemp) {
        currentDuty = 'Cool';
        startTime = new Date();
        cool();
      }
      // Otherwise stay idle
      else {
        if (compressorOn) {
          shutdown(); // Sanity check in case we are not fully idle
        }
        publishReport();
      }
    }
    // Check temp and adjust operation if needed
    else if (currentDuty == 'Cool') {
      if (currentTemp <= setTemp - 2) {
        currentDuty = 'Idle';
        startTime = new Date();
        shutdown();
      }
      // Otherwise stay cooling
      else {
        if (!compressorOn) {
          cool(); // Sanity check in case we are not fully up and cooling
        }
        publishReport();
      }
    }
  }
  // System is disabled! Lets make sure that it's set correctly
  else {
    // If disabled, stay disabled and update stats
    if (currentDuty == 'OFF') {
      publishReport();
    }
    // Otherwise switch to disabled state
    else {
      currentDuty = 'OFF';
      startTime = new Date();
      shutdown();
      publishReport();
    }
  }
}

// Report our current overall system status over MQTT and refresh the LCD on the front of the AC unit
function publishReport() {
  motorCheckup();
  // Check the time spent in the current mode
  cycleTime = (new Date() - startTime);
  // Build JSON status report
  let statusJSON = {
    'Enabled': systemEnabled,
    'Task': currentDuty,
    'Runtime': cycleTime,
    'FanON': fanOn,
    'CompON': compressorOn,
    'Temp': currentTemp,
    'SetTemp': setTemp,
    'Timestamp': new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()
  };

  // Log and display the status
  console.log(statusJSON);
  updateLCD(statusJSON);
  client.publish(MQTT_CONTROL_CHANNEL, JSON.stringify(statusJSON));
}



//##################################################################
//                       Unit Relay Control
//##################################################################

// Note: High is ON, Low is OFF!
// SET THESE TO WHAT IS COMMENTED FOR THE AC!!!

function compressorStart() {
  rpio.write(COMPRESSOR_RELAY_PIN, rpio.HIGH); // Sets to HIGH (ON)
}

function compressorStop() {
  rpio.write(COMPRESSOR_RELAY_PIN, rpio.LOW); // Resets to LOW (OFF)
}

function fanStart() {
  rpio.write(FAN_RELAY_PIN, rpio.HIGH); // Sets to HIGH (ON)
}

function fanStop() {
  rpio.write(FAN_RELAY_PIN, rpio.LOW); // Resets to LOW (OFF)
}



//##################################################################
//                          LCD Control
//##################################################################

// Data is written 4 bits at a time with the lower 4 bits containing the mode.
function lcdwrite4(data) {
  rpio.i2cWrite(Buffer([(data | LCD_BACKLIGHT)]));
  rpio.i2cWrite(Buffer([(data | LCD_ENABLE | LCD_BACKLIGHT)]));
  rpio.i2cWrite(Buffer([((data & ~LCD_ENABLE) | LCD_BACKLIGHT)]));
}
function lcdwrite(data, mode) {
  lcdwrite4(mode | (data & 0xF0));
  lcdwrite4(mode | ((data << 4) & 0xF0));
}

// Write a string to the specified LCD line.
function lineout(str, addr) {
  lcdwrite(addr, 0);

  str.split('').forEach(function (c) {
    lcdwrite(c.charCodeAt(0), 1);
  });
}

// Write the status data to the LCD
function updateLCD(data) {
  rpio.i2cBegin();
  rpio.i2cSetSlaveAddress(0x27);
  rpio.i2cSetBaudRate(10000);

  for (var i = 0; i < init.length; i++)
    lcdwrite(init[i], 0);

  lineout(`Status: ${data.Task}`, LCD_LINE1);
  lineout(`For: ${msToTime(data.Runtime)}`, LCD_LINE2);
  lineout(`Current: ${data.Temp}`, LCD_LINE3);
  lineout(`Set: ${data.SetTemp}`, LCD_LINE4);

  rpio.i2cEnd();
}



//##################################################################
//                         Event Handlers
//##################################################################

// Initial "hello" to the MQTT channel
client.publish(MQTT_CONTROL_CHANNEL, `AirCon Controller Client ${MQTT_CLIENT_IDENTIFIER} is online!`);

// Listen for messages on MQTT channel and process them accordingly
client.on('message', function (topic, message) {
  if (topic == MQTT_CONTROL_CHANNEL) {
    //set temp
    if (message.toString().includes('set')) {
      setTemp = Number(message.toString().slice(message.toString().lastIndexOf('-') + 1));
      update();
    }
    //enable system
    if (message.toString() === 'on') {
      systemEnabled = true;
      currentDuty = 'Idle';
      update();
    }
    //disable system
    if (message.toString() === 'off') {
      systemEnabled = false;
      update();
    }
    //report current status
    if (message.toString() === 'status') {
      publishReport();
    }
  }
  else if (topic == MQTT_TEMPERATURE_CHANNEL) {
    currentTemp = Number(message.toString());
  }
});



//##################################################################
//                      Supporting Functions
//##################################################################

// Takes the cycle time in milliseconds and converts it to a human readable time format of hours and minutes
function msToTime(duration) {
  let milliseconds = parseInt((duration % 1000) / 100),
    seconds = Math.floor((duration / 1000) % 60),
    minutes = Math.floor((duration / (1000 * 60)) % 60),
    hours = Math.floor(duration / (1000 * 60 * 60));

  hours = (hours < 10) ? '0' + hours : hours;
  minutes = (minutes < 10) ? '0' + minutes : minutes;
  seconds = (seconds < 10) ? '0' + seconds : seconds;

  return hours + ':' + minutes;
}