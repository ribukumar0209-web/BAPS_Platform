# BAPS Platform (Bankline Analysis & Prediction System)

An integrated WebGIS platform for river bankline migration analysis, erosion-accretion assessment, and automated geospatial forecasting.

---

## 🌟 Overview

The **Bankline Analysis & Prediction System (BAPS)** enables hydrologists, geomorphologists, and geospatial researchers to analyze multi-temporal river banklines and forecast future river migration dynamics. 

### Key Capabilities:
- **Interactive Geospatial Visualization**: Inspect multi-year bankline shapefiles (`.shp`), transects, and regions of interest (ROI) dynamically on an interactive Leaflet map.
- **Geomorphological Shift Analysis**: Calculate sequential and reference-year shifts, erosion/accretion rates, Linear Regression Rates (LRR), and end-point rates along generated transects.
- **Machine Learning & Time-Series Forecasting**: Forecast future bankline positions using ARIMA models and polynomial curve fitting.
- **Full-Stack Modular Architecture**: Decoupled Python/Flask computational engine and modern React frontend.

---

## 🏗️ Project Architecture

```
BAPS_Platform/
├── b/                     # Backend API & Geospatial Modeling Engine
│   ├── app.py             # Flask application & REST API endpoints
│   ├── model/             # Core geomorphological & forecasting algorithms
│   │   └── model.py       # Transect generation, shift analysis, and ARIMA forecast
│   ├── patch_*.py         # Hotfixes & feature patches
│   ├── react_dist/        # Pre-built React bundle served directly by Flask
│   ├── requirements.txt   # Python dependencies
│   └── README.md          # Backend specific documentation
├── f/                     # Frontend WebGIS User Interface (React)
│   ├── public/            # Static assets & HTML template
│   ├── src/               # React components, hooks, styles, and themes
│   │   ├── components/    # Leaflet maps, ModelRunner, ShapefileParser
│   │   ├── themes/        # Light & dark theme definitions
│   │   ├── App.js         # Main application controller
│   │   └── index.js       # App entrypoint
│   ├── package.json       # Node.js dependencies & scripts
│   └── README.md          # Frontend specific documentation
└── README.md              # Root project overview
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Python**: 3.10+ recommended
- **Node.js**: 18+ and npm (optional for running standalone React dev server)

---

### 2. Backend Setup (`b`)

1. Navigate to the backend directory:
   ```bash
   cd b
   ```

2. Create and activate a virtual environment:
   ```bash
   # Windows
   python -m venv venv
   .\venv\Scripts\activate

   # Linux / macOS
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the backend server:
   ```bash
   python app.py
   ```
   The backend will be running at `http://127.0.0.1:5000`.

---

### 3. Frontend Setup (`f`)

> **Note:** The Flask backend already bundles `b/react_dist/`, so visiting `http://localhost:5000` serves the application out of the box! If you want to develop or modify the frontend, follow the steps below:

1. Navigate to the frontend directory:
   ```bash
   cd f
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```
   The development frontend will open at `http://localhost:3000`.

---

## 📡 API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/process/analysis` | `POST` | Upload shapefile `.zip`, compute transect shifts & geomorphological metrics. |
| `/api/process/forecast` | `POST` | Execute ARIMA time-series modeling to project future bankline positions. |

---

## 📄 License

This project is licensed under the terms specified in the project repository.
