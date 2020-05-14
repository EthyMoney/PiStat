let nice = "setTemp_26";
console.log(nice.slice(nice.lastIndexOf('_') + 1));

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