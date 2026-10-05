/**
 * Smart Parking System - ESP8266 NodeMCU Firmware
 * 
 * Hardware Connections:
 * - ESP8266 NodeMCU
 * - IR Sensor 1 (Slot 1)  -> D5 (GPIO 14)
 * - IR Sensor 2 (Slot 2)  -> D6 (GPIO 12)
 * - LCD 16x2 I2C SDA      -> D2 (GPIO 4)
 * - LCD 16x2 I2C SCL      -> D1 (GPIO 5)
 * - LCD I2C Address       -> 0x27 (or 0x3F)
 * - LED 1 (Slot 1 Status) -> D7 (GPIO 13) with 220-330 ohm resistor
 * - LED 2 (Slot 2 Status) -> D8 (GPIO 15) with 220-330 ohm resistor
 * 
 * Required Arduino IDE Libraries:
 * 1. ESP8266WiFi (built-in with ESP8266 core)
 * 2. ESP8266HTTPClient (built-in)
 * 3. WiFiClientSecure (built-in)
 * 4. LiquidCrystal_I2C (by Frank de Brabander or Marco Schwartz)
 * 5. ArduinoJson (v6 or v7 by Benoit Blanchon)
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

// ============================================================
// 1. CONFIGURATION: WiFi & Backend Render Server
// ============================================================
// Replace with your actual WiFi Network credentials
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace with your actual deployed Render URL or local development IP
// Example Render: "https://smart-parking-system.onrender.com"
// Example Local:  "http://192.168.1.100:3000"
const char* SERVER_URL    = "YOUR_RENDER_URL";

// ============================================================
// 2. PIN DEFINITIONS
// ============================================================
#define IR_SENSOR_1_PIN   D5   // Slot 1 IR Proximity Sensor
#define IR_SENSOR_2_PIN   D6   // Slot 2 IR Proximity Sensor
#define LED_1_PIN         D7   // Slot 1 Status LED
#define LED_2_PIN         D8   // Slot 2 Status LED

// Note on IR Sensors (FC-51 / TCRT5000):
// Standard IR obstacle sensors output LOW (0) when a vehicle/obstacle is detected,
// and HIGH (1) when the parking bay is clear.
// If your sensors are active HIGH, change this to HIGH.
#define IR_DETECTED_STATE LOW

// LCD Configuration: Address 0x27, 16 Columns, 2 Rows
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ============================================================
// 3. GLOBAL VARIABLES & TIMERS
// ============================================================
bool slot1Vehicle = false;
bool slot2Vehicle = false;

String slot1Status = "AVAILABLE";
String slot2Status = "AVAILABLE";

int totalSlots    = 2;
int availableSlots = 2;
int reservedSlots  = 0;
int occupiedSlots  = 0;

unsigned long lastServerSyncTime = 0;
const unsigned long SYNC_INTERVAL = 2000; // Synchronize with backend every 2 seconds

unsigned long lastLcdCycleTime   = 0;
const unsigned long LCD_CYCLE_INTERVAL = 3000; // Switch LCD display screen every 3 seconds
int lcdScreenState = 0;

// ============================================================
// 4. SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n\n==========================================");
  Serial.println("🚗 ESP8266 Smart Parking System Initializing");
  Serial.println("==========================================");

  // Initialize GPIO Pins
  pinMode(IR_SENSOR_1_PIN, INPUT);
  pinMode(IR_SENSOR_2_PIN, INPUT);
  pinMode(LED_1_PIN, OUTPUT);
  pinMode(LED_2_PIN, OUTPUT);

  digitalWrite(LED_1_PIN, LOW);
  digitalWrite(LED_2_PIN, LOW);

  // Initialize I2C Pins (D2=SDA, D1=SCL)
  Wire.begin(D2, D1);

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.clear();

  // Startup Screen
  // SMART PARKING
  // SYSTEM
  lcd.setCursor(1, 0);
  lcd.print("SMART PARKING");
  lcd.setCursor(5, 1);
  lcd.print("SYSTEM");
  Serial.println("[LCD] Showing Startup Screen (3s delay)");
  delay(3000);

  // Connect to WiFi
  connectToWiFi();
}

// ============================================================
// 5. WIFI CONNECTION
// ============================================================
void connectToWiFi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("CONNECTING TO");
  lcd.setCursor(0, 1);
  lcd.print("WiFi........");
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // After Connection Screen:
    // WiFi
    // CONNECTED
    lcd.setCursor(6, 0);
    lcd.print("WiFi");
    lcd.setCursor(3, 1);
    lcd.print("CONNECTED");
    delay(1500);
    lcd.clear();
  } else {
    Serial.println("\n❌ WiFi Connection Failed!");
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAILED!");
    lcd.setCursor(0, 1);
    lcd.print("Check Credentials");
    delay(2500);
    lcd.clear();
  }
}

// ============================================================
// 6. MAIN LOOP
// ============================================================
void loop() {
  // Ensure WiFi remains connected
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    return;
  }

  // 1. Read IR Sensors
  readIRSensors();

  // 2. Synchronize with Server (POST sensor data, GET updated reservations)
  if (millis() - lastServerSyncTime >= SYNC_INTERVAL) {
    lastServerSyncTime = millis();
    sendSensorUpdate();
    fetchServerStatus();
    updateLEDs();
  }

  // 3. Update LCD Display (Cycle through screens)
  if (millis() - lastLcdCycleTime >= LCD_CYCLE_INTERVAL) {
    lastLcdCycleTime = millis();
    updateLCDDisplay();
    lcdScreenState = (lcdScreenState + 1) % 3;
  }
}

// ============================================================
// 7. READ IR SENSORS
// ============================================================
void readIRSensors() {
  int read1 = digitalRead(IR_SENSOR_1_PIN);
  int read2 = digitalRead(IR_SENSOR_2_PIN);

  slot1Vehicle = (read1 == IR_DETECTED_STATE);
  slot2Vehicle = (read2 == IR_DETECTED_STATE);
}

// ============================================================
// 8. SEND SENSOR DATA (POST /api/parking/update)
// ============================================================
void sendSensorUpdate() {
  if (String(SERVER_URL).indexOf("YOUR_RENDER_URL") != -1) {
    Serial.println("⚠️ Please configure SERVER_URL with your actual Render URL!");
    return;
  }

  String endpoint = String(SERVER_URL) + "/api/parking/update";

  // Build JSON Payload
  // {
  //   "slot1": { "vehicleDetected": true/false },
  //   "slot2": { "vehicleDetected": true/false }
  // }
  StaticJsonDocument<200> doc;
  JsonObject s1 = doc.createNestedObject("slot1");
  s1["vehicleDetected"] = slot1Vehicle;
  JsonObject s2 = doc.createNestedObject("slot2");
  s2["vehicleDetected"] = slot2Vehicle;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  // Send HTTP/HTTPS Request
  if (endpoint.startsWith("https://")) {
    WiFiClientSecure client;
    client.setInsecure(); // Bypass SSL certificate verification for Render
    HTTPClient https;
    if (https.begin(client, endpoint)) {
      https.addHeader("Content-Type", "application/json");
      https.addHeader("User-Agent", "ESP8266-SmartParking");
      int httpCode = https.POST(jsonPayload);
      if (httpCode > 0) {
        String response = https.getString();
        // Serial.printf("[POST update] Code: %d\n", httpCode);
      } else {
        Serial.printf("[POST update] Error: %s\n", https.errorToString(httpCode).c_str());
      }
      https.end();
    }
  } else {
    WiFiClient client;
    HTTPClient http;
    if (http.begin(client, endpoint)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("User-Agent", "ESP8266-SmartParking");
      int httpCode = http.POST(jsonPayload);
      if (httpCode > 0) {
        String response = http.getString();
      } else {
        Serial.printf("[POST update] Error: %s\n", http.errorToString(httpCode).c_str());
      }
      http.end();
    }
  }
}

// ============================================================
// 9. FETCH PARKING STATUS & RESERVATIONS (GET /api/parking/status)
// ============================================================
void fetchServerStatus() {
  if (String(SERVER_URL).indexOf("YOUR_RENDER_URL") != -1) {
    return;
  }

  String endpoint = String(SERVER_URL) + "/api/parking/status?source=esp8266";

  String response = "";
  int httpCode = 0;

  if (endpoint.startsWith("https://")) {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient https;
    if (https.begin(client, endpoint)) {
      https.addHeader("User-Agent", "ESP8266-SmartParking");
      httpCode = https.GET();
      if (httpCode == HTTP_CODE_OK) {
        response = https.getString();
      }
      https.end();
    }
  } else {
    WiFiClient client;
    HTTPClient http;
    if (http.begin(client, endpoint)) {
      http.addHeader("User-Agent", "ESP8266-SmartParking");
      httpCode = http.GET();
      if (httpCode == HTTP_CODE_OK) {
        response = http.getString();
      }
      http.end();
    }
  }

  if (httpCode == HTTP_CODE_OK && response.length() > 0) {
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, response);
    if (!error) {
      totalSlots     = doc["totalSlots"] | 2;
      availableSlots = doc["availableSlots"] | 0;
      reservedSlots  = doc["reservedSlots"] | 0;
      occupiedSlots  = doc["occupiedSlots"] | 0;

      const char* s1 = doc["slots"]["slot1"]["status"];
      const char* s2 = doc["slots"]["slot2"]["status"];

      if (s1) {
        slot1Status = String(s1);
        slot1Status.toUpperCase();
      }
      if (s2) {
        slot2Status = String(s2);
        slot2Status.toUpperCase();
      }
    }
  }
}

// ============================================================
// 10. UPDATE LED HARDWARE OUTPUT
// ============================================================
void updateLEDs() {
  // Basic Hardware Requirement:
  // LED ON  -> Slot is occupied or reserved
  // LED OFF -> Slot is available
  if (slot1Status == "OCCUPIED" || slot1Status == "RESERVED") {
    digitalWrite(LED_1_PIN, HIGH);
  } else {
    digitalWrite(LED_1_PIN, LOW);
  }

  if (slot2Status == "OCCUPIED" || slot2Status == "RESERVED") {
    digitalWrite(LED_2_PIN, HIGH);
  } else {
    digitalWrite(LED_2_PIN, LOW);
  }
}

// ============================================================
// 11. UPDATE LCD 16x2 DISPLAY (Cycles through information)
// ============================================================
void updateLCDDisplay() {
  lcd.clear();

  switch (lcdScreenState) {
    case 0:
      // Screen 1: Individual Slot Status
      // S1: AVAILABLE / RESERVED / OCCUPIED
      // S2: AVAILABLE / RESERVED / OCCUPIED
      lcd.setCursor(0, 0);
      lcd.print("S1: ");
      lcd.print(slot1Status.substring(0, 12));

      lcd.setCursor(0, 1);
      lcd.print("S2: ");
      lcd.print(slot2Status.substring(0, 12));
      break;

    case 1:
      // Screen 2: Total & Available
      // TOTAL: 2
      // AVAIL: 1
      lcd.setCursor(0, 0);
      lcd.print("TOTAL: ");
      lcd.print(totalSlots);

      lcd.setCursor(0, 1);
      lcd.print("AVAIL: ");
      lcd.print(availableSlots);
      break;

    case 2:
      // Screen 3: Reserved & Occupied
      // RES: 0
      // OCC: 1
      lcd.setCursor(0, 0);
      lcd.print("RES: ");
      lcd.print(reservedSlots);

      lcd.setCursor(0, 1);
      lcd.print("OCC: ");
      lcd.print(occupiedSlots);
      break;
  }
}
