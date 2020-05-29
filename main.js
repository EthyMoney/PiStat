/*
 /$$$$$$$ /$$       /$$$$$$$                    /$$                         /$$   /$$           /$$    
| $$__  $|__/      | $$__  $$                  |__/                        | $$$ | $$          | $$    
| $$  \ $$/$$      | $$  \ $$ /$$$$$$ /$$    /$$/$$ /$$$$$$$ /$$$$$$       | $$$$| $$ /$$$$$$ /$$$$$$  
| $$$$$$$| $$      | $$  | $$/$$__  $|  $$  /$$| $$/$$_____//$$__  $$      | $$ $$ $$/$$__  $|_  $$_/  
| $$____/| $$      | $$  | $| $$$$$$$$\  $$/$$/| $| $$     | $$$$$$$$      | $$  $$$| $$$$$$$$ | $$    
| $$     | $$      | $$  | $| $$_____/ \  $$$/ | $| $$     | $$_____/      | $$\  $$| $$_____/ | $$ /$$
| $$     | $$      | $$$$$$$|  $$$$$$$  \  $/  | $|  $$$$$$|  $$$$$$$      | $$ \  $|  $$$$$$$ |  $$$$/
|__/     |__/      |_______/ \_______/   \_/   |__/\_______/\_______/      |__/  \__/\_______/  \___/     ------> AirCon Client


Description: My personal tool to control my LEDs and stuff. This program will have the end goal of communicating
with other rPis around my room and managing the flow of commands between them to control devices. For now, this program
is being used to directly test control of devices, and will later be adapted to pass on this control to other rPis.

*** This file is the client that run on the Pis that are distibuted around the home and will listen to commands
from the main host Pi over MQTT. This file is meant to be rather generic so it can be dropped onto any pi and simply
change the client #, and then add or remove whatever specific functionality you want that pi to support.


Author: Logan (YoloSwagDogDiggity)
Version: 1.0.0 (InDev)
Started: 5/13/2020
*/



//##################################################################
//                     Setup and Declarations
//##################################################################

// Instance values
let clientID = 9;
let fanRelay = 23;
let compressorRelay = 24;

// System runtime values
let currentTemp = 70; //needs to get set by sensor
let setTemp = 76; //default
let compressorOn = false;
let fanOn = false;
let cycleTime = '';
let systemEnabled = false;
let currentDuty = 'OFF';
let startTime = new Date();

// Setup service veriables
let MQTTchannel = "pi9_aircon";
let chalk = require('chalk');
var mqtt = require('mqtt');
var client = mqtt.connect('mqtt://192.168.1.28');
var schedule = require('node-schedule');
var rpio = require('rpio');
rpio.init({ gpiomem: false });
rpio.init({ mapping: 'gpio' });

// Configure the relay gpio pins
rpio.open(fanRelay, rpio.OUTPUT);
rpio.open(compressorRelay, rpio.OUTPUT);

// Configure the LCD output
var init = new Buffer([0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06]);
var LCD_LINE1 = 0x80, LCD_LINE2 = 0xc0; LCD_LINE3 = 0x94; LCD_LINE4 = 0xD4;
var LCD_ENABLE = 0x04, LCD_BACKLIGHT = 0x08;

// Connect to local MQTT broker and start listening for commands
client.on('connect', function () {
    client.subscribe([MQTTchannel], function (err) {
        if (err) {
            console.log(err);
        }
    });
});

// Set the status checker to run on a schedule
var statusScheduler = schedule.scheduleJob('*/3 * * * *', update);
// Update once right away at startup
update();
console.log(`AirCon Client ${clientID} is running and listening for commands! :)`);




//##################################################################
//                     Unit Control Management
//##################################################################

async function cool() {
    //start the fan first
    fanStart();
    publishReport();
    //start compressor after fan has spun up
    setTimeout(function () {
        motorCheckup();
        if(fanOn){
            compressorStart();
            publishReport();
        }
    }, 15000); //15sec delay
}

async function shutdown() {
    //stop the compressor first
    compressorStop();
    publishReport();
    //stop the fan after coil defrost delay
    setTimeout(function () {
        motorCheckup();
        if(!compressorOn){
            fanStop();
            publishReport();
        }
    }, 180000); //3min defrost
}

function motorCheckup() {
    compressorOn = rpio.read(compressorRelay) ? true : false;
    fanOn = rpio.read(fanRelay) ? true : false;

    // Compressor safety
    if (compressorOn && !fanOn) {
        compressorStop();
        systemEnabled = false;
        client.publish("------------  COMPRESSOR E-STOP TRIGGERED! System shutting down to prevent damage!  ------------");
        console.log(chalk.red("COMPRESSOR E-STOP SHUTDOWN TRIGGERED! SYSTEM REVIEW REQUIRED"));
    }
}


function update() {
    // Update all system values to current
    //currentTemp; // = getTempNow();

    // Check on our motors
    motorCheckup();

    if (systemEnabled) {
        if (currentDuty == "Idle") {
            if (currentTemp > setTemp) {
                currentDuty = "Cool";
                startTime = new Date();
                cool();
            }
            // Otherwise stay idle
            else {
                publishReport();
            }
        }
        else if (currentDuty == "Cool") {
            if (currentTemp <= setTemp - 2) {
                currentDuty = "Idle";
                startTime = new Date();
                shutdown();
            }
            // Otherwise stay idle
            else {
                publishReport();
            }
        }
    }
    // Kill the system if disabled and not already killed
    else {
        if (currentDuty == "OFF") {
            publishReport();
        }
        else {
            currentDuty = "OFF";
            startTime = new Date();
            shutdown();
            publishReport();
        }
    }
}


function publishReport() {
    motorCheckup();
    // Check our time in current mode
    cycleTime = (new Date() - startTime);
    // Build JSON status report
    let statusJSON = {
        "Enabled": systemEnabled,
        'Task': currentDuty,
        "Runtime": cycleTime,
        "FanON": fanOn,
        "CompON": compressorOn,
        "Temp": currentTemp,
        "SetTemp": setTemp,
        "Timestamp": new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString()
    };

    // Log and display the status
    console.log(statusJSON);
    updateLCD(statusJSON);
    client.publish(MQTTchannel, JSON.stringify(statusJSON));
}




//##################################################################
//                       Unit Relay Control
//##################################################################

// Note: High is ON, Low is OFF!


//////////////////////////////////// SET THESE TO WHAT IS COMMENTED FOR THE AC!!! ///////////////////////////////////


function compressorStart() {
    rpio.write(compressorRelay, rpio.HIGH); // Sets to HIGH (ON)
}

function compressorStop() {
    rpio.write(compressorRelay, rpio.LOW); // Resets to LOW (OFF)
}

function fanStart() {
    rpio.write(fanRelay, rpio.HIGH); // Sets to HIGH (ON)
}

function fanStop() {
    rpio.write(fanRelay, rpio.LOW); // Resets to LOW (OFF)
}




//##################################################################
//                          LCD Control
//##################################################################

/*
 * Data is written 4 bits at a time with the lower 4 bits containing the mode.
 */
function lcdwrite4(data) {
    rpio.i2cWrite(Buffer([(data | LCD_BACKLIGHT)]));
    rpio.i2cWrite(Buffer([(data | LCD_ENABLE | LCD_BACKLIGHT)]));
    rpio.i2cWrite(Buffer([((data & ~LCD_ENABLE) | LCD_BACKLIGHT)]));
}
function lcdwrite(data, mode) {
    lcdwrite4(mode | (data & 0xF0));
    lcdwrite4(mode | ((data << 4) & 0xF0));
}

/*
 * Write a string to the specified LCD line.
 */
function lineout(str, addr) {
    lcdwrite(addr, 0);

    str.split('').forEach(function (c) {
        lcdwrite(c.charCodeAt(0), 1);
    });
}

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

client.publish(MQTTchannel, `AirCon Client ${clientID} is online!`);

// For client listening to command publisher: 
client.on('message', function (topic, message) {
    //console.log("Incoming command message: " + message.toString())
    if (message.toString().includes("set")) {
        setTemp = Number(message.toString().slice(message.toString().lastIndexOf('-') + 1));
        update();
    }
    if (message.toString() === "on") {
        systemEnabled = true;
        currentDuty = "Idle";
        update();
    }
    if (message.toString() === "off") {
        systemEnabled = false;
        update();
    }
    if (message.toString() === "status") {
        publishReport();
    }
    if (message.toString() === "cool") {
        cool();
        update();
    }
    if (message.toString() === "stop") {
        shutdown();
        update();
    }
});




//##################################################################
//                      Supporting Functions
//##################################################################

// These will be here to help complete other tasks or provide validations and testing before running a command.

// TO-DO:
function validateLCDText(message) {
    // Check a message for being of right length and format prior to sending to the LCD to display. (for a 20x4 char LCD)
}

function msToTime(duration) {
    var milliseconds = parseInt((duration % 1000) / 100),
        seconds = Math.floor((duration / 1000) % 60),
        minutes = Math.floor((duration / (1000 * 60)) % 60),
        hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;

    return hours + ":" + minutes;
}