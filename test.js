let nice = "setTemp_26";
console.log(nice.slice(nice.lastIndexOf('_') + 1));
var Raspi = require("raspi-io").RaspiIO;

let statusJSON = {
    "System-Enabled": false,
    "Duty": "nice",
    "Current Cool Time": 0,
    "Compressor Running": false,
    "Fan Running": false,
    "Current Temp": 65,
    "Set Temp": 76
}

console.log(statusJSON.toString().includes("setTemp"))

console.log("".length)

var five = require("johnny-five");
var board = new five.Board({
    io: new Raspi()
});

board.on('ready', () => {
    var count = 0;
    var lcd = new five.LCD({
        controller: "PCF8574AT"
    });
    lcd.print("hmmmmm");
});