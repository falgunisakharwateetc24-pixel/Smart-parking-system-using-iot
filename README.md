# 🚗 Smart Parking System (IoT + Web Application)

A complete IoT and cloud-integrated Smart Parking System built with **ESP8266 (NodeMCU)**, **Node.js & Express**, **SQLite**, and a **modern purple-themed web dashboard**. Fully deployable on **Render** with real-time vehicle detection, online/offline status monitoring, slot reservation, 16x2 I2C LCD display, and LED indicators.

---

## 📁 Project Folder Structure

```text
Smart-Parking-System/
│
├── server.js               # Node.js + Express backend & REST APIs
├── package.json            # Node.js dependencies & scripts
├── render.yaml             # Render Blueprint configuration
├── parking.db              # SQLite database (auto-created on first run)
├── .gitignore              # Git ignore rules
│
├── public/                 # Frontend Web Application (Render Static)
│   ├── index.html          # Page 1: Modern Purple Login & Register Page
│   ├── dashboard.html      # Page 2: Purple Dashboard with 3 Tabs & Visualizer
│   ├── style.css           # Purple theme stylesheet, light/dark mode & animations
│   └── script.js           # Client-side real-time polling (1.5s) & state management
│
├── esp8266/                # Microcontroller Firmware
│   └── smart_parking.ino   # Complete Arduino C++ sketch for NodeMCU ESP8266
│
└── README.md               # Complete setup, wiring, and deployment documentation
```

---

## 🔌 Hardware Components & Wiring

### 1. Components Required
- **NodeMCU ESP8266** (ESP-12E Module)
- **2 × IR Proximity Sensors** (FC-51 / TCRT5000)
- **16×2 LCD Display** with **I2C Backpack** (PCF8574, default address `0x27`)
- **2 × LEDs** (Slot 1 & Slot 2 indicators)
- **2 × Resistors** (220Ω to 330Ω)
- **Breadboard & Jumper Wires** (Male-to-Female, Male-to-Male)
- **Micro-USB Cable**

### 2. Complete Pinout Table

| Component | Pin / Terminal | NodeMCU ESP8266 Pin | GPIO | Function / Notes |
|---|---|---|---|---|
| **IR Sensor 1** | OUT / Data | **D5** | GPIO 14 | Parking Slot 1 Detection |
| **IR Sensor 1** | VCC | **3V3** or **VIN** | - | Power (3.3V or 5V) |
| **IR Sensor 1** | GND | **GND** | - | Ground |
| **IR Sensor 2** | OUT / Data | **D6** | GPIO 12 | Parking Slot 2 Detection |
| **IR Sensor 2** | VCC | **3V3** or **VIN** | - | Power (3.3V or 5V) |
| **IR Sensor 2** | GND | **GND** | - | Ground |
| **16×2 LCD I2C** | SDA | **D2** | GPIO 4 | I2C Serial Data |
| **16×2 LCD I2C** | SCL | **D1** | GPIO 5 | I2C Serial Clock |
| **16×2 LCD I2C** | VCC | **VIN** (5V) | - | Power (5V recommended for bright display) |
| **16×2 LCD I2C** | GND | **GND** | - | Ground |
| **LED 1** | Anode (+) | **D7** | GPIO 13 | Slot 1 Status (via 220Ω resistor) |
| **LED 1** | Cathode (-) | **GND** | - | Ground |
| **LED 2** | Anode (+) | **D8** | GPIO 15 | Slot 2 Status (via 220Ω resistor) |
| **LED 2** | Cathode (-) | **GND** | - | Ground |

> [!NOTE]
> Most IR obstacle sensors output **LOW (0)** when a vehicle is detected, and **HIGH (1)** when clear. Adjust the small potentiometer on each IR sensor module so the onboard detection LED turns ON when an obstacle is within 3–8 cm.

---

## 🚦 System Status & Business Logic

The system distinguishes between **physical vehicle detection** (IR sensors) and **website reservations**:

| Physical Vehicle Detected | Website Reserved | Calculated Slot Status | Hardware LED (D7 / D8) | Web Dashboard Badge |
|---|---|---|---|---|
| **No** | **No** | **AVAILABLE** | **OFF** | 🟢 AVAILABLE |
| **No** | **Yes** | **RESERVED** | **ON** | 🟡 RESERVED |
| **Yes** | **No** | **OCCUPIED** | **ON** | 🔴 OCCUPIED |
| **Yes** | **Yes** | **OCCUPIED** | **ON** | 🔴 OCCUPIED |

- If a user reserves a slot from the website and later drives a car into that bay, the status automatically switches to **OCCUPIED** while preserving reservation history in SQLite.
- Only **AVAILABLE** slots can be reserved by users.

---

## 💻 Local Quick Start (VS Code)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)

### Steps to Run
1. Open this project directory in VS Code or your terminal:
   ```bash
   cd "Smart-Parking-System"
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open your browser and navigate to:
   ```text
   http://localhost:3000
   ```
5. You can log in using the pre-seeded demo account:
   - **Email:** `demo@parking.com`
   - **Password:** `password123`
   *(Or click "Register" to create your own account)*

---

## 🌐 Render Deployment Steps (Free Web Service)

This application is ready for direct deployment on Render:

1. **Push Code to GitHub:**
   - Create a new repository on [GitHub](https://github.com).
   - Push this workspace to your GitHub repository:
     ```bash
     git init
     git add .
     git commit -m "Initial commit of Smart Parking System"
     git branch -M main
     git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
     git push -u origin main
     ```

2. **Deploy on Render:**
   - Log in to your [Render Dashboard](https://dashboard.render.com).
   - Click **New +** and select **Web Service**.
   - Connect your GitHub repository.
   - Configure the following settings:
     - **Name:** `smart-parking-system` (or your choice)
     - **Region:** Choose the region nearest to you (e.g., Singapore, Frankfurt, Oregon)
     - **Branch:** `main`
     - **Runtime:** `Node`
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Instance Type:** `Free`
   - Click **Create Web Service**.

3. **Obtain your Render Live URL:**
   - Once deployed, Render will provide a live URL such as:
     ```text
     https://smart-parking-system.onrender.com
     ```
   - The application serves both the **Frontend UI** and the **REST APIs** from this single URL.

---

## 📡 ESP8266 Setup & Flashing Guide

1. **Install Arduino IDE:**
   - Download and open [Arduino IDE](https://www.arduino.cc/en/software).
2. **Add ESP8266 Board Support:**
   - Go to `File > Preferences`.
   - In "Additional Boards Manager URLs", add:
     ```text
     http://arduino.esp8266.com/stable/package_esp8266com_index.json
     ```
   - Go to `Tools > Board > Boards Manager...`, search for `esp8266`, and click **Install**.
3. **Install Required Libraries:**
   - Go to `Sketch > Include Library > Manage Libraries...`:
     - **LiquidCrystal_I2C** (by Frank de Brabander)
     - **ArduinoJson** (by Benoit Blanchon, v6 or v7)
4. **Configure Arduino Sketch:**
   - Open `esp8266/smart_parking.ino` in Arduino IDE.
   - Update your WiFi credentials:
     ```cpp
     const char* WIFI_SSID     = "YOUR_WIFI_NAME";
     const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
     ```
   - Set your Render URL (or your local IP for offline testing):
     ```cpp
     const char* SERVER_URL    = "https://smart-parking-system.onrender.com";
     ```
5. **Select Board & Port:**
   - `Tools > Board > ESP8266 Boards > NodeMCU 1.0 (ESP-12E Module)`
   - `Tools > Upload Speed > 115200`
   - `Tools > Port > (Select your NodeMCU COM port)`
6. **Upload:**
   - Click the **Upload (➔)** button.
   - Watch the Serial Monitor at `115200 baud`.

---

## 📺 16×2 LCD Display Sequence

The LCD cycles every 3 seconds to keep drivers informed:

1. **Startup (3 sec):**
   ```text
   SMART PARKING
       SYSTEM
   ```
2. **WiFi Connection:**
   ```text
   CONNECTING TO
   WiFi........
   ```
   Followed by:
   ```text
        WiFi
      CONNECTED
   ```
3. **Cycle Screen 1 (Bays Status):**
   ```text
   S1: AVAILABLE
   S2: OCCUPIED
   ```
4. **Cycle Screen 2 (Totals):**
   ```text
   TOTAL: 2
   AVAIL: 1
   ```
5. **Cycle Screen 3 (Reservation / Occupancy):**
   ```text
   RES: 0
   OCC: 1
   ```

---

## 🛠️ REST API Reference

### 1. Sensor Update (ESP8266 → Server)
- **Endpoint:** `POST /api/parking/update`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "slot1": { "vehicleDetected": true },
    "slot2": { "vehicleDetected": false }
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "totalSlots": 2,
    "availableSlots": 1,
    "reservedSlots": 0,
    "occupiedSlots": 1,
    "slots": {
      "slot1": { "status": "occupied", "reserved": false, "vehicleDetected": true, "led": "ON" },
      "slot2": { "status": "available", "reserved": false, "vehicleDetected": false, "led": "OFF" }
    }
  }
  ```

### 2. Status & Reservation Query (Server → ESP8266 & Web Dashboard)
- **Endpoint:** `GET /api/parking/status`
- **Response:**
  ```json
  {
    "totalSlots": 2,
    "availableSlots": 1,
    "reservedSlots": 1,
    "occupiedSlots": 0,
    "espOnline": true,
    "slots": {
      "slot1": { "status": "reserved", "reserved": true, "vehicleDetected": false, "led": "ON" },
      "slot2": { "status": "available", "reserved": false, "vehicleDetected": false, "led": "OFF" }
    }
  }
  ```

### 3. Reserve Slot (Website → Server)
- **Endpoint:** `POST /api/parking/reserve`
- **Request Body:**
  ```json
  {
    "slot": 1
  }
  ```
- **Responses:**
  - Success: `200 OK` `{ "success": true, "message": "Reservation Successful" }`
  - If Occupied: `400 Bad Request` `{ "success": false, "message": "Slot Occupied" }`
  - If Already Reserved: `400 Bad Request` `{ "success": false, "message": "Slot Already Reserved" }`

### 4. Cancel Reservation (Website → Server)
- **Endpoint:** `POST /api/parking/cancel`
- **Request Body:**
  ```json
  {
    "slot": 1
  }
  ```
- **Response:** `200 OK` `{ "success": true, "message": "Reservation Cancelled" }`

---

## 🎨 Theme & Accessibility
- **Primary Color:** `#7C3AED` (Royal Purple)
- **Dark Mode:** Deep purple & frosted glass aesthetic
- **Status Badges:** 
  - 🟢 Green (`#10B981`) for Available
  - 🟡 Amber (`#F59E0B`) for Reserved
  - 🔴 Crimson (`#EF4444`) for Occupied
- **Timezone:** Formatted according to **Indian Standard Time (`Asia/Kolkata`, UTC+5:30)**.
