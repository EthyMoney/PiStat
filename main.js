/*
 /$$$$$$$  /$$        /$$$$$$  /$$                  /$$$$$$                            /$$ /$$   /$$     /$$
| $$__  $$|__/       /$$__  $$|__/                 /$$__  $$                          | $$|__/  | $$    |__/
| $$  \ $$ /$$      | $$  \ $$ /$$  /$$$$$$       | $$  \__/  /$$$$$$  /$$$$$$$   /$$$$$$$ /$$ /$$$$$$   /$$  /$$$$$$  /$$$$$$$   /$$$$$$   /$$$$$$
| $$$$$$$/| $$      | $$$$$$$$| $$ /$$__  $$      | $$       /$$__  $$| $$__  $$ /$$__  $$| $$|_  $$_/  | $$ /$$__  $$| $$__  $$ /$$__  $$ /$$__  $$
| $$____/ | $$      | $$__  $$| $$| $$  \__/      | $$      | $$  \ $$| $$  \ $$| $$  | $$| $$  | $$    | $$| $$  \ $$| $$  \ $$| $$$$$$$$| $$  \__/
| $$      | $$      | $$  | $$| $$| $$            | $$    $$| $$  | $$| $$  | $$| $$  | $$| $$  | $$ /$$| $$| $$  | $$| $$  | $$| $$_____/| $$
| $$      | $$      | $$  | $$| $$| $$            |  $$$$$$/|  $$$$$$/| $$  | $$|  $$$$$$$| $$  |  $$$$/| $$|  $$$$$$/| $$  | $$|  $$$$$$$| $$
|__/      |__/      |__/  |__/|__/|__/             \______/  \______/ |__/  |__/ \_______/|__/   \___/  |__/ \______/ |__/  |__/ \_______/|__/


Description:

-This is a control program designed to be run right on a Raspberry Pi to control a window air conditioning unit using GPIO and relays.
It's super simple and to the point. There a basic control interface and support for status output to a 20x4 i2c LCD.
-This program receives command input and reports statuses over MQTT which makes communication with other programs and services super easy!
-This program features the ability to control the two main components of an any air conditioner: the compressor, and the fan.
-Because this program takes full control of the 2 primary components of an AC unit, it can be used to control nearly ANY air conditioner!
-Control over these 2 parts is done using two high-aperage relays that are switched on and off by the GPIO of the Raspberry Pi.
-You need to wire up your relays and Pi in your AC unit to take control of the compressor and fan. This may mean completely gutting and 
replacing the current existing control circuitry in your unit. Please understand that this could be dangerous, and should not be attempted
without a proper understanding of mains AC power and potential hazards such as electrical shock from the run capacitor. PLEASE be careful!
-To get started, Included with this program is a pre-made Windows application that enables communication and control from any PC! Simply
set your MQTT broker address and channel that you want to use, and you are good to go! The Windows app has all that you need to get up and 
running. You can see basic and detailed statistics, as well as set the modes and temperatures that you desire.
-Feel free to add to the experience! Thanks to MQTT, there are many other ways to communicate with this program as well as plenty of
flexability for expansion of features and interation! I've provided all the basic data and controls that you need, go ahead and run with it :)


*** DISCLAIMER: ***
While I have integrated many safety and reliability features, done extensive testing, and personally run this program, I absolutely 
CANNOT guarantee that it is perfect and problem-free. Use of this program is done at your own risk and you take full responsibility for
any issues and damages that you may encounter. With that said, I do still greatly appreciate feedback for any issues you find or
improvement suggestions that you may have. Please feel free to report issues on the GitHub repo or reach out to me directly.

Finally, if you use this program and enjoy it, please consider starring my GitHub repo to show support! I know this isn't the most
amazing or complex piece of software you've ever seen, but I really hope it helps improve your life even if it's just a little bit!


Author: Logan (GitHub: YoloSwagDogDiggity)
Version: 1.0.0b (InDev)
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
let startTime = new Date(); //start counting the cycle time

// Setup of program variables
let MQTTchannel = "pi9_aircon";
let MQTTchannel_temp = "pi9_aircon/temp";
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

// Configure the LCD output (20 columns by 4 rows)
var init = new Buffer([0x03, 0x03, 0x03, 0x02, 0x28, 0x0c, 0x01, 0x06]);
var LCD_LINE1 = 0x80, LCD_LINE2 = 0xc0; LCD_LINE3 = 0x94; LCD_LINE4 = 0xD4;
var LCD_ENABLE = 0x04, LCD_BACKLIGHT = 0x08;

// Connect to MQTT broker and start listening on the control channel
client.on('connect', function () {
    client.subscribe([MQTTchannel, MQTTchannel_temp], function (err) {
        if (err) {
            console.log(err);
        }
    });
});

// Set the system updater to run on a schedule of every 3 minutes
var statusScheduler = schedule.scheduleJob('*/3 * * * *', update);
// Update once right away at startup
update();
// Report that we are ready for action!
console.log(`AirCon Client ${clientID} is running and listening for commands! :)`);




//##################################################################
//                     Unit Control Management
//##################################################################

// Perform an elegant startup of the unit
async function cool() {
    //start the fan first
    fanStart();
    publishReport();
    //start compressor after fan has spun up
    setTimeout(function () {
        motorCheckup();
        //make sure the fan is on AND the current status hasn't been changed back to idle/off while we waited
        if (fanOn) {
            compressorStart();
            publishReport();
        }
    }, 15000); //15sec delay
}

// Perform an elegant shutdown of the unit
async function shutdown() {
    //stop the compressor first
    compressorStop();
    publishReport();
    //stop the fan after coil defrost delay
    setTimeout(function () {
        motorCheckup();
        //make sure the current status hasn't been changed back to cooling while we waited
        if (!compressorOn) {
            fanStop();
            publishReport();
        }
    }, 180000); //3min defrost
}

// Retrieve the status of the relays to know what our motors are doing
function motorCheckup() {
    compressorOn = rpio.read(compressorRelay) ? true : false;
    fanOn = rpio.read(fanRelay) ? true : false;

    // Emergency compressor safety (prevents compressor from running without airflow from the fan)
    if (compressorOn && !fanOn) {
        compressorStop();
        systemEnabled = false;
        client.publish("------------  COMPRESSOR E-STOP TRIGGERED! System shutting down to prevent damage!  ------------");
        console.log(chalk.red("COMPRESSOR E-STOP SHUTDOWN TRIGGERED! SYSTEM REVIEW REQUIRED"));
    }
}

// Update all system values to current and set the operational modes
function update() {
    // Check in on our compressor and fan motors
    motorCheckup();

    // See if we're enabled to run, then verify running operation
    if (systemEnabled) {
        // Check temp and adjust operation if needed
        if (currentDuty == "Idle") {
            if (currentTemp > setTemp) {
                currentDuty = "Cool";
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
        else if (currentDuty == "Cool") {
            if (currentTemp <= setTemp - 2) {
                currentDuty = "Idle";
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
        if (currentDuty == "OFF") {
            publishReport();
        }
        // Otherwise switch to disabled state
        else {
            currentDuty = "OFF";
            startTime = new Date();
            shutdown();
            publishReport();
        }
    }
}

// Report our current overall system status and refresh the LCD values
function publishReport() {
    motorCheckup();
    // Check the time spent in the current mode
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
// SET THESE TO WHAT IS COMMENTED FOR THE AC!!!

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
client.publish(MQTTchannel, `AirCon Controller Client ${clientID} is online!`);

// Listen for messages on MQTT channel and process them accordingly
client.on('message', function (topic, message) {
    if (topic == MQTTchannel) {
        //set temp
        if (message.toString().includes("set")) {
            setTemp = Number(message.toString().slice(message.toString().lastIndexOf('-') + 1));
            update();
        }
        //enable system
        if (message.toString() === "on") {
            systemEnabled = true;
            currentDuty = "Idle";
            update();
        }
        //disable system
        if (message.toString() === "off") {
            systemEnabled = false;
            update();
        }
        //report current status
        if (message.toString() === "status") {
            publishReport();
        }
    }
    else if (topic == MQTTchannel_temp) {
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

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;

    return hours + ":" + minutes;
}