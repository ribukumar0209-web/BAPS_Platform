from flask import Flask, request, jsonify, Response, send_file, send_from_directory
import re
from flask_cors import CORS
import os
import sys

# Windows DLL workaround for Conda environments (fix for rasterio/fiona/GDAL)
if os.name == 'nt':
    import sys
    if hasattr(sys, '_MEIPASS'):
        try:
            os.add_dll_directory(sys._MEIPASS)
        except Exception:
            pass
    else:
        conda_base = os.path.dirname(sys.executable)
        bin_path = os.path.join(conda_base, 'Library', 'bin')
        if os.path.exists(bin_path):
            try:
                os.add_dll_directory(bin_path)
            except Exception:
                pass

import shutil
import zipfile
import webbrowser
import threading
import logging
import io
import contextlib
from pathlib import Path
import geopandas as gpd
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import multiprocessing
import openpyxl

# Import functions from model.py
from model.model import (
    process_river_folder,
    calculate_shift_filled,
    generate_historical_statistics,
    plot_shift_vs_year,
    predict_shifts_parallel_safe,
    form_map
)

def resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)

app = Flask(__name__, static_folder=resource_path("react_dist"), static_url_path="/")
CORS(app)

class LogCatcher:
    def __init__(self):
        self.logs = []
        self.terminal = sys.__stdout__
    def write(self, message):
        self.terminal.write(message)
        if message.strip():
            self.logs.append(message.strip())
    def flush(self):
        self.terminal.flush()
    def clear(self):
        self.logs = []

log_catcher = LogCatcher()
sys.stdout = log_catcher

@app.route('/api/status', methods=['GET'])
def get_status():
    images = []
    if os.path.exists('images'):
        images = [f"/api/images/{f}" for f in os.listdir('images') if f.endswith(('.png', '.jpg'))]
    
    output_state = 0
    for d in ['output', 'input']:
        if os.path.exists(d):
            for f in os.listdir(d):
                p = os.path.join(d, f)
                if os.path.isfile(p):
                    output_state += os.path.getsize(p) + os.path.getmtime(p)

    return {"logs": log_catcher.logs, "images": images, "output_state": output_state}

@app.route('/api/images/<filename>')
def serve_image(filename):
    return send_from_directory('images', filename)

@app.route('/api/current_zip', methods=['GET'])
def get_current_zip():
    import io
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
        if os.path.exists('output'):
            zip_directory('output', zipf, exclude_exts=['.shp', '.shx', '.dbf', '.prj', '.cpg'])
        if os.path.exists('images'):
            zip_directory('images', zipf)
        if os.path.exists('input'):
            zip_directory('input', zipf, exclude_exts=['.shp', '.shx', '.dbf', '.prj', '.cpg'])
    memory_file.seek(0)
    return Response(memory_file, mimetype='application/zip')

# --- Utility functions ---
def zip_directory(path, zip_handler, exclude_exts=None, exclude_patterns=None, include_patterns=None):
    if exclude_exts is None: exclude_exts = []
    if exclude_patterns is None: exclude_patterns = []
    for root, dirs, files in os.walk(path):
        for file in files:
            if any(file.endswith(ext) for ext in exclude_exts):
                continue
            if any(pattern in file for pattern in exclude_patterns):
                continue
            if include_patterns and not any(pattern in file for pattern in include_patterns):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, path)
            zip_handler.write(full_path, arcname=rel_path)


def robust_remove(path):
    if os.path.exists(path):
        if os.path.isdir(path):
            for _ in range(5):
                try:
                    shutil.rmtree(path)
                    return
                except Exception:
                    time.sleep(0.2)
            if os.path.exists(path):
                shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except:
                pass

def cleanup(paths):
    for p in paths:
        robust_remove(p)

def extract_zip_to_folder(zip_file, folder):
    with zipfile.ZipFile(zip_file, 'r') as zip_ref:
        for member in zip_ref.namelist():
            filename = os.path.basename(member)
            if filename:
                with zip_ref.open(member) as source:
                    target_path = os.path.join(folder, filename)
                    with open(target_path, "wb") as target:
                        shutil.copyfileobj(source, target)


import time
import json

# Store the last used analysis side globally for the stats endpoint
_last_analysis_side = "R"

def force_clear_dir(path):
    if os.path.exists(path):
        for _ in range(5):
            try:
                shutil.rmtree(path)
                break
            except Exception:
                time.sleep(0.2)
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path, exist_ok=True)


# --- API routes ---
@app.route('/api/clear', methods=['POST'])
def clear_cache():
    dirs_to_clear = ['uploads', 'input', 'output', 'images', 'roi', 'clipped_input']
    for d in dirs_to_clear:
        force_clear_dir(d)
    log_catcher.clear()
    return {"message": "Cache cleared successfully"}

@app.route('/api/clear-outputs', methods=['POST'])
def clear_outputs():
    """Wipe only output artefacts (output/ and images/) before a new analysis run.
    Keeps input/ intact so cached shift data for the other bank side is preserved."""
    for d in ['output', 'images']:
        force_clear_dir(d)
    log_catcher.clear()
    return {"message": "Output artefacts cleared"}

@app.route('/api/process/generate_transects', methods=['POST'])
def process_generate_transects():
    log_catcher.clear()
    uploads_dir, input_dir = 'uploads', 'input'
    for p in [uploads_dir, input_dir]:
        robust_remove(p)
        if not os.path.exists(p):
            os.makedirs(p, exist_ok=True)

    if 'zipfile' not in request.files:
        return {"error": "No zipfile part in the request"}, 400

    file = request.files['zipfile']
    uploaded_filepath = os.path.join(uploads_dir, file.filename)
    file.save(uploaded_filepath)
    extract_zip_to_folder(uploaded_filepath, input_dir)

    side = request.form.get('side', 'L')
    spacing = int(request.form.get('spacing', 100))
    transect_length = int(request.form.get('transect_length', 8000))
    smoothing_distance = 4000

    import glob
    import re
    files = glob.glob(os.path.join(input_dir, "*.shp"))
    for f in files:
        basename = os.path.basename(f).lower()
        is_left = re.search(r'(^|[_ 0-9-])(l|left)([_ -]|\.shp$)', basename) is not None
        is_right = re.search(r'(^|[_ 0-9-])(r|right)([_ -]|\.shp$)', basename) is not None
        
        should_remove = False
        if side == 'L' and is_right and not is_left:
            should_remove = True
        elif side == 'R' and is_left and not is_right:
            should_remove = True
            
        if should_remove:
            base_no_ext = os.path.splitext(f)[0]
            for ext in ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx']:
                to_remove = base_no_ext + ext
                if os.path.exists(to_remove):
                    try:
                        os.remove(to_remove)
                    except Exception:
                        pass

    try:
        from model.model import generate_transects_from_banklines
        import geopandas as gpd
        print("??? Generating Transects from historical banklines...")
        transects_gdf = generate_transects_from_banklines(input_dir,
                                                          spacing=spacing,
                                                          transect_length=transect_length,
                                                          smoothing_distance=smoothing_distance)
        target_crs = transects_gdf.crs
        transects_gdf.crs = target_crs

        out_gdf = gpd.GeoDataFrame({'transect_id': transects_gdf['transect_id']}, geometry=transects_gdf.geometry, crs=target_crs)
        transects_out_file = os.path.join(input_dir, f"transects_{side}.shp")
        out_gdf.to_file(transects_out_file)
        
        output_zip_path = os.path.join(uploads_dir, 'transects.zip')
        with zipfile.ZipFile(output_zip_path, 'w') as zipf:
            zip_directory(input_dir, zipf, include_patterns=['transect'])
            
        def generate():
            with open(output_zip_path, 'rb') as f:
                yield from f

        return Response(generate(), mimetype='application/zip', headers={"Content-Disposition": f"attachment;filename=transects_{side}.zip"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}, 500

@app.route('/api/process/analysis', methods=['POST'])
def process_analysis():
    log_catcher.clear()
    uploads_dir, input_dir, output_dir, images_dir = 'uploads', 'input', 'output', 'images'
    roi_dir = 'roi'
    clipped_dir = 'clipped_input'
    for d in [uploads_dir, input_dir, output_dir, images_dir, roi_dir, clipped_dir]:
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    if 'zipfile' not in request.files:
        return {"error": "No zipfile part in the request"}, 400

    file = request.files['zipfile']
    if file.filename == '' or not file.filename.endswith('.zip'):
        return {"error": "Invalid file type, please upload a .zip file"}, 400

    uploaded_filepath = os.path.join(uploads_dir, file.filename)
    file.save(uploaded_filepath)
    extract_zip_to_folder(uploaded_filepath, input_dir)

    if 'transects_zipfile' in request.files:
        tz_file = request.files['transects_zipfile']
        if tz_file.filename != '':
            tz_filepath = os.path.join(uploads_dir, 'transects_upload.zip')
            tz_file.save(tz_filepath)
            extract_zip_to_folder(tz_filepath, input_dir)


    analysis_mode = request.form.get('analysis_mode', 'full')
    working_input_dir = input_dir

    if analysis_mode in ['upload', 'draw']:
        roi_gdf = None
        if analysis_mode == 'upload':
            if 'roi_zipfile' not in request.files:
                return {"error": "ROI zipfile missing"}, 400
            roi_file = request.files['roi_zipfile']
            roi_filepath = os.path.join(uploads_dir, roi_file.filename)
            roi_file.save(roi_filepath)
            extract_zip_to_folder(roi_filepath, roi_dir)
            roi_shp = [f for f in os.listdir(roi_dir) if f.endswith('.shp')]
            if roi_shp:
                roi_gdf = gpd.read_file(os.path.join(roi_dir, roi_shp[0]))
        elif analysis_mode == 'draw':
            roi_geojson = request.form.get('roi_geojson')
            if roi_geojson:
                roi_path = os.path.join(roi_dir, 'roi.geojson')
                with open(roi_path, 'w') as f:
                    f.write(roi_geojson)
                roi_gdf = gpd.read_file(roi_path)
        
        if roi_gdf is not None:
            print("Step 0: Clipping banklines to ROI...")
            
            # If roi_gdf lacks a CRS (e.g. from drawn GeoJSON), assume it's WGS84 (lat/lon)
            if not roi_gdf.crs:
                roi_gdf.set_crs('EPSG:4326', inplace=True)
                
            for f in os.listdir(input_dir):
                if f.endswith('.shp'):
                    if f.lower() in ['transects.shp', 'centerline.shp']:
                        print(f"Skipping {f} to regenerate it for the clipped region later.")
                        continue
                    try:
                        gdf = gpd.read_file(os.path.join(input_dir, f))
                        
                        # Match ROI CRS to the current shapefile's CRS
                        current_roi = roi_gdf.copy()
                        if current_roi.crs and gdf.crs and current_roi.crs != gdf.crs:
                            current_roi = current_roi.to_crs(gdf.crs)
                            
                        clipped = gpd.clip(gdf, current_roi)
                        if not clipped.empty:
                            clipped.to_file(os.path.join(clipped_dir, f))
                        else:
                            print(f"Warning: {f} is empty after clipping.")
                    except Exception as e:
                        print(f"Error clipping {f}: {e}")
            
            if os.path.exists('original_input'):
                robust_remove('original_input')
            
            # Safely backup and replace without relying on renaming the locked folder
            import shutil
            try:
                shutil.copytree(input_dir, 'original_input')
            except Exception:
                pass
            
            robust_remove(input_dir)
            os.makedirs(input_dir, exist_ok=True)
            for file_name in os.listdir(clipped_dir):
                source_file = os.path.join(clipped_dir, file_name)
                dest_file = os.path.join(input_dir, file_name)
                try:
                    shutil.move(source_file, dest_file)
                except Exception:
                    shutil.copy(source_file, dest_file)

    spacing = int(request.form.get('spacing', 10000))
    reference_year = int(request.form.get('reference_year', 1991))
    transect_length = int(request.form.get('transect_length', 10000))
    smoothing_distance = int(request.form.get('smoothing_distance', 4000))

    global _last_analysis_side
    side = request.form.get('side', 'both')
    _last_analysis_side = side

    startYear = request.form.get('startYear', None)
    endYear = request.form.get('endYear', None)
    startYear = int(startYear) if startYear else None
    endYear = int(endYear) if endYear else None

    if side in ['L', 'R']:
        opposite = 'R' if side == 'L' else 'L'
        for f in os.listdir(input_dir):
            if f.endswith('.shp') and not f.lower() in ['centerline.shp', 'transects.shp']:
                lower_f = f.lower()
                is_opposite_bank = re.search(f"(^|[_ 0-9-])({opposite.lower()}|{'left' if opposite == 'L' else 'right'})([_ -]|\.shp$)", lower_f) is not None
                if is_opposite_bank:
                    for ext in ['.shp', '.shx', '.dbf', '.prj', '.cpg', '.geojson']:
                        f_ext = f.replace('.shp', ext)
                        if os.path.exists(os.path.join(input_dir, f_ext)):
                            robust_remove(os.path.join(input_dir, f_ext))

    # ── Step 1: Build/verify banklines and transects ───────────────────────────
    # First, verify if any data for this side is available in the uploaded folder
    side_files_exist = any(f.endswith(f"{side}.shp") for f in os.listdir(input_dir))
    unsplit_files_exist = any(f.endswith(".shp") and not (f.endswith("L.shp") or f.endswith("R.shp") or "transect" in f or "centerline" in f) for f in os.listdir(input_dir))

    if not side_files_exist and not unsplit_files_exist:
        return {"error": f"There is no data available for the {side} side in the uploaded folder."}, 400

    # If transects_{side}.shp already exists AND there are bankline shapefiles
    # for this side (e.g. 1991R.shp, 2000R.shp …), the user has pre-supplied
    # everything process_river_folder would generate — skip it entirely.
    _possible_transects = list(Path(input_dir).glob(f"*transect*_{side}.shp")) + list(Path(input_dir).glob(f"*transect*{side}.shp")) + list(Path(input_dir).glob("*transect*.shp"))
    _transects_side_shp = str(_possible_transects[0]) if _possible_transects else None
    _banklines_exist = any(f.endswith(f'{side}.shp') for f in os.listdir(input_dir) if "transect" not in f.lower() and "centerline" not in f.lower())

    if analysis_mode == 'full' and _transects_side_shp and os.path.exists(_transects_side_shp) and _banklines_exist:
        print(f"Step 1: {os.path.basename(_transects_side_shp)} and {side} banklines found – skipping river-folder processing.")
        folder = input_dir   # downstream code uses 'folder' only for the copy step below
    else:
        print("Step 1: Processing river folder…")
        folder = process_river_folder(input_dir, spacing=spacing, transect_length=transect_length,
                                      smoothing_distance=smoothing_distance,
                                      start_year=startYear, end_year=endYear, side=side, force_transects=(analysis_mode != 'full'))

    # ── Preserve per-side transect geometry ────────────────────────────────────
    # process_river_folder always writes transects.shp (no side suffix).
    # Copy it to transects_{side}.shp so both L and R survive sequential runs.
    # (If process_river_folder was skipped the copy is a safe no-op.)
    _transects_base = os.path.join(input_dir, 'transects')
    _transects_side_base = os.path.join(input_dir, f'transects_{side}')
    for _ext in ['.shp', '.shx', '.dbf', '.prj', '.cpg']:
        _src = _transects_base + _ext
        _dst = _transects_side_base + _ext
        if os.path.exists(_src) and not os.path.exists(_dst):
            shutil.copy2(_src, _dst)
    # ───────────────────────────────────────────────────────────────────────────


    print("Step 2: Calculating shifts…")
    compiled_df, orders_df = calculate_shift_filled(
        folder_path=input_dir,
        reference_year=str(reference_year),
        side=side,
        max_order=6
    )
    compiled_df.to_csv(os.path.join(output_dir, f"shifts_{side}.csv"), index=False)
    orders_df.to_csv(os.path.join(output_dir, f"poly_order_{side}.csv"), index=False)

    # Save to input_dir so that process_forecast can reuse it without recalculating
    compiled_df.to_csv(os.path.join(input_dir, f"shifts_cache_{side}.csv"), index=False)
    orders_df.to_csv(os.path.join(input_dir, f"poly_order_cache_{side}.csv"), index=False)


    print("Generating Historical Statistics...")

    transect_stats_df, _ = generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_dir,
        reference_year=reference_year,
        side=side
    )
    transect_stats_df.to_csv(os.path.join(input_dir, f"transect_stats_cache_{side}.csv"), index=False)

    print("Historical Statistics Generated.")

    plot_shift_vs_year(compiled_df, output_dir,
                       reference_year=reference_year,
                       start_year=startYear,
                       end_year=endYear,
                       side=side)

    output_zip_path = os.path.join(uploads_dir, 'analysis_output.zip')
    with zipfile.ZipFile(output_zip_path, 'w') as zipf:
        if os.path.isdir(output_dir): 
            zip_directory(output_dir, zipf, exclude_exts=['.geojson'], exclude_patterns=['transect_stats_cache', 'poly_order_cache', 'poly_order_', 'shifts_cache'])
        if os.path.isdir(images_dir): 
            zip_directory(images_dir, zipf)
        if os.path.isdir(input_dir):
            zip_directory(input_dir, zipf, include_patterns=['transect'], exclude_exts=['.geojson'])

    def generate():
        with open(output_zip_path, 'rb') as f:
            yield from f

    return Response(generate(), mimetype='application/zip')

@app.route('/api/process/forecast', methods=['POST'])
def process_forecast():
    log_catcher.clear()
    uploads_dir, input_dir, output_dir, images_dir = 'uploads', 'input', 'output', 'images'

    # Do not wipe output and images dirs so analysis artefacts don't
    # get deleted for the second side.
    # for d in [uploads_dir, output_dir, images_dir]:
    #     force_clear_dir(d)

    if not os.path.exists(input_dir):
        os.makedirs(input_dir, exist_ok=True)


    forecast_steps = int(request.form.get('forecast_steps', 2))
    #n_years_value = int(request.form.get('n_years_value', 10))
    side = request.form.get('side', 'R')
    reference_year = int(request.form.get('reference_year', 1991))

    startYear = request.form.get('startYear', None)
    endYear = request.form.get('endYear', None)
    startYear = int(startYear) if startYear else None
    endYear = int(endYear) if endYear else None

    cache_path_shifts = os.path.join(input_dir, f"shifts_cache_{side}.csv")
    cache_path_orders = os.path.join(input_dir, f"poly_order_cache_{side}.csv")
    cache_path_stats = os.path.join(input_dir, f"transect_stats_cache_{side}.csv")

    if os.path.exists(cache_path_shifts) and os.path.exists(cache_path_orders):
        import pandas as pd
        print("Step 1: Successfully loaded pre-calculated data from analysis...")
        compiled_df = pd.read_csv(cache_path_shifts)
        orders_df = pd.read_csv(cache_path_orders)
        if os.path.exists(cache_path_stats):
            transect_stats_df = pd.read_csv(cache_path_stats)
        else:
            from model.model import generate_historical_statistics
            transect_stats_df, _ = generate_historical_statistics(compiled_df, output_dir, reference_year)
    else:
        return {"error": "Calculated shifts not found. Please run analysis first."}, 400


    print("Modeling bankline dynamics and generating forecasts...")
    preds = predict_shifts_parallel_safe(
        compiled_df,
        steps=forecast_steps,
        #n_years=n_years_value,
        output_folder=output_dir,
        start_year=startYear,
        end_year=endYear,
        side=side
    )

    print("Step 3: Generating forecast maps…")
    _possible_transects = list(Path(input_dir).glob(f"*transect*_{side}.shp")) + list(Path(input_dir).glob(f"*transect*{side}.shp")) + list(Path(input_dir).glob("*transect*.shp"))
    if not _possible_transects:
        return {"error": f"Transects file for side {side} not found"}, 400
    transects_path = str(_possible_transects[0])
    transects_gdf = gpd.read_file(transects_path)
    
    # Similarly, find baseline file dynamically
    _possible_baselines = list(Path(input_dir).glob(f"{reference_year}*{side}.shp"))
    if not _possible_baselines:
        return {"error": f"Baseline file for year {reference_year} and side {side} not found"}, 400
    baseline_gdf  = gpd.read_file(str(_possible_baselines[0]))

    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_dir,
        side=side,
        outlier_threshold=5000,
        transect_stats_df=transect_stats_df,
        input_folder=input_dir,
    )

    # ✅ Build ZIP (include output, images, and input shapefiles)
    output_zip_path = os.path.join(uploads_dir, 'forecast_output.zip')
    with zipfile.ZipFile(output_zip_path, 'w') as zipf:
        if os.path.isdir(output_dir):
            zip_directory(output_dir, zipf, exclude_exts=['.geojson'], include_patterns=['predict'])
        if os.path.isdir(images_dir):
            zip_directory(images_dir, zipf, include_patterns=['predict'])
        if os.path.isdir(input_dir):
            zip_directory(input_dir, zipf, include_patterns=['transect'], exclude_exts=['.geojson'])

    def generate():
        with open(output_zip_path, 'rb') as f:
            yield from f
        # Removed cleanup to keep results for subsequent runs

    return Response(generate(), mimetype='application/zip')





# --- Transect Stats API ---
@app.route('/api/transect_stats', methods=['GET'])
def get_transect_stats():
    import pandas as pd
    from shapely.geometry import LineString
    import geopandas as gpd
    
    input_dir = 'input'
    
    param_cols = ['LRR', 'LSE', 'NBM', 'NBMR', 'BMC', 'Mean Shift', 'Std',
                  'Mean Absolute Shift', 'MaxErosion', 'MaxAccretion',
                  'ErosionFrequency', 'AccretionFrequency']

    geometries = []
    properties_list = []
    target_crs = None
    
    for side in ['L', 'R']:
        stats_csv = os.path.join(input_dir, f'transect_stats_cache_{side}.csv')
        if not os.path.exists(stats_csv):
            continue
            
        stats_df = pd.read_csv(stats_csv)
        keep_cols = [c for c in param_cols if c in stats_df.columns]
        stats_subset = stats_df[keep_cols].copy().reset_index(drop=True)
        
        _possible_transects = list(Path(input_dir).glob(f"*transect*_{side}.shp")) + list(Path(input_dir).glob(f"*transect*{side}.shp")) + list(Path(input_dir).glob("*transect*.shp"))
        if not _possible_transects:
            continue
        transects_shp_side = str(_possible_transects[0])
        
        transects_gdf = gpd.read_file(transects_shp_side)
        is_split_required = not any(side in str(p) for p in _possible_transects[:2])
            
        transects_gdf = transects_gdf.reset_index(drop=True)
        target_crs = transects_gdf.crs
        
        n = min(len(transects_gdf), len(stats_subset))
        
        for i in range(n):
            line = transects_gdf.geometry.iloc[i]
            if not isinstance(line, LineString) or len(line.coords) < 2:
                continue
                
            if is_split_required:
                start = line.coords[0]
                end = line.coords[-1]
                midX = (start[0] + end[0]) / 2.0
                midY = (start[1] + end[1]) / 2.0
                mid = (midX, midY)
                
                if side == 'L':
                    new_line = LineString([mid, end])
                else:
                    new_line = LineString([start, mid])
            else:
                new_line = line
                
            geometries.append(new_line)
            
            props = {'side': side, 'transect_i': transects_gdf.iloc[i].get('transect_i', transects_gdf.iloc[i].get('transect_id', i+1))}
            for col in keep_cols:
                val = stats_subset.iloc[i][col]
                props[col] = float(val) if pd.notnull(val) else None
            properties_list.append(props)
            
    if not geometries:
        return {'error': 'No stats found'}, 404
        
    merged = gpd.GeoDataFrame(properties_list, geometry=geometries, crs=target_crs)
    
    if merged.crs and merged.crs.to_epsg() != 4326:
        merged = merged.to_crs(epsg=4326)
        
    for col in merged.select_dtypes(include='number').columns:
        merged[col] = merged[col].round(4)
        
    return app.response_class(
        response=merged.to_json(),
        mimetype='application/json'
    )

@app.route('/api/analysis_side', methods=['GET'])
def get_analysis_side():
    return {'side': _last_analysis_side}


# --- Frontend serving ---
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, "index.html")

# --- Output serving ---
#OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
#print("Serving output from:", OUTPUT_DIR)

#@app.route("/output/<path:filename>")
#def serve_output(filename):
#   return send_from_directory(OUTPUT_DIR, filename)

# --- Entry point ---
if __name__ == '__main__':
    multiprocessing.freeze_support()  # important on Windows
    port = 5000
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        webbrowser.open("http://localhost:5000/")
    app.run(host='0.0.0.0', port=port, debug=False)
