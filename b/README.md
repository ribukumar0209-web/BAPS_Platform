# Backend API for Geospatial Analysis

This backend is a Flask application designed to receive a zip file containing shapefiles, process them using a geospatial model, and return the results, including images and logs.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

-   Python 3.x
-   pip

### Installing

1.  **Create a virtual environment:**

    It is recommended to use a virtual environment to manage the project's dependencies. From the `b` directory, run:

    ```bash
    python -m venv venv
    ```

2.  **Activate the virtual environment:**

    -   On **macOS and Linux**:

        ```bash
        source venv/bin/activate
        ```

    -   On **Windows**:

        ```bash
        .\venv\Scripts\activate
        ```

3.  **Install the dependencies:**

    With the virtual environment activated, install the required packages from `requirements.txt`:

    ```bash
    pip install -r requirements.txt
    ```

### Running the Application

To start the Flask development server, run the following command from the `b` directory:

```bash
python app.py
```

The backend will be running at `http://127.0.0.1:5000`.

## API Endpoints

### `/api/process/analysis`

-   **Method:** `POST`
-   **Description:** Receives a zip file containing shapefiles, runs the geospatial analysis model, and returns a zip file with the generated images, output files, and logs.
-   **Form Data:**
    -   `zipfile`: The zip file containing the shapefiles to be processed.
    -   `spacing` (integer, optional): The spacing value for transects. Default is 10000.
    -   `reference_year` (integer, optional): The reference year for shift calculation. Default is 1991.
    -   `side` (string, optional): The side of the river to analyze ('L' for left, 'R' for right, or 'both'). Default is 'both'.
    -   `startYear` (integer, optional): The start year for analysis.
    -   `endYear` (integer, optional): The end year for analysis.
-   **Success Response:**
    -   **Code:** 200
    -   **Content:** A zip file named `analysis_output.zip` containing the `images` and `output` folders, `stdout.txt` (model's standard output), and `stderr.txt` (model's standard error).
-   **Error Response:**
    -   **Code:** 200 (always returns a zip file)
    -   **Content:** A zip file named `analysis_output.zip` containing `error.txt` (error message), `stdout.txt`, and `stderr.txt`.

### `/api/process/forecast`

-   **Method:** `POST`
-   **Description:** Runs the geospatial forecast model based on previously analyzed data and returns a zip file with the generated images, output files, and logs. This endpoint assumes that the `/api/process/analysis` has been run previously to generate the necessary input files.
-   **Form Data:**
    -   `forecast_steps` (integer, optional): Number of years to forecast. Default is 2.
    -   `n_years_value` (integer, optional): Number of years to use for the ARIMA model. Default is 10.
    -   `side` (string, optional): The side of the river to analyze ('L' or 'R'). Default is 'R'.
    -   `reference_year` (integer, optional): The reference year for shift calculation. Default is 1991.
    -   `startYear` (integer, optional): The start year for analysis.
    -   `endYear` (integer, optional): The end year for analysis.
-   **Success Response:**
    -   **Code:** 200
    -   **Content:** A zip file named `forecast_output.zip` containing the `images` and `output` folders, `stdout.txt` (model's standard output), and `stderr.txt` (model's standard error).
-   **Error Response:**
    -   **Code:** 200 (always returns a zip file)
    -   **Content:** A zip file named `forecast_output.zip` containing `error.txt` (error message), `stdout.txt`, and `stderr.txt`.

## Code Overview

-   **`app.py`**: The main Flask application file.
    -   It defines the `/api/process/analysis` and `/api/process/forecast` endpoints.
    -   It handles the creation, cleanup, and processing of directories (`input`, `output`, `images`, `uploads`) for each request.
    -   It runs the `model/model.py` script to perform the geospatial analysis and forecasting.
    -   It packages the `output` and `images` folders, along with the model's `stdout` and `stderr`, into a zip file and returns it.
-   **`model/model.py`**: The script that contains the core geospatial processing logic.
    -   It reads shapefiles from the `input` directory.
    -   It performs calculations and generates new shapefiles in the `output` directory and images in the `images` directory.