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

// IMPORTANT!! This defines the client ID number of the program. Set this number for whatever unique pi you put this program onto.
let clientID = 9;

// IMPORTANT!! These define the pinouts to use for whatever devices you have. Not all of these have to be used, just set the
// ones you will use with your particuluar client.
let fanRelay = 23;
let compressorRelay = 24;

// System runtime values
let currentTemp = 70; //needs to get set by sensor
let setTemp = 76; //default
let compressorOn = false;
let fanOn = false;
let cycleTime = 0;
let systemEnabled = false;
let currentDuty = 'Off';
let coolCommandRunning = false;
let shutdownCommandRunning = false;

/* IMPORTANT!! This value defines the MQTT channel to listen and publish to. It can be a string of your choosing, but make sure 
it matches your other devices so everything is on the same channel to communicate. WARNING: This channel can be listened 
and published to by anyone that knows what it is. Be sure to keep this value private if your application controls sensitive
devices in your use case. Makes for a pretty fun prank to play on a buddy tho ;) */
let MQTTchannel = "pi9_aircon";

// This will wait for data that never comes, which keeps this process from terminating.
process.stdin.resume();

var schedule = require('node-schedule');
var rpio = require('rpio');
rpio.init({ gpiomem: true });   // You may need to switch this to the devmem pool when using PWM and i2c
rpio.init({ mapping: 'gpio' });

var mqtt = require('mqtt')
var client = mqtt.connect('mqtt://192.168.1.55')

// Connect to local MQTT broker and start listening for commands.
client.on('connect', function () {
    client.subscribe([MQTTchannel], function (err) {
        if (err) {
            console.log(err);
        }
    })
})

// Set the status checker to run on a schedule
var statusScheduler = schedule.scheduleJob('*/5 * * * *', updateStatus());



//##################################################################
//                     Unit Control Management
//##################################################################

async function cool() {
    coolCommandRunning = true;
    //start the fan first
    fanStart();
    //start compressor after fan has spun up
    setTimeout(function () {
        compressorStart();
    }, 15000); //15sec delay
    coolCommandRunning = false;
}

async function shutdown() {
    shutdownCommandRunning = true;
    //stop the compressor first
    compressorStop();
    //stop the fan after coil defrost delay
    setTimeout(function () {
        fanStop();
    }, 180000); //3min defrost
    shutdownCommandRunning = false;
}

function updateStatus() {
    // Update all system values to current
    currentTemp; // = getTempNow();
    compressorOn = rpio.read(compressorRelay) ? true : false;
    fanOn = rpio.read(fanRelay) ? true : false;

    // Run any necessary tasks based on this new info
    if (!systemEnabled && compressorOn && fanOn && !shutdownCommandRunning) {
        shutdown();
    }
    if (!systemEnabled && compressorOn) {
        compressorStop(); // Safety check so compressor doesn't get left on without the fan
    }
    if (systemEnabled && (currentTemp >= setTemp + 1) && !(currentDuty=="Cooling" || coolCommandRunning)) {
        cool();
    }
    if (systemEnabled && (currentTemp <= setTemp - 2) && !(currentDuty=="Defrosting" || shutdownCommandRunning)) {
        shutdown();
    }

    // Update the operational status
    setTimeout(function () {
        if ((systemEnabled && fanOn && compressorOn) || coolCommandRunning) {
            currentDuty = "Cooling";
        }
        else if ((systemEnabled && fanOn && !compressorOn) || shutdownCommandRunning) {
            currentDuty = "Defrosting";
        }
        else if (systemEnabled && !fanOn && !compressorOn) {
            currentDuty = "Idle";
        }
        else {
            currentDuty = "Off";
        }
    }, 600)

    // Build JSON status report
    let statusJSON = {
        "System-Enabled": systemEnabled,
        "Duty": currentDuty,
        "Current Cool Time": cycleTime,
        "Compressor Running": compressorOn,
        "Fan Running": fanOn,
        "Current Temp": currentTemp,
        "Set Temp": setTemp,
        "Cool Command Processing": coolCommandRunning,
        "Shutdown command processing": shutdownCommandRunning
    }

    // Log the status
    // updateLCD(statusJSON);
    console.log(statusJSON);
    client.publish(MQTTchannel, JSON.stringify(statusJSON));
}



//##################################################################
//                       Unit Relay Control
//##################################################################

// Note: High is ON, Low is OFF!

function compressorStart() {
    rpio.open(compressorRelay, rpio.OUTPUT, rpio.HIGH); // Sets to HIGH (ON)
}

function compressorStop() {
    rpio.close(compressorRelay, rpio.PIN_RESET); // Resets to LOW (OFF)
}

function fanStart() {
    rpio.open(fanRelay, rpio.OUTPUT, rpio.HIGH); // Sets to HIGH (ON)
}

function fanStop() {
    rpio.close(fanRelay, rpio.PIN_RESET); // Resets to LOW (OFF)
}



//##################################################################
//                          LCD Control
//##################################################################

// Coming soon!!



//##################################################################
//                         Event Handlers
//##################################################################

console.log(`Client ${clientID} is running and listening for commands! :)`);
client.publish(MQTTchannel, `Client ${clientID} is online!`);

// For client listening to command publisher: 
client.on('message', function (topic, message) {
    // message is Buffer
    console.log("Incoming command message: " + message.toString())
    if (message.toString().includes("setTemp")) {
        setTemp = message.slice(message.lastIndexOf('_') + 1);
        updateStatus();
    }
    if (message.toString() === "ON") {
        systemEnabled = true;
        updateStatus();
    }
    if (message.toString() === "OFF") {
        systemEnabled = false;
        updateStatus();
    }
    if (message.toString() === "status") {
        updateStatus();
    }
    if (message.toString() === "COOL") {
        cool();
        updateStatus();
    }
    if (message.toString() === "STOP") {
        shutdown();
        updateStatus();
    }
})



//##################################################################
//                      Supporting Functions
//##################################################################

// These will be here to help complete other tasks or provide validations and testing before running a command.

// TO-DO:
function validateLCDText(message) {
    // Check a message for being of right length and format prior to sending to the LCD to display. (for a 20x4 char LCD)
}

