import machine
import utime
import umqtt.simple
import onewire, ds18x20
import network
import gc
import ujson

# Constants
MQTT_CLIENT_IDENTIFIER = 'pico_aircon-shop'
FAN_RELAY_PIN = 15  # update these pins according to your setup
COMPRESSOR_RELAY_PIN = 16
MQTT_CONTROL_CHANNEL = 'home/shop/aircon'
MQTT_TEMPERATURE_CHANNEL = MQTT_CONTROL_CHANNEL + '/temp'
MQTT_BROKER = 'set your broker IP here'
COMPRESSOR_MIN_OFF_TIME = 5 * 60 * 1000  # 5 minutes
TEMP_SENSOR_PIN = 22  # update this pin according to your setup
DEVICE_ID = '289511132e190125'  # update this, make sure the ID matches your sensor (temp sensor)
WIFI_SSID = "changeme"
WIFI_PASSWORD = "changeme2"

# Setup WiFi
wlan = network.WLAN(network.STA_IF)
wlan.active(True)

# Setup pins
fan_relay = machine.Pin(FAN_RELAY_PIN, machine.Pin.OUT)
compressor_relay = machine.Pin(COMPRESSOR_RELAY_PIN, machine.Pin.OUT)
ds_pin = machine.Pin(TEMP_SENSOR_PIN)
ds_sensor = ds18x20.DS18X20(onewire.OneWire(ds_pin))

# Onboard LED access
led = machine.Pin("LED", machine.Pin.OUT)
led_state = False

# Turn LED on solid at startup to indicate we are powered up
led.on()

# Create a Timer instance
timer = machine.Timer()

# Variables
current_temp = 70
set_temp = 76
compressor_on = False
fan_on = False
system_enabled = False
current_duty = 'OFF'
start_time = utime.ticks_ms()
compressor_last_off_time = -COMPRESSOR_MIN_OFF_TIME
mqtt_connected = False
wifi_connected = False
duty_changed = False

def connect_to_wifi():
    global wifi_connected
    if not wlan.isconnected():
        print("connecting to network...")
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        while not wlan.isconnected():
            utime.sleep(5)
            wlan.connect(WIFI_SSID, WIFI_PASSWORD)
    print("network config:", wlan.ifconfig())
    wifi_connected = wlan.isconnected()
    print("WiFi connection status: ", wifi_connected)

# MQTT Setup
client = umqtt.simple.MQTTClient(MQTT_CLIENT_IDENTIFIER, MQTT_BROKER)

def sub_cb(topic, msg):
    global set_temp, system_enabled, current_duty
    topic = topic.decode()
    msg = msg.decode()
    #print("Received MQTT message: ", topic, msg)

    # Call update whenever a new temperature or enable state is set
    # This would ensure that if the system is on, it immediately
    # evaluates whether it needs to change its duty based on the new set temperature
    # NOTE: Makes sure that cool cycle starts properly if the set temp is lowered enough to the start
    # threshold while the system is off, and then enabled from that state
    # I was seeing the fan start but compressor never would in this situation without this call

    if topic == MQTT_CONTROL_CHANNEL:
        if msg == 'on':
            system_enabled = True
            current_duty = 'Idle'
            print("System enabled")
            update()
            publish_report()
        elif msg == 'off':
            system_enabled = False
            print("System disabled")
            publish_report()
        elif msg == 'status':
            print("System status report requested")
            publish_report()
        elif msg.startswith('set-'):
            try:
                set_temp = float(msg.split('-')[1])
                print("Set temperature updated to: ", set_temp)
                update()
                publish_report()
            except (IndexError, ValueError):
                print("Error parsing set-temperature command")
    gc.collect()

client.set_callback(sub_cb)

# Function to connect to the MQTT broker
def connect_to_broker():
    global mqtt_connected
    try:
        if(wlan.isconnected() == False):
            connect_to_wifi()
        gc.collect()
        client.connect()
        # Publish an initial off message to the control channel to ensure the system is off on startup
        client.publish(MQTT_CONTROL_CHANNEL, 'off', retain=True)  # 'retain=True' will mark this message as retained
        print("Published initial off message")
        client.subscribe(MQTT_CONTROL_CHANNEL)
        mqtt_connected = True
        print("Connected to MQTT broker")
    except Exception as e:
        print("Could not connect to MQTT broker: ", e)
        mqtt_connected = False
        return False
    return True

# Function to be called when the timer delay finishes
def timer_callback_cool(t):
    # make sure the system is still enabled before starting the compressor and we are in "Cool" mode'
    if system_enabled and current_duty == 'Cool':
      compressor_start()

# Function to be called when the timer delay finishes
def timer_callback_shutdown(t):
    fan_stop()

def toggle_led():
    global led, led_state
    if led_state:
        led.off()
        led_state = False
    else:
        led.on()
        led_state = True

# Try connecting to the MQTT server
while not connect_to_broker():
    print("Trying to reconnect to MQTT broker...")
    utime.sleep(5)

# Functions to start/stop the fan and compressor
def fan_start():
    fan_relay.value(1)
    global fan_on
    fan_on = True
    print("Fan started")

def fan_stop():
    fan_relay.value(0)
    global fan_on
    fan_on = False
    print("Fan stopped")

def compressor_start():
    global compressor_last_off_time, compressor_on

    if utime.ticks_diff(utime.ticks_ms(), compressor_last_off_time) > COMPRESSOR_MIN_OFF_TIME:
        compressor_relay.value(1)
        compressor_on = True
        print("Compressor started")

def compressor_stop():
    global compressor_last_off_time, compressor_on

    compressor_relay.value(0)
    compressor_last_off_time = utime.ticks_ms()
    compressor_on = False
    print("Compressor stopped")

# Function to update status
def update():
    global fan_on, compressor_on, system_enabled, start_time, current_duty, current_temp, set_temp, client, duty_changed

    previous_duty = current_duty  # Save the previous duty state

    if system_enabled:
        if current_duty == 'Idle':
            if current_temp > set_temp + .5:
                current_duty = 'Cool'
                start_time = utime.ticks_ms()
                print("Starting cooling cycle")
                cool()
        elif current_duty == 'Cool':
            if current_temp <= set_temp - 2:
                current_duty = 'Idle'
                start_time = utime.ticks_ms()
                print("Stopping cooling cycle")
                shutdown()
    else:
        if current_duty != 'OFF':
            current_duty = 'OFF'
            start_time = utime.ticks_ms()
            print("System shutdown")
            shutdown()

    # If the duty state has changed, set the flag to True (to publish the status report on changes)
    if previous_duty != current_duty:
        duty_changed = True

def check_incoming():
    global client, mqtt_connected
    if not mqtt_connected:
        connect_to_broker()
    if not mqtt_connected:
        return
    try:
        client.check_msg()
    except OSError:
        mqtt_connected = False

last_published_report = None

def publish_report():
    global client, current_temp, set_temp, fan_on, compressor_on, current_duty, mqtt_connected, last_published_report

    if not mqtt_connected:
        connect_to_broker()
    if not mqtt_connected:
        return

    try:
        # Prepare the data to be published as a JSON object
        report = {
            "Enabled": system_enabled,
            "Temp": current_temp,
            "SetTemp": set_temp,
            "FanON": fan_on,
            "CompON": compressor_on,
            "Task": current_duty,
            "Timestamp": utime.ticks_ms(), # this is the uptime in ms of the pico since it was powered on
            "Runtime": utime.ticks_diff(utime.ticks_ms(), start_time) # how long it's been in its current state (in ms, Idle, Cool, or OFF)
        }
        
        if report != last_published_report:  # Only publish if there's a change
            # Convert the JSON object into a string and publish it
            client.publish(MQTT_CONTROL_CHANNEL, ujson.dumps(report))
            last_published_report = report  # Update the last published report

        gc.collect() # clean up around here
    except OSError:
        mqtt_connected = False

# Function to cool
def cool():
    fan_start()
    # Start the timer to wait a moment before starting the compressor
    timer.init(period=10000, mode=machine.Timer.ONE_SHOT, callback=timer_callback_cool)

# Function to shutdown
def shutdown():
    # if fan is on and compressor is off, stop the fan (compressor never ran, we shut down before it started)
    if fan_on and not compressor_on:
        fan_stop()
    else:
      compressor_stop()
      # Start the timer to allow fan to run for a few minutes before shutting down
      timer.init(period=180000, mode=machine.Timer.ONE_SHOT, callback=timer_callback_shutdown)

# --------------------------------------------------
#  Temperature sensor reading and MQTT publishing
# --------------------------------------------------

# Function to read temperature from sensor and publish it to the MQTT channel
def report_temp(first_run=False):
    global current_temp
    try:
        roms = ds_sensor.scan()
        ds_sensor.convert_temp()
        utime.sleep_ms(750)
        for rom in roms:
            if first_run:
              print('Found temp sensor device ID:', rom.hex())
            if rom.hex() == DEVICE_ID:
                if first_run:
                  print('Configured device matches!:', rom.hex())
                temp = ds_sensor.read_temp(rom)
                if temp is not None:
                    temp_f = c_to_f(temp)
                    current_temp = round(float(temp_f), 1)  # Update current temp locally for the main loop control, rounded to 1 decimal place
                    try:
                        client.publish(MQTT_TEMPERATURE_CHANNEL, str(current_temp)) # Publish temp to MQTT for external use (like the wall thermostat and web/windows app)
                        gc.collect()
                        #print("Published temperature: ", current_temp)
                    except OSError:
                        # Try to reconnect to the MQTT broker
                        while not connect_to_broker():
                            print("Trying to reconnect to MQTT broker...")
                            utime.sleep(5)
                    if first_run:
                        print('DS18B20 Temp:', current_temp)
    except Exception as e:
        print("Error reading temperature: ", e)

def c_to_f(temp_c):
    return temp_c * 9.0 / 5 + 32

# Initial temperature report
report_temp(first_run=True)
last_published_report = {
    "Enabled": system_enabled,
    "Temp": current_temp,
    "SetTemp": set_temp,
    "FanON": fan_on,
    "CompON": compressor_on,
    "Task": current_duty,
    "Timestamp": utime.ticks_ms(),
    "Runtime": utime.ticks_diff(utime.ticks_ms(), start_time) # how long it's been in its current state (in ms, Idle, Cool, or OFF)
}

loop_counter = 0
temp_report_interval = 120  # report temperature every 120 * .5 seconds (1 minute)
status_report_interval = 60  # report status every 60 * .5 seconds (30 seconds)

# Main Loop
while True:
    # Blink the onboard LED to indicate the system is running
    toggle_led()
    update()
    check_incoming()

    if loop_counter % temp_report_interval == 0:
        report_temp()

    if loop_counter % status_report_interval == 0 or duty_changed:
        publish_report()
        duty_changed = False  # Reset the flag
      
    utime.sleep(.5)
    loop_counter += 1
