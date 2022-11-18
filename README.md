# PiStat
Bringing modern thermostat control to an ancient air conditioning unit.
 
## Description:
This is a super basic Node.js control program designed to be run right on a Raspberry Pi to control a window air conditioning unit using GPIO and relays to run the 2 core components, the compressor and fan. There is a simple control interface and support for status output to a 20x4 i2c LCD screen. Communication of command input and status reports is done over MQTT which makes communication with other programs and services super easy! This is so simple that it will work with pretty much any AC unit since they all have the same 2 primary components (compressor and fan), but this is mostly intended to be used with the old machines that operate with mechanical controls rather the fancy new microcontroller stuff you see these days.
<br><br>
The core electronics used for this new system is two high-amperage relays that are switched on and off by the GPIO of the Raspberry Pi, a temperature sensor or method of getting the room temperature, and that's it! Optionally you can add an LCD screen if you want something showing directly on the unit, code for a 20x4 i2c screen is in this program already. You need to wire up your relays and Pi in your AC unit to take over electrical control of the compressor and fan. This may mean completely gutting and replacing the current existing control circuitry in your unit. You will also need 5v DC power for your Pi and potentially the relays (depending on what you have), which can be accomplished by installing a small power supply and tapping its input into the mains wiring of the unit. Please understand that rewiring and retrofit could be very dangerous and should not be attempted without a proper understanding of mains AC power and potential hazards that come with it, such as electrical shock from the mains power or run capacitor. PLEASE be careful! Get help from an electrician or someone more familiar with mains power if you don't know what you are doing.
<br><br>
To get started, simply edit the main.js file at the top to have your own MQTT broker endpoint, MQTT channels, and the pin numbers you plugged your relays into on the Raspberry Pi. After that, you can use whatever method you prefer to interface with it and send commands. Being over MQTT, you can write your own apps in whatever flavor you desire and simply communicate over the MQTT channels. There is also status objects posted regularly over the channels that you can receive and log or display in your own apps or tools. Have fun with it, or do something simple to make it work, up to you :)
<br>

## Install/Setup

Make sure you have the latest Node.js LTS version installed before proceeding! This project has been tested with v16 and v18
 
+ Step 1: Clone to your Raspberry Pi 1/2/3/4/Zero/CM (they should all work)
 
+ Step 2: Install pigpio<br>
 ```sudo apt install pigpio -y```
 
+ Step 3: Install npm packages (cd into project folder first)<br>
 ```sudo npm i```

+ Step 4: Run it!<br>
```sudo node main.js```  (sudo is required so that rpio can access /dev/mem)

<br>

## DISCLAIMER:
While I have integrated many safety and reliability features, done extensive testing, and personally run this program, I absolutely 
DO NOT guarantee that it will be safe to use and work properly. Use of this program is done at your own risk, and you take full responsibility for
any issues and damages that you may encounter under any circumstance. There is no warranty or liability from me for anything that you do because of attempting to build this project or use this program at all. 
<br><br>With that said, I do still greatly appreciate feedback for any issues you find or
improvement suggestions that you may have. Please feel free to report issues on this GitHub repo or reach out to me directly.
Finally, if you use this program and enjoy it, please consider starring my GitHub repo to show support! I know this isn't the most
amazing or complex piece of software you've ever seen, but I really hope it helps improve your life even if it's just a little bit!
