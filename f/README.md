# Frontend for Geospatial Analysis Application

This is a React application that provides a user interface for:
1.  Visualizing shapefiles on an interactive map.
2.  Uploading a zip file to a backend for processing by a geospatial model.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

-   Node.js
-   npm
-   Backend running on `http://localhost:5000` (refer to `b/README.md`)

### Installing

1.  **Navigate to the frontend directory:**

    ```bash
    cd f
    ```

2.  **Install the dependencies:**

    ```bash
    npm install leaflet react-leaflet shpjs leaflet-defaulticon-compatibility
    ```

### Running the Application

To start the React development server, run the following command from the `f` directory:

```bash
npm start
```

The frontend will be running at `http://localhost:3000`.

## Features

-   **Dynamic Theming:** Supports switching between light and dark themes, with all UI elements adapting their colors accordingly.
-   **Customizable Header:** Features a dynamic logo (changing with theme) and a prominent title, separated by a clear border.
-   **Centralized File Upload & Theme Toggle:** A dedicated section for uploading shapefile zip files and a button to switch themes, both centrally aligned.
-   **Single File Upload:** Allows users to upload a single zip file containing shapefiles for both map visualization and model processing.
-   **Client-Side Map Visualization:** Displays shapefiles from the uploaded zip on an interactive Leaflet map.
    -   **Automatic Map Zoom:** The map automatically zooms to fit all plotted GeoJSON layers.
    -   Supports toggling visibility of individual shapefile layers (e.g., '1991L', '1991R').
    -   Automatically fits map bounds to visible layers.
    -   Provides popups with feature attributes on click.
    -   Displays available and missing years from the uploaded zip file.
-   **Backend Model Execution:** Interacts with the backend API for geospatial processing and forecasting.
    -   **Analysis:** Sends the uploaded zip file to the `/api/process/analysis` endpoint. Allows configuration of model parameters: `spacing`, `reference_year`, `side`, `startYear`, and `endYear`.
    -   **Forecast:** Triggers the `/api/process/forecast` endpoint. Allows configuration of model parameters: `forecast_steps`, `n_years_value`, `side`, `reference_year`, `startYear`, and `endYear`.
    -   Downloads the processed output zip from the backend, named with a timestamp.
    -   Displays generated images from the backend's output.
-   **Resizable Layout:** A draggable separator allows users to adjust the width of the map and model runner components.

## Code Overview

-   **`src/App.js`**: The main application component. It manages the shared state of the uploaded zip file, theme, as well as the `availableYears` and `missingYears` states. It renders two main components side-by-side: `MapShapefileMode` for client-side visualization and `ModelRunner` for interacting with the backend model. It also handles theme switching logic and logo display based on the active theme.
-   **`src/components/LeafletMaps.js` (MapShapefileMode component)**: Handles the client-side parsing and visualization of shapefiles on a Leaflet map.
    -   Receives the uploaded zip file, `setAvailableYears`, and `setMissingYears` as props.
    -   Uses `shpjs` to parse shapefiles from the zip into GeoJSON.
    -   Allows toggling the visibility of individual shapefile layers.
    -   Renders GeoJSON layers on a `react-leaflet` map with distinct colors and popups.
    -   Includes logic to automatically fit the map view to the extent of the loaded GeoJSON layers.
-   **`src/components/ModelRunner.js`**: Manages the interaction with the backend geospatial model.
    -   Receives the uploaded zip file as a prop.
    -   Provides buttons to trigger the analysis and forecast model execution on the backend.
    -   Handles API calls to `http://localhost:5000/api/process/analysis` and `http://localhost:5000/api/process/forecast`.
    -   Processes the backend's output zip, triggering a timestamped download and displaying any generated images.
-   **`src/index.css`**: Contains global and common CSS styles that are not theme-specific.
-   **`src/themes/light-theme.css`**: Defines CSS variables and styles for the light theme.
-   **`src/themes/dark-theme.css`**: Defines CSS variables and styles for the dark theme.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.

### `npm run build`

Builds the app for production to the `build` folder.
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.
Your app is ready to be deployed!
