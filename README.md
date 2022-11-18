# PiStat
 A modern control system for an ancient air conditioning unit.
 
 
## Install/Setup

Make sure you have the latest Node.js LTS version installed before proceeding! This project has been tested with v16 and v18
 
+ Step 1: Clone to your Raspberry Pi 1/2/3/4/Zero/CM (they should all work)
 
+ Step 2: Install pigpio<br>
 ```sudo apt install pigpio -y```
 
+ Step 3: Install npm packages (cd into project folder first)<br>
 ```sudo npm i```

+ Step 4: Run it!<br>
```sudo node main.js```  (sudo is required so that rpio can access /dev/mem)
