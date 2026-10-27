from state import global_state
import geopandas as gpd
from shapely.geometry import LineString, Polygon, MultiLineString, Point
from shapely.ops import linemerge, nearest_points
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller, acf, pacf  
import pandas as pd
from pathlib import Path
import os, shutil
import warnings, os
from concurrent.futures import ProcessPoolExecutor, as_completed
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from scipy.stats import skew, kurtosis, linregress
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    mean_absolute_percentage_error,
    r2_score
)

#----------------------------------- Helper: CRS check ---------------------------------
def check_crs_defined(gdf, filename=None):
    """
    Ensure the GeoDataFrame has a CRS defined.
    If not, stop execution.
    """
    if gdf.crs is None:
        raise ValueError(f"❌ Input file {filename if filename else ''} has no CRS defined. Please assign a CRS before proceeding.")
    return gdf.crs


# ------------------------- Step 1: Extract longest polygon/line feature -------------------------
def extract_mainstream(input_file):
    river_gdf = gpd.read_file(input_file)
    check_crs_defined(river_gdf, input_file)
    river_gdf = river_gdf[river_gdf.is_valid]
    river_gdf['length'] = river_gdf.geometry.length
    main_geom = river_gdf.loc[river_gdf['length'].idxmax(), 'geometry']

    if isinstance(main_geom, Polygon):
        boundary = main_geom.boundary
    elif main_geom.geom_type == "MultiPolygon":
        largest_poly = max(main_geom.geoms, key=lambda p: p.length)
        boundary = largest_poly.boundary
    elif main_geom.geom_type in ["LineString", "MultiLineString"]:
        boundary = main_geom
    else:
        raise ValueError(f"Unsupported geometry type: {main_geom.geom_type}")

    if boundary.geom_type == "MultiLineString":
        return max(boundary.geoms, key=lambda line: line.length)
    elif boundary.geom_type == "LinearRing":
        return LineString(boundary)
    else:
        return boundary
    
# --- NEW HELPERS ---
def _rightmost_x(geom):
    """Return the maximum X (easting) of a LineString/MultiLineString."""
    if isinstance(geom, LineString):
        return max(c[0] for c in geom.coords)
    elif isinstance(geom, MultiLineString):
        return max(c[0] for g in geom.geoms for c in g.coords)
    else:
        raise ValueError(f"Expected LineString/MultiLineString, got {geom.geom_type}")

def classify_banks_from_line_features(gdf, map_right_is_left=True):
    """
    If the input already has line features for banks, pick the two longest lines and label:
      - If map_right_is_left=True: the visually right-most line (higher max X) becomes LEFT (L).
      - The other becomes RIGHT (R).
    Returns (left_line, right_line) or None if not enough line features.
    """
    lines = []
    for geom in gdf.geometry:
        if isinstance(geom, LineString):
            lines.append(geom)
        elif isinstance(geom, MultiLineString):
            lines.extend(list(geom.geoms))

    if len(lines) < 2:
        return None

    # Take two longest as banks
    lines_sorted = sorted(lines, key=lambda g: g.length, reverse=True)[:2]
    a, b = lines_sorted[0], lines_sorted[1]

    ax, bx = _rightmost_x(a), _rightmost_x(b)
    # the right-most (higher X) is "map-right"
    if map_right_is_left:
        left_line, right_line = (a, b) if ax >= bx else (b, a)
    else:
        left_line, right_line = (b, a) if ax >= bx else (a, b)

    return left_line, right_line



# ------------------------- Step 2: Split river boundary into left/right banks -------------------------
def split_river_banks(boundary):
    """
    Split a single boundary (LineString/MultiLineString) into two banks by traversing
    from top (max Y) to bottom (min Y). After geometric split, enforce the convention:
    the visually right bank on the map (higher max X) is labeled as LEFT (L).
    Returns (left_bank, right_bank) as LineStrings.
    """
    if boundary.geom_type == "MultiLineString":
        merged = linemerge(boundary)
        ring_line = max(merged.geoms, key=lambda line: line.length) if merged.geom_type != "LineString" else merged
        ring_coords = list(ring_line.coords)
    elif boundary.geom_type == "LineString":
        ring_coords = list(boundary.coords)
    else:
        raise ValueError(f"Unsupported geometry type for splitting banks: {boundary.geom_type}")

    top_idx = max(range(len(ring_coords)), key=lambda i: ring_coords[i][1])
    bot_idx = min(range(len(ring_coords)), key=lambda i: ring_coords[i][1])

    left_bank_coords, right_bank_coords = [], []
    n = len(ring_coords)

    i = top_idx
    while i != bot_idx:
        left_bank_coords.append(ring_coords[i])
        i = (i + 1) % n
    left_bank_coords.append(ring_coords[bot_idx])

    i = bot_idx
    while i != top_idx:
        right_bank_coords.append(ring_coords[i])
        i = (i + 1) % n
    right_bank_coords.append(ring_coords[top_idx])

    left_bank = LineString(left_bank_coords)
    right_bank = LineString(right_bank_coords)

    # Enforce convention: map-right (higher max X) must be labeled as LEFT
    if _rightmost_x(left_bank) < _rightmost_x(right_bank):
        left_bank, right_bank = right_bank, left_bank

    return left_bank, right_bank


# ------------------------- Step 3: Transect Generation -------------------------
def generate_centerline_from_banklines(input_folder, verbose_timing=True, max_raster_pixels=None):
    from shapely.ops import unary_union, polygonize, linemerge
    from shapely.geometry import LineString, MultiLineString
    import rasterio
    from rasterio.features import rasterize
    from skimage.morphology import skeletonize
    import scipy.sparse as sp
    from scipy.sparse.csgraph import shortest_path
    from scipy.interpolate import splprep, splev
    import os, glob, time
    import numpy as np
    import pandas as pd
    import geopandas as gpd

    def log(msg):
        if verbose_timing:
            print(msg)

    files = glob.glob(os.path.join(input_folder, "*.shp"))
    if not files:
        raise ValueError(f"No shapefiles found in {input_folder}")

    t0 = time.perf_counter()
    gdfs = []
    target_crs = None
    for f in files:
        gdf = gpd.read_file(f)
        if not gdfs:
            target_crs = gdf.crs
            if gdf.crs.is_geographic:
                centroid = gdf.unary_union.centroid
                utm_zone = int((centroid.x + 180) / 6) + 1
                epsg_code = 32600 + utm_zone
                gdf = gdf.to_crs(epsg=epsg_code)
                target_crs = gdf.crs
        else:
            gdf = gdf.to_crs(target_crs)
        gdfs.append(gdf)

    merged = gpd.GeoDataFrame(pd.concat(gdfs, ignore_index=True), crs=target_crs)
    log(f"[timing] read + merge {len(files)} bankline file(s): {time.perf_counter() - t0:.2f}s")

    # River space polygon
    t0 = time.perf_counter()
    import re
    from shapely.geometry import Polygon, Point
    
    year_lines = {}
    for f, gdf in zip(files, gdfs):
        basename = os.path.basename(f)
        m = re.search(r'([0-9]{4})', basename)
        year = m.group(1) if m else basename
        
        merged_geom = unary_union(gdf.geometry)
        if merged_geom.geom_type == 'LineString':
            lines = merged_geom
        elif merged_geom.geom_type == 'MultiLineString':
            lines = linemerge(merged_geom)
        else:
            continue
            
        if lines.geom_type == 'MultiLineString':
            if len(lines.geoms) > 0:
                lines = max(lines.geoms, key=lambda x: x.length)
            else:
                continue
        elif lines.geom_type != 'LineString':
            continue
            
        is_left = bool(re.search(r'(^|[_ 0-9-])(l|left)([_ -]|\.shp$)', basename.lower()))
        is_right = bool(re.search(r'(^|[_ 0-9-])(r|right)([_ -]|\.shp$)', basename.lower()))
        
        side = 'L' if is_left else ('R' if is_right else 'unknown')
        if year not in year_lines:
            year_lines[year] = {}
        year_lines[year][side] = lines

    constructed_polygons = []
    for year, sides in year_lines.items():
        if 'L' in sides and 'R' in sides:
            l_coords = list(sides['L'].coords)
            r_coords = list(sides['R'].coords)
            if len(l_coords) >= 2 and len(r_coords) >= 2:
                d_straight = Point(l_coords[0]).distance(Point(r_coords[0])) + Point(l_coords[-1]).distance(Point(r_coords[-1]))
                d_cross = Point(l_coords[0]).distance(Point(r_coords[-1])) + Point(l_coords[-1]).distance(Point(r_coords[0]))
                
                if d_cross < d_straight:
                    r_coords = r_coords[::-1]
                    
                poly = Polygon(l_coords + r_coords[::-1] + [l_coords[0]])
                if poly.is_valid:
                    constructed_polygons.append(poly)
                else:
                    constructed_polygons.append(poly.buffer(0))

    if constructed_polygons:
        river_space = unary_union(constructed_polygons)
    else:
        union_lines = unary_union(merged.geometry)
        polygons = list(polygonize(union_lines))
        river_space = unary_union(polygons)

    if river_space.is_empty:
        river_space = unary_union(merged.geometry).convex_hull

    log(f"[timing] union/polygonize river space: {time.perf_counter() - t0:.2f}s")

    # Rasterization
    xmin, ymin, xmax, ymax = river_space.bounds
    bbox_width = xmax - xmin
    bbox_height = ymax - ymin
    target_pixels = 10000

    if max_raster_pixels is not None:
        long_dim = max(bbox_width, bbox_height)
        resolution = long_dim / target_pixels if long_dim > 0 else 1
        est_w = max(1200, int(bbox_width / resolution))
        est_h = max(1200, int(bbox_height / resolution))
        if est_w * est_h > max_raster_pixels:
            scale = ((est_w * est_h) / max_raster_pixels) ** 0.5
            resolution *= scale
        width = max(1200, int(bbox_width / resolution))
        height = max(1200, int(bbox_height / resolution))
    else:
        resolution_x = bbox_width / target_pixels if bbox_width > 0 else 1
        resolution_y = bbox_height / target_pixels if bbox_height > 0 else 1
        resolution = max(resolution_x, resolution_y)
        width = max(1200, int(bbox_width / resolution))
        height = max(1200, int(bbox_height / resolution))

    log(f"[timing] raster size: {width:,} x {height:,} = {width * height:,} pixels "
        f"(bbox {bbox_width:.0f} x {bbox_height:.0f})")

    t0 = time.perf_counter()
    transform = rasterio.transform.from_bounds(xmin, ymin, xmax, ymax, width, height)
    mask = rasterize(
        [(river_space, 1)],
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype=np.uint8
    )
    log(f"[timing] rasterize polygon: {time.perf_counter() - t0:.2f}s")

    t0 = time.perf_counter()
    skeleton = skeletonize(mask > 0)
    log(f"[timing] skeletonize: {time.perf_counter() - t0:.2f}s")

    t0 = time.perf_counter()
    py, px = np.nonzero(skeleton)
    n_nodes = py.shape[0]
    if n_nodes == 0:
        return river_space.minimum_rotated_rectangle, target_crs

    h, w = skeleton.shape
    node_id = -np.ones((h, w), dtype=np.int64)
    node_id[py, px] = np.arange(n_nodes)

    offsets = [(-1, -1), (-1, 0), (-1, 1),
               (0, -1),           (0, 1),
               (1, -1),  (1, 0),  (1, 1)]

    node_range = np.arange(n_nodes)
    row_list, col_list = [] , []
    for dy, dx in offsets:
        ny = py + dy
        nx_ = px + dx
        in_bounds = (ny >= 0) & (ny < h) & (nx_ >= 0) & (nx_ < w)
        neighbor_ids = np.full(n_nodes, -1, dtype=np.int64)
        neighbor_ids[in_bounds] = node_id[ny[in_bounds], nx_[in_bounds]]
        has_edge = neighbor_ids >= 0
        row_list.append(node_range[has_edge])
        col_list.append(neighbor_ids[has_edge])

    rows = np.concatenate(row_list)
    cols = np.concatenate(col_list)
    data = np.ones(rows.shape[0], dtype=np.uint8)
    adj = sp.coo_matrix((data, (rows, cols)), shape=(n_nodes, n_nodes)).tocsr()

    degree = np.diff(adj.indptr)
    endpoint_idx = np.where(degree == 1)[0]
    log(f"[timing] build skeleton graph: {time.perf_counter() - t0:.2f}s "
        f"({n_nodes:,} skeleton pixels, {endpoint_idx.shape[0]:,} endpoints)")

    if endpoint_idx.shape[0] < 2:
        return river_space.minimum_rotated_rectangle, target_crs

    t0 = time.perf_counter()
    dist, pred = shortest_path(
        csgraph=adj,
        directed=False,
        unweighted=True,
        indices=endpoint_idx,
        return_predecessors=True,
    )

    dist_between = dist[:, endpoint_idx].copy()
    np.fill_diagonal(dist_between, -1)
    dist_between[~np.isfinite(dist_between)] = -1

    best_flat = np.argmax(dist_between)
    i_best, j_best = np.unravel_index(best_flat, dist_between.shape)
    best_hops = dist_between[i_best, j_best]
    log(f"[timing] endpoint shortest-path search: {time.perf_counter() - t0:.2f}s")

    if best_hops <= 0:
        return river_space.minimum_rotated_rectangle, target_crs

    source_node = endpoint_idx[i_best]
    target_node = endpoint_idx[j_best]
    path_nodes = [target_node]
    current = target_node
    while current != source_node:
        current = pred[i_best, current]
        path_nodes.append(current)
    path_nodes.reverse()

    t0 = time.perf_counter()
    points = [rasterio.transform.xy(transform, py[n], px[n]) for n in path_nodes]

    xs_pts, ys_pts = zip(*points)
    if len(xs_pts) > 3:
        k = min(3, len(xs_pts) - 1)
        tck, u = splprep([xs_pts, ys_pts], s=2000, k=k)
        new_points = splev(np.linspace(0, 1, 5000), tck)
        smooth_line = LineString(zip(new_points[0], new_points[1]))
    else:
        smooth_line = LineString(points).simplify(tolerance=resolution, preserve_topology=True)

    smooth_line = smooth_line.intersection(river_space)
    if smooth_line.geom_type == "MultiLineString":
        smooth_line = linemerge(smooth_line)
    log(f"[timing] spline fit + clip: {time.perf_counter() - t0:.2f}s")

    return smooth_line, target_crs

def generate_transects_from_banklines(input_folder, spacing=100, transect_length=8000,
                                       smoothing_distance=4000, verbose_timing=True,
                                       max_raster_pixels=None):
    """
    Generate transects directly from historical banklines (no centerline.shp required).
    """
    import time
    import numpy as np
    import geopandas as gpd
    import shapely
    from shapely.geometry import LineString
    
    t_total = time.perf_counter()
    centerline, target_crs = generate_centerline_from_banklines(
        input_folder, verbose_timing=verbose_timing, max_raster_pixels=max_raster_pixels
    )

    t0 = time.perf_counter()
    total_len = centerline.length
    d_center = np.arange(0, total_len, spacing)
    if d_center.shape[0] == 0:
        return gpd.GeoDataFrame({"transect_id": []}, geometry=[], crs=target_crs)

    d_p1 = np.clip(d_center - smoothing_distance / 2, 0, total_len)
    d_p2 = np.clip(d_center + smoothing_distance / 2, 0, total_len)

    centers = shapely.get_coordinates(shapely.line_interpolate_point(centerline, d_center))
    p1s = shapely.get_coordinates(shapely.line_interpolate_point(centerline, d_p1))
    p2s = shapely.get_coordinates(shapely.line_interpolate_point(centerline, d_p2))

    dx = p2s[:, 0] - p1s[:, 0]
    dy = p2s[:, 1] - p1s[:, 1]
    mag = np.hypot(dx, dy)
    valid = mag > 0

    nx_dir = np.zeros_like(dx)
    ny_dir = np.zeros_like(dy)
    nx_dir[valid] = -dy[valid] / mag[valid]
    ny_dir[valid] = dx[valid] / mag[valid]

    half_len = transect_length / 2
    start_x = centers[:, 0] - nx_dir * half_len
    start_y = centers[:, 1] - ny_dir * half_len
    end_x = centers[:, 0] + nx_dir * half_len
    end_y = centers[:, 1] + ny_dir * half_len

    transects = [
        LineString([(sx, sy), (ex, ey)])
        for sx, sy, ex, ey, ok in zip(start_x, start_y, end_x, end_y, valid)
        if ok
    ]

    if verbose_timing:
        print(f"[timing] build {len(transects):,} transects: {time.perf_counter() - t0:.2f}s")
        print(f"[timing] TOTAL: {time.perf_counter() - t_total:.2f}s")

    return gpd.GeoDataFrame({"transect_id": np.arange(1, len(transects) + 1)},
                             geometry=transects, crs=target_crs)


def process_river_folder(input_folder, spacing=100, transect_length=8000, smoothing_distance=4000, start_year=None, end_year=None, side='L', force_transects=False):
    """
    Processes river shapefiles in a folder:
    - Checks CRS consistency for existing L/R shapefiles
    - If a file already contains two (Multi)LineString banks, classify them directly:
        map-right is labeled as LEFT (L), the other as RIGHT (R)
    - Otherwise, extract mainstream and split into L/R (with the same labeling convention)
    - Creates transects if not available
    - (Optional) start_year and end_year are for logging/validation only
    """
    import re
    input_folder = os.path.abspath(input_folder)
    shapefiles = [f for f in os.listdir(input_folder) if f.endswith(".shp")]
    print(f"\n📁 Scanning input folder: {input_folder}")

    # ---- Step 1: Check CRS for existing L/R shapefiles ----
    for file in shapefiles:
        global_state.check()
        if file.endswith("L.shp"or "_L.shp") or file.endswith("R.shp" or "_R.shp"):
            full_path = os.path.join(input_folder, file)
            gdf = gpd.read_file(full_path)
            check_crs_defined(gdf, file)
            print(f"✅ CRS OK for {file}")

    # ---- Step 2: Process and split river shapefiles ----
    for file in shapefiles:
        global_state.check()
        if file.endswith(".shp") and not (
            file.endswith("L.shp") or file.endswith("R.shp")
            or file in ["transects.shp"] or file in ["centerline.shp"]
        ):
            year = os.path.splitext(file)[0]
            input_file = os.path.join(input_folder, file)
            try:
                river_gdf = gpd.read_file(input_file)
                check_crs_defined(river_gdf, input_file)

                # If the input already contains at least two line features, classify directly
                geom_types = set(river_gdf.geometry.geom_type.unique())
                line_like = all(t in {"LineString", "MultiLineString"} for t in geom_types)
                used_direct_lines = False

                if line_like and len(river_gdf) >= 2:
                    classified = classify_banks_from_line_features(
                        river_gdf,
                        map_right_is_left=True  # "what is right to me is actually LEFT"
                    )
                    if classified is not None:
                        left_bank, right_bank = classified
                        used_direct_lines = True

                if not used_direct_lines:
                    # Fallback: extract longest mainstream/boundary and split
                    boundary = extract_mainstream(input_file)
                    left_bank, right_bank = split_river_banks(boundary)

                # ✅ Maintain original CRS and write
                L_file = os.path.join(input_folder, f"{year}L.shp")
                R_file = os.path.join(input_folder, f"{year}R.shp")
                L_gdf = gpd.GeoDataFrame(geometry=[left_bank],  crs=river_gdf.crs)
                R_gdf = gpd.GeoDataFrame(geometry=[right_bank], crs=river_gdf.crs)

                if side in ['L', 'both']:
                    check_crs_defined(L_gdf, L_file)
                    L_gdf.to_file(L_file)
                    try:
                        L_gdf.to_crs(epsg=4326).to_file(L_file.replace('.shp', '.geojson'), driver='GeoJSON')
                    except Exception as geo_e:
                        print(f"Failed to save GeoJSON: {geo_e}")
                        
                if side in ['R', 'both']:
                    check_crs_defined(R_gdf, R_file)
                    R_gdf.to_file(R_file)
                    try:
                        R_gdf.to_crs(epsg=4326).to_file(R_file.replace('.shp', '.geojson'), driver='GeoJSON')
                    except Exception as geo_e:
                        print(f"Failed to save GeoJSON: {geo_e}")

                print(f"✅ Split {file} and created side(s): {side}")
            except Exception as e:
                print(f"⚠️ Skipping {file} due to processing error: {e}")

    # ---- Step 3: Create Transects from historical banklines ----
    transects_file = None
    possible_transects = list(Path(input_folder).glob(f"*transect*_{side}.shp")) + list(Path(input_folder).glob(f"*transect*{side}.shp")) + list(Path(input_folder).glob("*transect*.shp"))
    if possible_transects:
        transects_file = str(possible_transects[0])

    if transects_file and os.path.exists(transects_file) and not force_transects:
        print(f"⚠️ Found existing {os.path.basename(transects_file)} — skipping transect generation.")
    else:
        print("ℹ️ Generating Transects from historical banklines...")
        transects_gdf = generate_transects_from_banklines(input_folder,
                                                      spacing=spacing,
                                                      transect_length=transect_length,
                                                      smoothing_distance=smoothing_distance)
        target_crs = transects_gdf.crs

        # Assign CRS from banklines
        transects_gdf.crs = target_crs
        check_crs_defined(transects_gdf, transects_file)

        # Do not split. Save transects directly for the selected side.
        out_gdf = gpd.GeoDataFrame({'transect_i': transects_gdf['transect_id']}, geometry=transects_gdf.geometry, crs=target_crs)
        
        transects_out_file = os.path.join(input_folder, f"transects_{side}.shp")
        
        out_gdf.to_file(transects_out_file)
        
        try:
            out_gdf.to_crs(epsg=4326).to_file(transects_out_file.replace('.shp', '.geojson'), driver='GeoJSON')
        except Exception as geo_e:
            print(f"Failed to save GeoJSON: {geo_e}")
            
        print(f"✅ Transects generated and saved as transects_{side}.shp")    

    # ---- Step 4: Identify available years ----
    all_years = []
    for shp in shapefiles:
        if re.search(r"\d{4}", shp) and not any(x in shp for x in ["centerline", "transects"]):
            digits = re.findall(r"\d{4}", shp)
            if digits:
                all_years.append(int(digits[0]))

    if all_years:
        all_years = sorted(set(all_years))
        print(f"\n Available shapefile years: {all_years}")

        if start_year or end_year:
            if start_year is None:
                start_year = all_years[0]
            if end_year is None:
                end_year = all_years[-1]
            if not (all_years[0] <= start_year <= end_year <= all_years[-1]):
                print(f"⚠️ Invalid window {start_year}-{end_year}. Ignoring window limits.")
            else:
                window_years = [y for y in all_years if start_year <= y <= end_year]
                print(f"🪟 Analysis window: {start_year}–{end_year} ({len(window_years)} years)")
    else:
        print("⚠️ No valid year-based shapefiles found.")

    return input_folder
#-------------------shapefile processing done---------------------------------------------------------------------------------
##############################################################################################################################
#------------------shift calculation started----------------------------------------------------------------------------------
import geopandas as gpd
import pandas as pd
import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points
from numpy.polynomial import Polynomial
from sklearn.metrics import mean_squared_error
from pathlib import Path
import matplotlib.pyplot as plt
from pathlib import Path
import os

def calculate_shift_filled(folder_path, reference_year, side="L", max_order=4):
    """
    Calculates signed shift distances along transects for multiple banklines,
    fills missing years using adaptive polynomial interpolation (auto-selecting polynomial order),
    and returns both interpolated results and a DataFrame of orders used for each interpolated year.

    Returns:
        compiled_df: DataFrame with transect_id and shift_{year} columns (filled).
        orders_df: DataFrame with transect_id and order_{year} columns (NaN for original years,
                   integer order for years that were filled).
    """
    TARGET_CRS = "EPSG:32644"

    # ------------------------
    # CRS Conversion
    # ------------------------
    def convert_to_utm(gdf):
        if gdf.crs is None:
            raise ValueError("CRS not defined for GeoDataFrame")
        return gdf.to_crs(TARGET_CRS)

    # ------------------------
    # Signed Shift Calculation
    # ------------------------
    def signed_shift_distance(transect: LineString, ref_point: Point, comp_point: Point, side="R"):
        t0 = np.array(transect.coords[0])
        t1 = np.array(transect.coords[-1])
        transect_vec = t1 - t0
        shift_vec = np.array([comp_point.x - ref_point.x, comp_point.y - ref_point.y])
        dot_val = np.dot(shift_vec, transect_vec)
        sign = np.sign(dot_val) if dot_val != 0 else 1
        # Reverse sign for left bank
        if side.upper() == "L":
            sign = -sign
        return sign * ref_point.distance(comp_point)

    # ------------------------
    # Calculate Shifts per Transect
    # ------------------------
    def calculate_shift_along_transects(transects_gdf, ref_line, comp_line, side):
        # Ensure indices align
        transects_geom = transects_gdf.geometry.reset_index(drop=True)
        
        # Vectorized intersections
        intersections_ref = transects_geom.intersection(ref_line)
        intersections_comp = transects_geom.intersection(comp_line)
        
        shift_data = []
        for i, transect in enumerate(transects_geom):
            if not isinstance(transect, LineString):
                shift_data.append(np.nan)
                continue
                
            intersection_ref = intersections_ref.iloc[i]
            intersection_comp = intersections_comp.iloc[i]

            if intersection_ref.is_empty:
                intersection_ref = nearest_points(transect, ref_line)[1]
            if intersection_comp.is_empty:
                intersection_comp = nearest_points(transect, comp_line)[1]

            start_point = Point(transect.coords[0])
            if intersection_ref.geom_type == 'MultiPoint':
                intersection_ref = nearest_points(start_point, intersection_ref)[1]
            if intersection_comp.geom_type == 'MultiPoint':
                intersection_comp = nearest_points(start_point, intersection_comp)[1]

            shift_distance = signed_shift_distance(transect, intersection_ref, intersection_comp, side=side)
            shift_data.append(shift_distance)
        return shift_data

    # ------------------------
    # Load Transects
    # ------------------------
    transects_path = None
    possible_transects = list(Path(folder_path).glob(f"*transect*_{side}.shp")) + list(Path(folder_path).glob(f"*transect*{side}.shp")) + list(Path(folder_path).glob("*transect*.shp"))
    if possible_transects:
        transects_path = possible_transects[0]

    if not transects_path or not transects_path.exists():
        raise FileNotFoundError(f"No transects file found for side {side} in {folder_path}")

    print(f"Loading transects from {transects_path}")
    transects_gdf = convert_to_utm(gpd.read_file(transects_path))
    compiled_df = pd.DataFrame({'transect_id': range(1, len(transects_gdf) + 1)})

    # ------------------------
    # Banklines (filter by side)
    # ------------------------
    bankline_files = sorted([f for f in Path(folder_path).glob(f"*{side}.shp") if f.stem[:-1].isdigit()])
    if not bankline_files:
        raise ValueError(f"No {side} bankline shapefiles found in {folder_path}")

    years_present = sorted([int(f.stem[:-1]) for f in bankline_files])
    min_year, max_year = years_present[0], years_present[-1]

    # ------------------------
    # Reference line
    # ------------------------
    ref_file = Path(folder_path) / f"{reference_year}{side}.shp"
    if not ref_file.exists():
        raise FileNotFoundError(f"Reference file {ref_file} not found.")
    print(f"Using reference line: {ref_file}")
    ref_gdf = convert_to_utm(gpd.read_file(ref_file))
    ref_line = ref_gdf.geometry.union_all() if len(ref_gdf) > 1 else ref_gdf.geometry.iloc[0]

    # ------------------------
    # Shifts for each year
    # ------------------------
    for file_path in bankline_files:
        year = int(file_path.stem[:-1])
        if year == int(reference_year):
            continue

        print(f"Calculating shifts for year: {year}")
        comp_gdf = convert_to_utm(gpd.read_file(file_path))
        comp_line = comp_gdf.geometry.union_all() if len(comp_gdf) > 1 else comp_gdf.geometry.iloc[0]

        compiled_df[f'shift_{year}'] = calculate_shift_along_transects(transects_gdf, ref_line, comp_line, side)
        print(f"✅ Shifts calculated for year {year}")

    # ------------------------
    # Fill missing years using adaptive polynomial interpolation
    # ------------------------
    def auto_poly_fill(y_series, years, reference_year, max_order=None, left_ctx=3, right_ctx=3):
        """
        Interpolate missing values for a single transect using best-fit polynomial.

        Automatically prevents unrealistic extrapolations:
        If an interpolated value exceeds the maximum observed (non-NaN) shift magnitude
        for that transect, it is replaced by that maximum observed value.

        Returns:
            y_filled: array of filled values (same length as y_series)
            orders: array of same length where orders[j] == polynomial order used for that year if filled,
                    NaN if year was originally present or not filled.
        """
        import numpy as np
        from numpy.polynomial import Polynomial
        from sklearn.metrics import mean_squared_error

        y = y_series.copy().astype(float)
        n = len(y)
        orders = np.full(n, np.nan)

        # Determine realistic physical limits from existing data
        valid_values = y[~np.isnan(y)]
        if len(valid_values) > 0:
            min_shift, max_shift = np.nanmin(valid_values), np.nanmax(valid_values)
        else:
            # If all values are missing, we can’t constrain it
            min_shift, max_shift = -np.inf, np.inf

        i = 0
        while i < n:
            if not np.isnan(y[i]):
                i += 1
                continue

            # found start of gap
            gap_start = i
            while i < n and np.isnan(y[i]):
                i += 1
            gap_end = i  # first index after gap (could be n)

            left_idx = gap_start - 1
            right_idx = gap_end

            # collect context indices
            left_context = list(range(max(0, left_idx - left_ctx + 1), left_idx + 1)) if left_idx >= 0 else []
            right_context = list(range(right_idx, min(n, right_idx + right_ctx))) if right_idx < n else []
            context_idxs = [idx for idx in (left_context + right_context)
                            if 0 <= idx < n and not np.isnan(y[idx])]

            if len(context_idxs) < 2:
                continue  # not enough data

            x_known = np.array([years[idx] for idx in context_idxs])
            y_known = np.array([y[idx] for idx in context_idxs])

            # choose best polynomial order
            best_order, best_mse, best_model = 1, np.inf, None
            max_try = min(max_order, len(x_known) - 1)
            for order in range(1, max_try + 1):
                try:
                    p = Polynomial.fit(x_known, y_known, deg=order)
                    mse = mean_squared_error(y_known, p(x_known))
                    if mse < best_mse:
                        best_mse, best_order, best_model = mse, order, p
                except Exception:
                    continue

            # fill gap if model found
            if best_model is not None:
                for j in range(gap_start, gap_end):
                    # Never interpolate the reference year
                    if years[j] == int(reference_year):
                        y[j] = 0.0
                        orders[j] = np.nan
                        continue
                    val = best_model(years[j])

                    # --- Clamp to observed range ---
                    if val > max_shift:
                        val = max_shift
                    elif val < min_shift:
                        val = min_shift

                    y[j] = val
                    orders[j] = best_order

        return y, orders


    all_years = list(range(min_year, max_year + 1))
    year_array = np.array(all_years)

    # ensure shift columns exist for all years
    for year in all_years:
        col = f'shift_{year}'
        if year == int(reference_year):
            # Reference year shift is always zero
            compiled_df[col] = 0.0
        elif col not in compiled_df.columns:
            compiled_df[col] = np.nan

    cols_sorted = ['transect_id'] + [f'shift_{y}' for y in all_years]
    compiled_df = compiled_df[cols_sorted]

    shifts_only = compiled_df.iloc[:, 1:]
    filled_values = []
    orders_rows = []

    print("🔄 Performing adaptive polynomial interpolation for each transect...")
    for idx, row in shifts_only.iterrows():
        filled_row, orders_row = auto_poly_fill(row.values, year_array, int(reference_year),max_order=max_order)
        filled_values.append(filled_row)
        orders_rows.append(orders_row)

    compiled_df.iloc[:, 1:] = np.array(filled_values)

    # build orders DataFrame
    orders_df = pd.DataFrame(orders_rows, columns=[f'order_{y}' for y in all_years])
    orders_df.insert(0, 'transect_id', compiled_df['transect_id'])

    # optional: also store a summary best order per transect (max order used)
    compiled_df['best_poly_order'] = orders_df.drop(columns='transect_id').max(axis=1).values

    print("✅ Adaptive polynomial interpolation completed.")
    print("✅ All shifts interpolated and DataFrame ready.")

    return compiled_df, orders_df

#--------------------------Shift csv file created---------------------------------------------------------------------------
def plot_shift_vs_year(
    compiled_df,
    output_folder,
    reference_year,
    start_year=None,
    end_year=None,
    outlier_threshold=5000,
    side='L'
):
    """
    Enhanced version:
    - Plots and computes only between start_year and end_year.
    - Combines avg positive & negative shift into one plot.
    - Adds relative shift (to reference year) plot.
    - Skips outliers beyond ±5 km.
    - Maintains consistent TransectID alignment across all plots.
    """

    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    import os

    # ---- Normalize Transect column ----
    if "Transect ID" in compiled_df.columns:
        compiled_df = compiled_df.rename(columns={"Transect ID": "TransectID"})
    elif "transect_id" in compiled_df.columns:
        compiled_df = compiled_df.rename(columns={"transect_id": "TransectID"})

    # ---- Extract year columns ----
    shift_cols = [c for c in compiled_df.columns if c.startswith("shift_")]
    years = sorted([int(c.replace("shift_", "")) for c in shift_cols])

    # ---- Apply start and end year filter ----
    if start_year is not None:
        years = [y for y in years if y >= int(start_year)]
    if end_year is not None:
        years = [y for y in years if y <= int(end_year)]

    # ---- Ensure reference year is within bounds ----
    reference_year = int(reference_year)
    if reference_year not in years:
        raise ValueError(
            f"Reference year {reference_year} not within selected range ({start_year}–{end_year})."
        )

    ref_col = f"shift_{reference_year}"
    if ref_col not in compiled_df.columns:
        raise ValueError(f"Reference year column '{ref_col}' not found in DataFrame.")

    # ---- Remove outliers ----
    for col in [f"shift_{y}" for y in years]:
        compiled_df.loc[compiled_df[col].abs() > outlier_threshold, col] = np.nan

    # =======================================================
    # 1️⃣ Relative Shift vs Reference Year (Wide Format)
    # =======================================================

    rel_to_ref_df = pd.DataFrame()
    rel_to_ref_df["TransectID"] = compiled_df["TransectID"]

    for y in years:
        if y == reference_year:
            continue

        diff = compiled_df[f"shift_{y}"] - compiled_df[ref_col]

        # Remove outliers
        diff = diff.where(diff.abs() <= outlier_threshold)

        # Add as a separate year column
        rel_to_ref_df[str(y)] = diff

    rel_ref_csv = os.path.join(output_folder, f"relative_shifts_with_reference_{side}.csv")
    rel_to_ref_df.to_csv(rel_ref_csv, index=False)

    print(f"📄 Relative-to-reference shifts saved at: {rel_ref_csv}")

    # ---- Plot: Relative Shift to Reference Year ----
    plt.figure(figsize=(12, 6))
    cmap = plt.get_cmap("viridis", len(years))
    year_cols = [c for c in rel_to_ref_df.columns if c != "TransectID"]
    for i, year in enumerate(year_cols):
        plt.scatter(
            rel_to_ref_df["TransectID"],
            rel_to_ref_df[year],
            s=8,
            label=f"{year}-{reference_year}",
            color=cmap(i)
        )
    plt.axhline(0, color='black', linestyle='--', linewidth=1)
    plt.xlabel("Transect ID")
    plt.ylabel(f"Shift relative to {reference_year} (m)")
    plt.title(f"Relative Shift vs TransectID (Reference: {reference_year} ({side}))")
    plt.legend(title="Year Comparison", bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True)
    plt.tight_layout()
    save_path_rel = os.path.join(output_folder, f"relative_shifts_with_reference_{side}.png")
    plt.savefig(save_path_rel, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"📊 Relative Shift to Reference saved at: {save_path_rel}")

    # =======================================================
    # 2️⃣ Year-to-Year Relative Shifts (Wide Format)
    # =======================================================

    rel_shift_df = pd.DataFrame()
    rel_shift_df["TransectID"] = compiled_df["TransectID"]

    for y1, y2 in zip(years[:-1], years[1:]):
        diff = compiled_df[f"shift_{y2}"] - compiled_df[f"shift_{y1}"]

        # Remove outliers
        diff = diff.where(diff.abs() <= outlier_threshold)

        # Add one column for this year pair
        rel_shift_df[f"{y2}-{y1}"] = diff

    rel_shift_csv = os.path.join(output_folder, f"Sequential_shifts_{side}.csv")
    rel_shift_df.to_csv(rel_shift_csv, index=False)

    print(f"📄 Year-to-year relative shifts saved at: {rel_shift_csv}")

    # ---- Plot: Relative Shift (ΔShift) vs TransectID ----
    plt.figure(figsize=(12, 6))
    year_cols = [c for c in rel_shift_df.columns if c != "TransectID"]
    cmap = plt.get_cmap("tab20", len(year_cols))
    for i, year in enumerate(year_cols):
        plt.scatter(
            rel_shift_df["TransectID"],
            rel_shift_df[year],
            s=8,
            label=year,
            color=cmap(i)
        )
    plt.axhline(0, color='black', linestyle='--', linewidth=1)
    plt.xlabel("Transect ID")
    plt.ylabel("Relative Shift (m)")
    plt.title(f"Year-to-Year Relative Shift ({start_year}–{end_year} ({side}))")
    plt.legend(title="Year Difference", bbox_to_anchor=(1.05, 1), loc='upper left')
    plt.grid(True)
    plt.tight_layout()
    save_path1 = os.path.join(output_folder, f"year_to_year_sequential_shift_{side}.png")
    plt.savefig(save_path1, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"📊 Year-to-Year Relative Shift saved at: {save_path1}")
    # =======================================================
    # 3️⃣ Combined Average Shift with Standard Deviation
    # =======================================================
    shift_cols = [c for c in rel_to_ref_df.columns if c != "TransectID"]
    avg_shifts = pd.DataFrame({
        "TransectID": rel_to_ref_df["TransectID"],
        "Mean Shift": rel_to_ref_df[shift_cols].mean(axis=1),
        "Std": rel_to_ref_df[shift_cols].std(axis=1)
    })
    mean_shift = avg_shifts["Mean Shift"].astype(float)
    std = avg_shifts["Std"].astype(float)
    upper = mean_shift + std
    lower = mean_shift - std
    # Symmetric Y-axis
    y_limit = max(abs(upper.max()), abs(lower.min()))
    y_limit *= 1.05
    # Plot
    fig, ax = plt.subplots(figsize=(12, 6), dpi=150)
    # Standard deviation band
    ax.fill_between(
        avg_shifts["TransectID"],
        lower,
        upper,
        color="lightcoral",
        alpha=0.8,
        label="Standard Deviation",
        zorder=1
    )
    # Mean shift line
    ax.plot(
        avg_shifts["TransectID"],
        mean_shift,
        color="red",
        linewidth=1.3,
        marker="o",
        markersize=1.8,
        label="Mean Shift",
        zorder=2
    )
    # Zero line
    ax.axhline(0,color="black",linewidth=1,linestyle="--",alpha=0.7)
    # Labels
    ax.set_title(f"Mean Shift With Standard Deviation ({side})",fontsize=12,fontweight="bold",pad=8)
    ax.set_xlabel("Transect ID",fontsize=9,fontweight="bold")
    ax.set_ylabel("Mean Shift (m)",fontsize=9,fontweight="bold")
    # Grid
    ax.grid(True,linestyle="--",linewidth=0.8,alpha=0.3)
    ax.minorticks_on()
    ax.grid(which="minor",linestyle=":",linewidth=0.5,alpha=0.15)
    # Legend
    legend = ax.legend(loc="upper right",fontsize=8,frameon=True,fancybox=True,shadow=True,borderpad=0.4,labelspacing=0.3,handlelength=1.6)
    legend.get_frame().set_facecolor("white")
    legend.get_frame().set_edgecolor("black")
    legend.get_frame().set_linewidth(1.0)
    # Border
    for spine in ax.spines.values():
        spine.set_linewidth(1.2)
        spine.set_color("black")
    # Tick formatting
    ax.tick_params(axis="both",which="major",labelsize=9,width=1.2,length=5)
    ax.tick_params(axis="both",which="minor",width=0.8,length=2)
    ax.set_xlim(avg_shifts["TransectID"].min(),avg_shifts["TransectID"].max())
    ax.set_ylim(-y_limit, y_limit)
    ax.set_facecolor("white")
    plt.tight_layout()
    save_path_comb = os.path.join(output_folder, f"avg_shift_with_std_{side}.png")
    plt.savefig(save_path_comb,dpi=600,bbox_inches="tight",facecolor="white")
    plt.close()
    print(f"📊 Average Shift saved at: {save_path_comb}")

# =========================================================
# Historical STATISTICS GENERATION
# =========================================================
def generate_historical_statistics(compiled_df, output_folder, reference_year=None, side='L'):
    os.makedirs(output_folder, exist_ok=True)
    # -----------------------------------------------------
    # EXTRACT SHIFT COLUMNS
    # -----------------------------------------------------
    shift_cols = sorted(
        [c for c in compiled_df.columns if c.startswith("shift_")],
        key=lambda x: int(x.split("_")[1])
    )
    years = [int(c.split("_")[1]) for c in shift_cols]
    # -----------------------------------------------------
    # TRANSECT-WISE STATISTICS
    # -----------------------------------------------------
    transect_stats = []
    for _, row in compiled_df.iterrows():
        tid = row["transect_id"]
        vals = row[shift_cols].values.astype(float)
        vals = vals[~np.isnan(vals)]
        if len(vals) == 0:
            continue
        # --------------------------------------------
        # Sequential Change
        # --------------------------------------------
        sequential_change = np.diff(vals)
        # --------------------------------------------
        # Cumulative Change
        # --------------------------------------------
        #cumulative_change = vals - vals[0]
        # =====================================================
        # STATISTICS
        # =====================================================
        nbm = vals[-1] - vals[0]
        time_span = years[len(vals)-1] - years[0]
        nbmr = nbm / time_span if time_span > 0 else np.nan
        bmc = np.max(vals) - np.min(vals)
        # -----------------------------------------------------
        # LRR & LSE
        # -----------------------------------------------------
        if len(vals) >= 2:
            reg = linregress(years[:len(vals)], vals)
            lrr = reg.slope
            lse = reg.stderr
        else:
            lrr = np.nan
            lse = np.nan
        # =====================================================
        # SEQUENTIAL METRICS
        # =====================================================
        if len(sequential_change) > 0:
            total_shift_movement = np.sum(np.abs(sequential_change))
            net_shift_movement = np.sum(sequential_change)
            mean_movement = np.mean(sequential_change)
            sequential_sd = np.std(sequential_change)
            max_erosion = np.min(sequential_change)
            max_accretion = np.max(sequential_change)
            erosion_frequency = (
                np.sum(sequential_change < 0)
                / len(sequential_change)
            ) * 100
            accretion_frequency = (
                np.sum(sequential_change > 0)
                / len(sequential_change)
            ) * 100
        else:
            total_shift_movement = np.nan
            net_shift_movement = np.nan
            mean_movement = np.nan
            sequential_sd = np.nan
            max_erosion = np.nan
            max_accretion = np.nan
            erosion_frequency = np.nan
            accretion_frequency = np.nan
        # =====================================================
        # COEFFICIENT OF VARIATION
        # =====================================================
        cv = (
            np.std(vals) / np.abs(np.mean(vals))
        ) * 100 if np.mean(vals) != 0 else np.nan
        # =====================================================
        # TRANSECT STATISTICS
        # =====================================================
        stats_row = {
            "TransectID": tid,
            # ---------------------------------
            # Descriptive Statistics
            # ---------------------------------
            "Mean Shift": np.mean(vals),
            "Median": np.median(vals),
            "Std": np.std(vals),
            "Variance": np.var(vals),
            "Minimum": np.min(vals),
            "Maximum": np.max(vals),
            "Range": np.max(vals) - np.min(vals),
            "Skewness": skew(vals),
            "Kurtosis": kurtosis(vals),
            "RMSShift": np.sqrt(np.mean(vals**2)),
            "Mean Absolute Shift": np.mean(np.abs(vals)),
            "Coefficient of Variation": cv,
            # ---------------------------------
            # Statistics
            # ---------------------------------
            "NBM": nbm,
            "NBMR": nbmr,
            "BMC": bmc,
            "LRR": lrr,
            "LSE": lse,
            # ---------------------------------
            # Sequential Statistics
            # ---------------------------------
            "TotalShiftmovement": total_shift_movement,
            "NetShiftMovement": net_shift_movement,
            "MeanMovement": mean_movement,
            "SequentialStd": sequential_sd,
            "MeanSequentialChange":
                np.mean(np.abs(sequential_change))
                if len(sequential_change) > 0
                else np.nan,
            "MaxSequentialChange":
                np.max(np.abs(sequential_change))
                if len(sequential_change) > 0
                else np.nan,
            # ---------------------------------
            # Erosion / Accretion
            # ---------------------------------
            "MaxErosion": max_erosion,
            "MaxAccretion": max_accretion,
            "ErosionFrequency": erosion_frequency,
            "AccretionFrequency": accretion_frequency,
            "PositiveShiftCount":
                np.sum(vals > 0),
            "NegativeShiftCount":
                np.sum(vals < 0),
            "PositiveShiftPercent":
                (np.sum(vals > 0) / len(vals)) * 100,
            "NegativeShiftPercent":
                (np.sum(vals < 0) / len(vals)) * 100,
            # ---------------------------------
            # Cumulative Statistics
            # ---------------------------------
            #"TotalCumulativeShift":
                #cumulative_change[-1]
        }
        # --------------------------------------------
        # Sequential changes year-wise
        # --------------------------------------------
        for i in range(1, len(vals)):
            stats_row[
                f"Sequential_{years[i]}"
            ] = vals[i] - vals[i-1]
        # --------------------------------------------
        # Cumulative changes year-wise
        # --------------------------------------------
        #for i in range(len(vals)):
            #stats_row[
                #f"Cumulative_{years[0]}_{years[i]}"
            #] = vals[i] - vals[0]
        transect_stats.append(stats_row)
    transect_stats_df = pd.DataFrame(transect_stats)
    # -----------------------------------------------------
    # OVERALL STATISTICS
    # -----------------------------------------------------
    all_vals = compiled_df[shift_cols].values.flatten()
    all_vals = all_vals[~np.isnan(all_vals)]
    overall_stats = {
        "Mean": np.mean(all_vals),
        "Median": np.median(all_vals),
        "Std": np.std(all_vals),
        "Variance": np.var(all_vals),
        "Minimum": np.min(all_vals),
        "Maximum": np.max(all_vals),
        "Range": np.max(all_vals) - np.min(all_vals),
        "Skewness": skew(all_vals),
        "Kurtosis": kurtosis(all_vals),
        "RMS Shift": np.sqrt(np.mean(all_vals**2)),
        "Mean Absolute Shift": np.mean(np.abs(all_vals)),
        "Positive Shift Percent": (np.sum(all_vals > 0) / len(all_vals)) * 100,
        "Negative Shift Percent": (np.sum(all_vals < 0) / len(all_vals)) * 100
    }
    overall_stats_df = pd.DataFrame([overall_stats])
    # =====================================================
    # TRANSECT-WISE STATISTICS
    # =====================================================
    transect_excel = os.path.join(
        output_folder,
        "Historical_Statistics.xlsx"
    )
    with pd.ExcelWriter(transect_excel) as writer:
        transect_stats_df.to_excel(
            writer,
            sheet_name="TransectStats",
            index=False
        )
        compiled_df.to_excel(
            writer,
            sheet_name="OriginalShiftData",
            index=False
        )
    print(f"✅ Historical statistics saved:")
    print(transect_excel)

    # =====================================================
    # PLOT: Shift vs Annual Rates (NBM, NBMR, LRR)
    # =====================================================
    fig, ax1 = plt.subplots(figsize=(14, 6), dpi=150)

    # Plot NBM on left y-axis
    ax1.fill_between(
        transect_stats_df["TransectID"],
        0,
        transect_stats_df["NBM"],
        color="cyan",
        alpha=0.8,
        label="NBM (m)"
    )
    ax1.set_xlabel("Transect ID", fontweight="bold")
    ax1.set_ylabel("NBM (m)", fontweight="bold")
    ax1.tick_params(axis="y")
    
    # Grid lines for the left y-axis
    ax1.grid(axis="y", linestyle=":", color="gray", alpha=0.5)

    # Plot NBMR and LRR on right y-axis
    ax2 = ax1.twinx()
    ax2.plot(
        transect_stats_df["TransectID"],
        transect_stats_df["NBMR"],
        color="crimson",
        linewidth=1.2,
        label="NBMR (m/yr)"
    )
    ax2.plot(
        transect_stats_df["TransectID"],
        transect_stats_df["LRR"],
        color="forestgreen",
        linewidth=1.2,
        label="LRR (m/yr)"
    )
    ax2.set_ylabel("NBMR & LRR Rates (m/yr)", fontweight="bold")
    ax2.tick_params(axis="y")

    # Combine legends
    lines_1, labels_1 = ax1.get_legend_handles_labels()
    lines_2, labels_2 = ax2.get_legend_handles_labels()
    ax2.legend(
        lines_1 + lines_2,
        labels_1 + labels_2,
        loc="upper right",
        fancybox=True,
        shadow=True,
        facecolor="white",
        edgecolor="lightgray"
    )

    plt.title(f"Shift vs Annual Rates ({side})", fontweight="bold", fontsize=14)
    plt.xlim(transect_stats_df["TransectID"].min(), transect_stats_df["TransectID"].max())

    # Border
    for spine in ax1.spines.values():
        spine.set_linewidth(1.2)
        spine.set_color("black")

    save_path_rates = os.path.join(output_folder, f"shift_vs_annual_rates_{side}.png")
    plt.savefig(save_path_rates, dpi=300, bbox_inches="tight", facecolor="white")
    plt.close()
    print(f"📊 Shift vs Annual Rates saved at: {save_path_rates}")

    import matplotlib.gridspec as gridspec
    import matplotlib.lines as mlines
    import matplotlib.patches as mpatches

    # =====================================================
    # PLOT 2: River Morphology & Dynamics
    # =====================================================
    fig2 = plt.figure(figsize=(18, 7), dpi=150)
    gs = gridspec.GridSpec(2, 3, width_ratios=[25, 1, 4], height_ratios=[1, 1], wspace=0.15)
    ax_morph = fig2.add_subplot(gs[:, 0])
    cax_blue = fig2.add_subplot(gs[0, 1])
    cax_red = fig2.add_subplot(gs[1, 1])
    ax_legend = fig2.add_subplot(gs[:, 2])
    ax_legend.axis('off')

    def zscore_series(s):
        s_clean = s.dropna()
        if len(s_clean) == 0 or s_clean.std() == 0: return s
        return (s - s_clean.mean()) / s_clean.std()

    def smooth_series(s, window=15):
        return s.rolling(window=window, center=True, min_periods=1).mean()

    epr_z = zscore_series(transect_stats_df["NBMR"])
    max_ero_z = smooth_series(zscore_series(transect_stats_df["MaxErosion"]))
    max_acc_z = smooth_series(zscore_series(transect_stats_df["MaxAccretion"]))
    
    mean_shift = transect_stats_df["Mean Shift"]
    std_shift = transect_stats_df["Std"]
    mean_shift_std = mean_shift.std() if mean_shift.std() != 0 else 1
    mean_z = smooth_series((mean_shift - mean_shift.mean()) / mean_shift_std)
    std_z = smooth_series(std_shift / mean_shift_std)
    
    band_upper = mean_z + std_z
    band_lower = mean_z - std_z

    # Grey Band
    ax_morph.fill_between(
        transect_stats_df["TransectID"],
        band_lower,
        band_upper,
        color="grey",
        alpha=0.35,
        label="Mean Shift ± Std"
    )

    # Lines
    ax_morph.plot(transect_stats_df["TransectID"], max_ero_z, color="darkred", linewidth=1.2, label="Maximum Erosion", alpha=0.8)
    ax_morph.plot(transect_stats_df["TransectID"], max_acc_z, color="darkgreen", linewidth=1.2, label="Maximum Accretion", alpha=0.8)
    ax_morph.axhline(0, color="black", linewidth=1)

    # Bubbles
    max_bmc = transect_stats_df["BMC"].max()
    if pd.isna(max_bmc) or max_bmc == 0:
        max_bmc = 1
    bmc_scaled = (transect_stats_df["BMC"] / max_bmc * 200) + 10

    mask_acc = transect_stats_df["AccretionFrequency"] >= transect_stats_df["ErosionFrequency"]
    mask_ero = ~mask_acc

    sc_acc = ax_morph.scatter(
        transect_stats_df.loc[mask_acc, "TransectID"],
        epr_z[mask_acc],
        s=bmc_scaled[mask_acc],
        c=transect_stats_df.loc[mask_acc, "AccretionFrequency"],
        cmap="Blues",
        vmin=10, vmax=90,
        alpha=0.8,
        edgecolors="white",
        linewidth=0.5
    )

    sc_ero = ax_morph.scatter(
        transect_stats_df.loc[mask_ero, "TransectID"],
        epr_z[mask_ero],
        s=bmc_scaled[mask_ero],
        c=transect_stats_df.loc[mask_ero, "ErosionFrequency"],
        cmap="Reds",
        vmin=10, vmax=90,
        alpha=0.8,
        edgecolors="white",
        linewidth=0.5
    )

    # Colorbars
    cbar_acc = fig2.colorbar(sc_acc, cax=cax_blue)
    cbar_acc.set_label("Accretion Frequency (%)", fontweight="bold", fontsize=10)
    cbar_ero = fig2.colorbar(sc_ero, cax=cax_red)
    cbar_ero.set_label("Erosion Frequency (%)", fontweight="bold", fontsize=10)

    # Formatting
    ax_morph.set_xlim(transect_stats_df["TransectID"].min(), transect_stats_df["TransectID"].max())
    ax_morph.set_xlabel("Transect ID", fontweight="bold", fontsize=12)
    ax_morph.set_ylabel("Standardized NBMR", fontweight="bold", fontsize=12)
    ax_morph.grid(axis="y", linestyle=":", color="gray", alpha=0.3)

    for spine in ax_morph.spines.values():
        spine.set_linewidth(1.2)
        spine.set_color("black")

    # Legend for sizes & lines
    low_bmc = transect_stats_df["BMC"].quantile(0.25) if not transect_stats_df["BMC"].empty else 0
    med_bmc = transect_stats_df["BMC"].quantile(0.50) if not transect_stats_df["BMC"].empty else 0
    high_bmc = transect_stats_df["BMC"].quantile(0.75) if not transect_stats_df["BMC"].empty else 0

    s_low = (low_bmc / max_bmc * 200) + 10
    s_med = (med_bmc / max_bmc * 200) + 10
    s_high = (high_bmc / max_bmc * 200) + 10

    h_low = ax_morph.scatter([], [], s=s_low, color='darkgrey', alpha=0.6, label=f"Low BMC ({low_bmc:.1f})")
    h_med = ax_morph.scatter([], [], s=s_med, color='darkgrey', alpha=0.6, label=f"Medium BMC ({med_bmc:.1f})")
    h_high = ax_morph.scatter([], [], s=s_high, color='darkgrey', alpha=0.6, label=f"High BMC ({high_bmc:.1f})")
    h_ero = mlines.Line2D([], [], color="darkred", linewidth=2, label="Maximum Erosion")
    h_acc = mlines.Line2D([], [], color="darkgreen", linewidth=2, label="Maximum Accretion")
    h_band = mpatches.Patch(color='grey', alpha=0.35, label='Mean Shift ± Std')

    ax_legend.legend(handles=[h_low, h_med, h_high, h_ero, h_acc, h_band],
              title="Legend", loc="center left", frameon=True, fancybox=True, shadow=True, borderpad=1, labelspacing=1.5)

    # Add Titles
    plt.suptitle(f"River Morphology & Dynamics Along River Bank ({side})", fontweight="bold", fontsize=16, y=0.96)
    ax_morph.set_title("Bubble Position = Standardized NBMR  |  Bubble Size = BMC  |  Bubble Colour = Dominant Frequency  |  Grey Band = Mean Shift ± Std", 
                 fontsize=10, color="gray", pad=10)

    save_path_morph = os.path.join(output_folder, f"river_morphology_dynamics_{side}.png")
    plt.savefig(save_path_morph, dpi=300, bbox_inches="tight", facecolor="white")
    plt.close()
    print(f"📊 River Morphology & Dynamics saved at: {save_path_morph}")

    # =====================================================
    # PLOT 3: LRR Distribution by Transect (Violin Plot)
    # =====================================================
    import matplotlib.colors as mcolors
    import matplotlib.patches as mpatches

    with plt.style.context('ggplot'):
        fig3, ax3 = plt.subplots(figsize=(14, 8), dpi=150)
        
        # Prepare data
        df_lrr = transect_stats_df.dropna(subset=['LRR', 'TransectID']).copy()
        
        if not df_lrr.empty:
            # 1. Dynamic Binning for Transects
            min_tid = df_lrr["TransectID"].min()
            max_tid = df_lrr["TransectID"].max()
            
            if max_tid == min_tid:
                bin_edges = [min_tid, min_tid + 1]
                bin_labels = [f"{int(min_tid)}"]
            else:
                num_bins = min(6, int(max_tid - min_tid))
                bin_edges = np.linspace(min_tid, max_tid, num_bins + 1)
                bin_edges = np.unique(np.round(bin_edges))
                num_bins = len(bin_edges) - 1
                bin_edges[-1] += 1
                
                bin_labels = []
                for i in range(num_bins):
                    start = int(bin_edges[i])
                    if i == num_bins - 1:
                        end = int(max_tid)
                    else:
                        end = int(bin_edges[i+1]) - 1
                    
                    if start == end:
                        bin_labels.append(f"{start}")
                    else:
                        bin_labels.append(f"{start}-{end}")
            
            df_lrr["Bin"] = pd.cut(df_lrr["TransectID"], bins=bin_edges, labels=bin_labels, right=False)
            
            # Extract data for violins
            violin_data = []
            valid_labels = []
            positions = []
            pos = 1
            for label in bin_labels:
                group_data = df_lrr[df_lrr["Bin"] == label]["LRR"].values
                if len(group_data) > 0:
                    violin_data.append(group_data)
                    valid_labels.append(label)
                    positions.append(pos)
                pos += 1

            if violin_data:
                parts = ax3.violinplot(violin_data, positions=positions, showmeans=False, showextrema=False, showmedians=False, widths=0.7)
                
                # Color the violins
                v_colors = plt.get_cmap("Pastel2")(np.linspace(0, 1, len(parts['bodies'])))
                for pc, color in zip(parts['bodies'], v_colors):
                    pc.set_facecolor(color)
                    pc.set_edgecolor('black')
                    pc.set_alpha(0.7)
                    pc.set_linewidth(1.2)

                # Prepare colormap for scatter
                lrr_min = df_lrr["LRR"].min()
                lrr_max = df_lrr["LRR"].max()
                # Ensure a valid range even if all values are the same
                if lrr_min == lrr_max:
                    lrr_min -= 1
                    lrr_max += 1
                    
                bounds = np.linspace(lrr_min, lrr_max, 9)
                cmap_scatter = plt.get_cmap("RdYlGn", 8)
                norm = mcolors.BoundaryNorm(bounds, cmap_scatter.N)

                for i, (group_data, p) in enumerate(zip(violin_data, positions)):
                    jitter = np.random.uniform(-0.15, 0.15, size=len(group_data))
                    x_pos = p + jitter
                    ax3.scatter(x_pos, group_data, c=group_data, cmap=cmap_scatter, norm=norm, 
                                s=15, edgecolors='black', linewidths=0.3, alpha=0.9, zorder=3)

                # Axes formatting
                ax3.set_xticks(positions)
                ax3.set_xticklabels(valid_labels)
                ax3.set_xlabel("Transect ID", fontweight="bold", fontsize=11)
                ax3.set_ylabel(r"LRR (m yr$^{-1}$)", fontweight="bold", fontsize=11)
                ax3.set_title(f"LRR Distribution by Transect ({side})", fontweight="bold", fontsize=14)
                ax3.axhline(0, color="gray", linewidth=1, alpha=0.5)

                # Build Legend
                legend_patches = []
                for i in range(8):
                    b_start = int(bounds[i])
                    b_end = int(bounds[i+1])
                    if i == 0:
                        lbl = f"< {b_end}"
                    elif i == 7:
                        lbl = f"> {b_start}"
                    else:
                        lbl = f"{b_start} - {b_end}"
                    patch = mpatches.Patch(color=cmap_scatter(i), label=lbl, edgecolor='black', linewidth=0.5)
                    legend_patches.append(patch)
                
                ax3.legend(handles=legend_patches, title="LRR Class (m/yr)", bbox_to_anchor=(1.02, 1.02), loc='upper left', frameon=True, facecolor='white')

        plt.tight_layout()
        save_path_violin = os.path.join(output_folder, f"lrr_distribution_plot_{side}.png")
        plt.savefig(save_path_violin, dpi=300, bbox_inches="tight", facecolor='white')
        plt.close()
        print(f"📊 LRR Distribution (Violin) saved at: {save_path_violin}")

    # =====================================================
    # PLOT 4: Erosion / Stable / Accretion classification
    # =====================================================
    fig4 = plt.figure(figsize=(16, 5), dpi=150)
    gs4 = gridspec.GridSpec(1, 2, width_ratios=[4, 1.2], wspace=0.1)
    
    ax_main = fig4.add_subplot(gs4[0])
    ax_pie = fig4.add_subplot(gs4[1])

    stable_threshold = 1.0  # m/yr
    
    df_class = transect_stats_df.dropna(subset=['LRR', 'TransectID', 'NBMR']).copy()
    if not df_class.empty:
        x = df_class["TransectID"].values
        y = df_class["NBMR"].values
        
        mask_acc = y > stable_threshold
        mask_ero = y < -stable_threshold
        mask_stb = np.abs(y) <= stable_threshold
        
        # Use fill_between for continuous area chart look
        ax_main.fill_between(x, np.where(mask_acc, y, 0), 0, color="#27ae60", label="Accretion", step="mid")
        ax_main.fill_between(x, np.where(mask_ero, y, 0), 0, color="#c0392b", label="Erosion", step="mid")
        ax_main.fill_between(x, np.where(mask_stb, y, 0), 0, color="#95a5a6", label="Stable", step="mid")
        
        ax_main.axhline(0, color="black", linewidth=1, linestyle="--", alpha=0.7)
        
        ax_main.set_xlim(x.min(), x.max())
        ax_main.set_xlabel("TransectID", fontsize=10)
        ax_main.set_ylabel("NBMR (Normalized Bankline Movement Rate)", fontsize=10)
        ax_main.set_title(f"Erosion / Stable / Accretion classification along the river ({side})", fontsize=12)
        ax_main.grid(True, linestyle=":", color="gray", alpha=0.3)
        
        legend_elements = [
            mpatches.Patch(facecolor='#c0392b', label='Erosion'),
            mpatches.Patch(facecolor='#95a5a6', label='Stable'),
            mpatches.Patch(facecolor='#27ae60', label='Accretion')
        ]
        ax_main.legend(handles=legend_elements, loc="upper right", ncol=3, frameon=True)

        for spine in ['top', 'right']:
            ax_main.spines[spine].set_visible(False)
        for spine in ['left', 'bottom']:
            ax_main.spines[spine].set_linewidth(1.2)
            ax_main.spines[spine].set_color("black")

        # Pie chart
        sizes = [np.sum(mask_ero), np.sum(mask_stb), np.sum(mask_acc)]
        labels = ["Erosion", "Stable", "Accretion"]
        colors = ["#c0392b", "#95a5a6", "#27ae60"]
        
        sizes_f, labels_f, colors_f = [], [], []
        for s, l, c in zip(sizes, labels, colors):
            if s > 0:
                sizes_f.append(s)
                labels_f.append(l)
                colors_f.append(c)
                
        if sizes_f:
            ax_pie.pie(sizes_f, labels=labels_f, colors=colors_f, autopct='%1.1f%%', startangle=90, 
                       textprops={'fontsize': 10})
            ax_pie.axis('equal')
        ax_pie.set_title("Overall share of transects", fontsize=12)
        
        save_path_class = os.path.join(output_folder, f"erosion_accretion_classification_{side}.png")
        plt.savefig(save_path_class, dpi=300, bbox_inches="tight", facecolor="white")
        plt.close(fig4)
        print(f"📊 Erosion/Accretion Classification saved at: {save_path_class}")

    return (
        transect_stats_df,
        overall_stats_df
    )

#-------------------------Arima + XGBoost ML model started ------------------------------------------------------------------------ 

import os
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor, as_completed
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import acf, pacf
import geopandas as gpd
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points
import matplotlib.pyplot as plt

import os
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor, as_completed
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import acf, pacf
import xgboost as xgb
from xgboost.callback import EarlyStopping
# -------------------------
# Dynamic ARIMA Parameter Estimation
# -------------------------
def estimate_arima_params(series, min_obs=5):
    """
    Dynamically estimate p, d, q using AIC-driven selection.
    """
    n_obs = len(series)
    if n_obs < min_obs:
        return 1, 0, 1
    
    # Determine differencing
    try:
        p_value = adfuller(series, autolag="AIC")[1]
        if p_value > 0.05:
            d = 1
        else:
            d = 0
    except:
        d = 0
    best_aic, best_order = float("inf"), (1, d, 0)
    for p in range(0, 4):
        for q in range(0, 4):
            try:
                model = ARIMA(series, order=(p, d, q)).fit()
                if model.aic < best_aic:
                    best_aic, best_order = model.aic, (p, d, q)
            except:
                continue
    return best_order
# -------------------------
# Hybrid Smooth Forecasting
# -------------------------
def fit_and_forecast_hybrid(series, steps_local, max_shift, lag=5):
    """
    Hybrid ARIMA + XGBoost
    Forecast is governed by:
        • Historical trend (ARIMA)
        • Non-linear residual learning (XGBoost)
        • Adaptive trend damping
        • Recent-history blending
        • Multi-stage smoothing
    """
    n = len(series)
    if n < (lag + 6):
        return np.full(steps_local, series.mean())
    # =====================================================
    # ARIMA
    # =====================================================
    p, d, q = estimate_arima_params(series)
    arima_model = ARIMA(
        series,
        order=(p, d, q),
        enforce_stationarity=False,
        enforce_invertibility=False
    ).fit()
    arima_fitted = arima_model.fittedvalues
    # =====================================================
    # Residuals
    # =====================================================
    residuals = series.values - arima_fitted.values
    res_df = pd.DataFrame({"res": residuals})
    res_df.replace([np.inf, -np.inf], np.nan, inplace=True)
    # XGBoost float32 protection: values > 3.4e38 break it. We cap absurdly large values.
    res_df.loc[res_df["res"].abs() > 1e15, "res"] = np.nan
    
    for i in range(1, lag + 1):
        res_df[f"lag_{i}"] = res_df["res"].shift(i)
    # =====================================================
    # Feature Engineering
    # =====================================================
    res_df["volatility"] = (
        res_df["res"]
        .rolling(lag)
        .std()
        .fillna(0)
    )
    res_df["roll_mean"] = (
        res_df["res"]
        .rolling(lag)
        .mean()
        .fillna(0)
    )
    res_df["roll_skew"] = (
        res_df["res"]
        .rolling(lag)
        .skew()
        .fillna(0)
    )
    res_train = res_df.dropna()
    if len(res_train) < 5:
        forecast = arima_model.forecast(steps_local).values
        if np.any(np.isnan(forecast)) or np.any(np.isinf(forecast)) or np.any(np.abs(forecast) > 1e15):
            forecast = np.full(steps_local, np.clip(series.mean(), -1e15, 1e15))
        return np.clip(forecast, -max_shift, max_shift)
    X_res = res_train.drop(columns=["res"])
    y_res = res_train["res"]
    # =====================================================
    # XGBoost
    # =====================================================
    xgb_res_model = xgb.XGBRegressor(
        n_estimators=200,
        learning_rate=0.04,
        max_depth=3,
        min_child_weight=5,
        subsample=0.80,
        colsample_bytree=0.80,
        reg_alpha=2.0,
        reg_lambda=5.0,
        gamma=0.20,
        objective="reg:squarederror",
        tree_method="hist",
        n_jobs=1,
        random_state=42
    )
    xgb_res_model.fit(X_res, y_res)
    # =====================================================
    # ARIMA Forecast
    # =====================================================
    arima_forecast = arima_model.forecast(steps=steps_local).values
    if np.any(np.isnan(arima_forecast)) or np.any(np.isinf(arima_forecast)) or np.any(np.abs(arima_forecast) > 1e15):
        arima_forecast = np.full(steps_local, np.clip(series.mean(), -1e15, 1e15))
    # =====================================================
    # Recursive Residual Forecast
    # =====================================================
    curr_feat = res_df.iloc[-1:].drop(columns=["res"]).copy()
    res_forecasts = []
    for _ in range(steps_local):
        res_pred = xgb_res_model.predict(curr_feat)[0]
        res_limit = max(0.15 * np.std(series), 1e-6)
        res_pred = np.clip(
            res_pred,
            -res_limit,
            res_limit
        )
        if len(res_forecasts) > 0:
            res_pred = (
                0.95 * res_forecasts[-1] +
                0.05 * res_pred
            )
        res_forecasts.append(res_pred)
        for i in range(lag, 1, -1):
            curr_feat[f"lag_{i}"] = curr_feat[f"lag_{i-1}"]
        curr_feat["lag_1"] = res_pred
        vals = (
            res_forecasts[-lag:]
            if len(res_forecasts) >= lag
            else res_forecasts
        )
        curr_feat["volatility"] = np.std(vals)
        curr_feat["roll_mean"] = np.mean(vals)
        curr_feat["roll_skew"] = (
            pd.Series(vals).skew()
            if len(vals) > 2
            else 0
        )
    # =====================================================
    # Hybrid Combination
    # =====================================================
    residual_weight = 0.08
    final_forecast = (
        arima_forecast +
        residual_weight * np.array(res_forecasts)
    )
    # =====================================================
    # Historical Trend Adjustment
    # =====================================================
    if len(series) >= 5:
        recent_trend = np.polyfit(
            np.arange(5),
            series.iloc[-5:],
            1
        )[0]
        final_forecast += 0.05 * recent_trend
    # =====================================================
    # Adaptive Trend Damping
    # =====================================================
    variability = np.std(np.diff(series))
    damping = np.exp(
        -variability /
        (np.std(series) + 1e-6)
    )
    final_forecast = (
        damping * final_forecast +
        (1 - damping) * arima_forecast
    )
    # =====================================================
    # Recent-History smoothing
    # =====================================================
    recent_reference = (
        0.99 * series.iloc[-1] +
        0.01 * series.iloc[-2]
    )
    blend_weight = 0.25
    final_forecast = (
        (1 - blend_weight) * final_forecast +
        blend_weight * recent_reference
    )
    # =====================================================
    # Exponential Smoothing
    # =====================================================
    alpha = 0.10
    smooth = [final_forecast[0]]
    for i in range(1, len(final_forecast)):
        smooth.append(
            alpha * final_forecast[i] +
            (1 - alpha) * smooth[-1]
        )
    final_forecast = np.array(smooth)
    # =====================================================
    # Moving Average Smoothing
    # =====================================================
    if len(final_forecast) > 2:
        final_forecast = (
            pd.Series(final_forecast)
            .rolling(5, center=True, min_periods=1)
            .mean()
            .values
        )
    # =====================================================
    # Spike Suppression
    # =====================================================
    max_step = max(
        np.std(np.diff(series)) * 1.0,
        0.5
    )
    for i in range(1, len(final_forecast)):
        diff = final_forecast[i] - final_forecast[i - 1]
        if abs(diff) > max_step:
            final_forecast[i] = (
                final_forecast[i - 1] +
                np.sign(diff) * max_step
            )
    # =====================================================
    # Historical Range Constraint
    # =====================================================
    hist_mean = np.mean(series)
    hist_std = np.std(series)
    lower = hist_mean - 2.5 * hist_std
    upper = hist_mean + 2.5 * hist_std

    final_forecast = np.clip(
        final_forecast,
        lower,
        upper
    )
    # =====================================================
    # Final forecast
    # =====================================================
    max_abs = np.nanmax(np.abs(series))
    final_forecast = np.clip(
        final_forecast,
        -max_abs * 1.5,
        max_abs * 1.5
    )
    final_forecast = (
        pd.Series(final_forecast)
        .ewm(alpha=0.20, adjust=False)
        .mean()
        .values
    )
    return final_forecast

# -------------------------
# Single-transect Process (Variables Preserved)
# -------------------------
def process_transect_safe_from_csv(transect_id, pivot_df, steps, pqd_df):
    series_full = pivot_df[transect_id].dropna()
    if len(series_full) < 5:
        return transect_id, None

    # Extreme geometry intersections can cause astronomical shift values. Cap them.
    max_shift = np.clip(np.nanmax(series_full.values), 0, 1e10)

    m = None
    fc_list = []
    for k in [1, 2]:
        L = len(series_full) // k
        if L >= 6:
            fc_list.append(fit_and_forecast_hybrid(series_full.iloc[-L:], steps, max_shift))
    if fc_list:
        m = np.median(np.vstack(fc_list), axis=0)

    return transect_id, m

# -------------------------
# Main Parallel Function (Outputs Preserved)
# -------------------------
def predict_shifts_parallel_safe(df_shift, steps=2, output_folder=None,
                                 min_obs=9, max_workers=None, start_year=None, end_year=None, side='L'):
    def extract_year(col): return int(str(col).split("_")[-1])
    year_cols = [c for c in df_shift.columns if c.startswith("shift_")]
    if start_year: year_cols = [c for c in year_cols if extract_year(c) >= start_year]
    if end_year: year_cols = [c for c in year_cols if extract_year(c) <= end_year]

    df_filtered = df_shift[["transect_id"] + year_cols].copy()
    melt_df = df_filtered.melt(id_vars="transect_id", var_name="year", value_name="shift")
    melt_df["year"] = melt_df["year"].apply(lambda x: int(str(x).split("_")[-1]))
    melt_df = melt_df.dropna(subset=["shift"])
    melt_df["date"] = pd.to_datetime(melt_df["year"], format="%Y")
    pivot_df = melt_df.pivot(index="date", columns="transect_id", values="shift").asfreq("YS")

    last_year = pivot_df.index[-1].year
    forecast_years = [last_year + i + 1 for i in range(steps)]
    pqd_dummy = pd.DataFrame({'transect_id': pivot_df.columns})

    res_M = {}
    with ProcessPoolExecutor(max_workers=max_workers) as exe:
        futures = {
            exe.submit(process_transect_safe_from_csv, tid, pivot_df, steps, pqd_dummy): tid
            for tid in pivot_df.columns
        }
        for fut in as_completed(futures):
            tid, m = fut.result()
            if m is not None: res_M[tid] = m

    def dict_to_df(res):
        if not res:
            return pd.DataFrame()
        out = pd.DataFrame.from_dict(res, orient="index",
            columns=[f"predicted_shift_{y}" for y in forecast_years]
        ).reset_index().rename(columns={"index": "transect_id"})
        out["transect_id"] = out["transect_id"].astype(int)
        return out

    results = {"M": dict_to_df(res_M)}

    # -------------------------------------------------
    # Spatial smoothing across neighbouring transects
    # -------------------------------------------------
    for name, df in results.items():

        if df.empty:
            continue

        df = df.sort_values("transect_id").reset_index(drop=True)

        pred_cols = [c for c in df.columns if c.startswith("predicted_shift_")]

        for col in pred_cols:

            # First smoothing
            df[col] = (
                df[col]
                .rolling(window=9, center=True, min_periods=1)
                .mean()
            )

            # Second smoothing
            df[col] = (
                df[col]
                .rolling(window=5, center=True, min_periods=1)
                .mean()
            )

        results[name] = df

    if output_folder:
        os.makedirs(output_folder, exist_ok=True)
        for name, df in results.items():
            if not df.empty:
                df.to_csv(os.path.join(output_folder, f"predicted_shift_{name}_{side}.csv"), index=False)

    return results

# -------------------------
# Form Map for Predicted Banklines
# -------------------------
import os
import geopandas as gpd
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from shapely.geometry import Point, LineString
from shapely.ops import nearest_points
    
def form_map(
    df_preds_dict,
    transects_gdf,
    baseline_gdf,
    compiled_df,
    output_folder,
    side,
    outlier_threshold=5000,
    transect_stats_df=None,
    input_folder=None,
):
    """
    Build predicted bankline shapefiles and Pred vs Actual comparisons,
    adding error metrics: Harmonic Mean Relative Error, Median Abs Error, SMAPE.
    """

    import os
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    import geopandas as gpd
    from shapely.geometry import LineString, Point
    from shapely.ops import nearest_points
    from matplotlib_scalebar.scalebar import ScaleBar         
    os.makedirs(output_folder, exist_ok=True)
    # -------------------------------
    # Normalize IDs / columns
    # -------------------------------
    if "Transect ID" in transects_gdf.columns and "transect_id" not in transects_gdf.columns:
        transects_gdf = transects_gdf.rename(columns={"Transect ID": "transect_id"})
    if "TransectID" in compiled_df.columns and "transect_id" not in compiled_df.columns:
        compiled_df = compiled_df.rename(columns={"TransectID": "transect_id"})

    if "transect_id" not in transects_gdf.columns:
        transects_gdf = transects_gdf.copy()
        transects_gdf["transect_id"] = range(1, len(transects_gdf) + 1)

    # Match CRS
    if baseline_gdf.crs != transects_gdf.crs:
        baseline_gdf = baseline_gdf.to_crs(transects_gdf.crs)

    transects_gdf = transects_gdf.sort_values("transect_id").reset_index(drop=True)
    baseline_union = baseline_gdf.geometry.unary_union

    direction = -1 if side.upper() == "L" else 1
    # -------------------------------
    # Extract available actual and predicted years
    # -------------------------------
    shift_cols = [c for c in compiled_df.columns if c.startswith("shift_")]
    actual_years = sorted(int(c.split("_")[-1]) for c in shift_cols) if shift_cols else []
    pred_years_all = sorted({
        int(c.split("_")[-1])
        for df in df_preds_dict.values()
        if df is not None and not df.empty
        for c in df.columns
        if c.startswith("predicted_shift_")
    })
    years_to_check = sorted(set(actual_years).intersection(pred_years_all))
    print(f"Predicted years available: {pred_years_all}")
   
    # -------------------------------
    # Helper functions
    # -------------------------------
    
    def intersection_point_on_transect(tran, baseline):
        inter = tran.intersection(baseline)
        if inter.is_empty:
            inter_on_tran, _ = nearest_points(tran, baseline)
            return inter_on_tran
        if isinstance(inter, Point):
            return inter
        pts = [g for g in getattr(inter, "geoms", []) if isinstance(g, Point)]
        if pts:
            start_pt = Point(list(tran.coords)[0])
            return min(pts, key=lambda p: p.distance(start_pt))
        inter_on_tran, _ = nearest_points(tran, baseline)
        return inter_on_tran

    def build_predicted_line(df_pred, year):
        col = f"predicted_shift_{year}"
        if col not in df_pred.columns:
            return None, None
        pts, used_tids = [], []
        for _, row in transects_gdf.iterrows():
            tid = int(row["transect_id"])
            tran = row.geometry
            cell = df_pred.loc[df_pred["transect_id"] == tid, col]
            if cell.empty or pd.isna(cell.iloc[0]):
                continue
            shift_val = float(cell.iloc[0])
            if abs(shift_val) > outlier_threshold:
                continue
            inter = intersection_point_on_transect(tran, baseline_union)
            s0 = tran.project(inter)
            target_s = max(0.0,min(tran.length,s0 + direction * shift_val))
            pts.append(tran.interpolate(target_s))
            used_tids.append(tid)
        if len(pts) < 2:
            return None, None
        return LineString(pts), used_tids

    def harmonic_mean_positive(arr):
        arr = np.asarray([x for x in arr if np.isfinite(x) and x > 0])
        if arr.size == 0:
            return np.nan
        return arr.size / np.sum(1.0 / arr)

    def smape(y_true, y_pred):
        y_true, y_pred = np.array(y_true), np.array(y_pred)
        denom = (np.abs(y_true) + np.abs(y_pred)) / 2.0
        mask = denom != 0
        return np.mean(np.abs(y_true[mask] - y_pred[mask]) / denom[mask]) * 100 if np.any(mask) else np.nan

    # --- NEW ACCURACY & EFFICIENCY METHODS ---
    def calculate_nse(actual, forecast):
        actual, forecast = np.array(actual), np.array(forecast)
        return 1 - (np.sum((actual - forecast)**2) / np.sum((actual - np.mean(actual))**2))

    def calculate_pbias(actual, forecast):
        actual, forecast = np.array(actual), np.array(forecast)
        return 100 * (np.sum(actual - forecast) / np.sum(actual))

    def calculate_kge(actual, forecast):
        actual, forecast = np.array(actual), np.array(forecast)
        if np.std(actual) == 0: return np.nan
        r = np.corrcoef(actual, forecast)[0, 1]
        alpha = np.std(forecast) / np.std(actual)
        beta = np.mean(forecast) / np.mean(actual)
        return 1 - np.sqrt((r - 1)**2 + (alpha - 1)**2 + (beta - 1)**2)
    
    def calculate_r2(actual, forecast):
       actual, forecast = np.array(actual), np.array(forecast)
       ss_res = np.sum((actual - forecast)**2)
       ss_tot = np.sum((actual - np.mean(actual))**2)
       return 1 - (ss_res / ss_tot) if ss_tot != 0 else np.nan

    def calculate_standard_error(actual, forecast):
       actual, forecast = np.array(actual), np.array(forecast)
       errors = actual - forecast
       # Degrees of freedom n-2 for shoreline change rate error
       return np.sqrt(np.sum(errors**2) / (len(errors) - 2)) if len(errors) > 2 else np.nan

    # -------------------------------
    # Metric summary table
    # -------------------------------
    metrics_list = []

    # -------------------------------
    # Iterate through models
    # -------------------------------
    for model_tag, df_pred in df_preds_dict.items():
        if df_pred is None or df_pred.empty:
            print(f"⚠ {model_tag} empty, skipping.")
            continue

        df_pred = df_pred.copy()
        df_pred["transect_id"] = df_pred["transect_id"].astype(int)

        # ---------------------------------------------------
        # ✅ Predicted Banklines Generation (Unchanged)
        # ---------------------------------------------------
        pred_cols = [c for c in df_pred.columns if c.startswith("predicted_shift_")]
        lat_lon_cols = []
        for col in pred_cols:
            year = int(col.split("_")[-1])
            predicted_points = []
            lat_col = f"latitude_{year}"
            lon_col = f"longitude_{year}"
            lat_lon_cols.extend([lat_col, lon_col])

            for _, row in transects_gdf.iterrows():
                tid = int(row["transect_id"])
                tran = row.geometry

                inter = tran.intersection(baseline_union)
                if inter.is_empty:
                    inter_on_tran, _ = nearest_points(tran, baseline_union)
                    inter = inter_on_tran

                if inter.geom_type in ('MultiPoint', 'GeometryCollection'):
                    pts = [g for g in getattr(inter, 'geoms', []) if isinstance(g, Point)]
                    if not pts:
                        inter_on_tran, _ = nearest_points(tran, baseline_union)
                        inter = inter_on_tran
                    else:
                        start_pt = Point(list(tran.coords)[0])
                        inter = min(pts, key=lambda p: p.distance(start_pt))

                if not isinstance(inter, Point):
                    inter_on_tran, _ = nearest_points(tran, baseline_union)
                    inter = inter_on_tran



                cell = df_pred.loc[df_pred["transect_id"] == tid, col]
                if cell.empty or pd.isna(cell.iloc[0]):
                    continue
                shift_val = float(cell.iloc[0])

                s0 = tran.project(inter)
                target_s = max(0.0,min(tran.length,s0 + direction * shift_val))
                predicted_point = tran.interpolate(target_s)
                predicted_points.append(predicted_point)
                
                pt_4326 = gpd.GeoSeries([predicted_point], crs=transects_gdf.crs).to_crs(epsg=4326).iloc[0]
                df_pred.loc[df_pred["transect_id"] == tid, lat_col] = pt_4326.y
                df_pred.loc[df_pred["transect_id"] == tid, lon_col] = pt_4326.x

            if len(predicted_points) < 2:
                print(f"⚠️ Not enough predicted points ({len(predicted_points)}) for {year}{side} in {model_tag}; skipping shapefile.")
                continue

            line = LineString(predicted_points)
            gdf_out = gpd.GeoDataFrame({'year': [year], 'side': [side], 'model': [model_tag]},
                                       geometry=[line], crs=transects_gdf.crs)

            shp_name = f"predicted_bankline_{year}{side}_bank.shp"
            out_path = os.path.join(output_folder, shp_name)
            gdf_out.to_file(out_path)
            try:
                gdf_out.to_crs(epsg=4326).to_file(out_path.replace('.shp', '.geojson'), driver='GeoJSON')
            except Exception as geo_e:
                print(f"Failed to save GeoJSON: {geo_e}")
            print(f"✅ Saved {out_path}")

            

            # Predicted vs Actual Bankline Map
            # Search for actual bankline in output_folder first, then input_folder
            actual_shp = os.path.join(output_folder, f"{year}{side}.shp")
            if not os.path.exists(actual_shp) and input_folder:
                actual_shp = os.path.join(input_folder, f"{year}{side}.shp")
            if os.path.exists(actual_shp):
                actual_gdf = gpd.read_file(actual_shp)
                if actual_gdf.crs != transects_gdf.crs:
                    actual_gdf = actual_gdf.to_crs(transects_gdf.crs)

                # Reproject to WGS84 for degree-labelled map
                actual_plot    = actual_gdf.to_crs(epsg=4326)
                pred_plot_cmp  = gdf_out.to_crs(epsg=4326)
                trans_plot_cmp = transects_gdf.to_crs(epsg=4326)

                fig_cmp, ax_cmp = plt.subplots(figsize=(12, 8))
                fig_cmp.patch.set_facecolor('white')
                ax_cmp.set_facecolor('white')
                trans_plot_cmp.plot(ax=ax_cmp, color="gray", linewidth=0.4, alpha=0.5, label="Transects")
                actual_plot.plot(ax=ax_cmp, color="green", linewidth=2, label=f"Actual {year}")
                pred_plot_cmp.plot(ax=ax_cmp, color="red", linewidth=2, label=f"Predicted {year}")

                # Coordinate grid & labels
                ax_cmp.grid(True, linestyle="--", linewidth=0.5, color="gray", alpha=0.5)
                ax_cmp.tick_params(labelsize=10)
                ax_cmp.set_xlabel("Longitude")
                ax_cmp.set_ylabel("Latitude")

                import matplotlib.ticker as mticker
                ax_cmp.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.2f}°E"))
                ax_cmp.yaxis.set_major_formatter(mticker.FuncFormatter(lambda y, _: f"{y:.2f}°N"))

                # Scale bar
                import math as _math
                mean_lat_cmp  = actual_gdf.centroid.to_crs(epsg=4326).y.mean() if not actual_gdf.empty else 0
                dx_meters_cmp = 111320 * _math.cos(_math.radians(mean_lat_cmp))
                scalebar_cmp  = ScaleBar(dx_meters_cmp, location="lower left", box_alpha=0.8, length_fraction=0.25)
                ax_cmp.add_artist(scalebar_cmp)

                # North arrow
                ax_cmp.annotate(
                    'N',
                    xy=(0.94, 0.98), xytext=(0.94, 0.85),
                    xycoords='axes fraction',
                    arrowprops=dict(facecolor='black', width=4, headwidth=12),
                    ha='center', va='center', fontsize=16, fontweight='bold'
                )

                ax_cmp.legend(loc="upper right", bbox_to_anchor=(0.98, 0.83),
                              frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)
                ax_cmp.set_title(f"Predicted vs Actual Bankline {year} ({side})", fontsize=15, fontweight="bold")
                for spine in ax_cmp.spines.values():
                    spine.set_linewidth(1.5)
                ax_cmp.set_aspect("equal")
                plt.tight_layout()

                cmp_png = os.path.join(output_folder, f"predicted_vs_actual_bankline_{year}{side}.png")
                plt.savefig(cmp_png, dpi=600, bbox_inches="tight", facecolor='white')
                plt.close()
                print(f"✅ Saved Predicted vs Actual Bankline Map: {cmp_png}")
            else:
                print(f"⚠ Actual bankline for {year}{side} not found; skipping comparison map.")

        # Reorder and save CSV with lat/lon
        cols = ["transect_id"] + lat_lon_cols + [c for c in df_pred.columns if c not in ["transect_id"] + lat_lon_cols]
        df_pred = df_pred[cols]
        if output_folder:
            import os
            csv_path = os.path.join(output_folder, f"predicted_shift_{model_tag}_{side}.csv")
            df_pred.to_csv(csv_path, index=False)
            print(f"Updated {csv_path} with lat/lon columns.")

        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        fig.patch.set_facecolor('white')
        ax.set_facecolor('white')
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        custom_handles = None
        custom_title = None
        if transect_stats_df is not None:
            import matplotlib.colors as mcolors
            import matplotlib.patches as mpatches
            import matplotlib.lines as mlines
            
            temp_gdf = transects_plot.copy()
            if 'LRR' in temp_gdf.columns:
                temp_gdf = temp_gdf.drop(columns=['LRR'])
            if 'TransectID' in temp_gdf.columns:
                temp_gdf = temp_gdf.drop(columns=['TransectID'])
                
            temp_gdf = temp_gdf.merge(transect_stats_df[['TransectID', 'LRR']], left_on='transect_id', right_on='TransectID', how='left')
            
            lrr_min = temp_gdf['LRR'].min()
            lrr_max = temp_gdf['LRR'].max()
            if pd.isna(lrr_min) or pd.isna(lrr_max):
                lrr_min, lrr_max = -100, 100
            if lrr_min == lrr_max:
                lrr_min -= 1
                lrr_max += 1
                
            bounds = np.linspace(lrr_min, lrr_max, 9)
            cmap_scatter = plt.get_cmap("RdYlGn", 8)
            norm = mcolors.BoundaryNorm(bounds, cmap_scatter.N)
            
            # Thick lines for transects to resemble colored regions
            temp_gdf.plot(ax=ax, column='LRR', cmap=cmap_scatter, norm=norm, linewidth=7, alpha=0.9, zorder=1)
            
            # Plot predicted line on top in blue
            gdf_out_plot.plot(ax=ax, color="#1f77b4", linewidth=2.5, label=f"Bankline {year}", zorder=2)
            
            legend_patches = []
            legend_patches.append(mlines.Line2D([], [], color="#1f77b4", linewidth=2.5, label=f"Bankline {year}"))
            for i in range(8):
                b_start = int(bounds[i])
                b_end = int(bounds[i+1])
                if i == 0:
                    lbl = f"< {b_end}"
                elif i == 7:
                    lbl = f"> {b_start}"
                else:
                    lbl = f"{b_start} - {b_end}"
                patch = mpatches.Patch(color=cmap_scatter(i), label=lbl)
                legend_patches.append(patch)
            
            custom_handles = legend_patches
            custom_title = "LRR (m/yr)"
            
        else:
            baseline_plot.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
            transects_plot.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
            gdf_out_plot.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")
    
            
        # Coordinate Grid
        ax.grid(True,linestyle="--",linewidth=0.5,color="gray",alpha=0.5)
        ax.tick_params(labelsize=10)
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        
        import matplotlib.ticker as ticker
        def format_lon(x, pos):
            return f"{x:.2f}°E"
        def format_lat(y, pos):
            return f"{y:.2f}°N"
            
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_lon))
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_lat))
        
        # Scale Bar adjusted for Geographic degrees
        import math
        mean_lat = baseline_gdf.centroid.to_crs(epsg=4326).y.mean() if not baseline_gdf.empty else 0
        dx_meters = 111320 * math.cos(math.radians(mean_lat))
        scalebar = ScaleBar(dx_meters, location="lower left", box_alpha=0.8, length_fraction=0.25)
        ax.add_artist(scalebar)
        # North Arrow
        ax.annotate('N',xy=(0.94, 0.98),xytext=(0.94, 0.85),xycoords='axes fraction',arrowprops=dict(facecolor='black',width=4,headwidth=12),
            ha='center',
            va='center',
            fontsize=16,
            fontweight='bold'
        )
        if custom_handles:
            # Place legend right below the north arrow
            ax.legend(handles=custom_handles, title=custom_title, loc="upper right", bbox_to_anchor=(0.98, 0.83), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)
        else:
            ax.legend(loc="upper right", bbox_to_anchor=(0.98, 0.83), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)

        ax.set_title(f"Predicted Bankline {year} ({side})",fontsize=15,fontweight="bold")
        # Map Frame
        for spine in ax.spines.values():
            spine.set_linewidth(1.5)
        ax.set_aspect("equal")
        plt.tight_layout()
        png_path = os.path.join(output_folder,f"predicted_bankline_{year}{side}_bank_with_lrr.png")
        plt.savefig(png_path,dpi=600,bbox_inches="tight", facecolor='white')
        plt.close()

        # =====================================================
        # Simple Bankline Map (No LRR)
        # Reorder and save CSV with lat/lon
        cols = ["transect_id"] + lat_lon_cols + [c for c in df_pred.columns if c not in ["transect_id"] + lat_lon_cols]
        df_pred = df_pred[cols]
        if output_folder:
            import os
            csv_path = os.path.join(output_folder, f"predicted_shift_{model_tag}_{side}.csv")
            df_pred.to_csv(csv_path, index=False)
            print(f"Updated {csv_path} with lat/lon columns.")

        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        fig.patch.set_facecolor('white')
        ax.set_facecolor('white')
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        custom_handles = None
        custom_title = None
        if False:
            import matplotlib.colors as mcolors
            import matplotlib.patches as mpatches
            import matplotlib.lines as mlines
            
            temp_gdf = transects_plot.copy()
            if 'LRR' in temp_gdf.columns:
                temp_gdf = temp_gdf.drop(columns=['LRR'])
            if 'TransectID' in temp_gdf.columns:
                temp_gdf = temp_gdf.drop(columns=['TransectID'])
                
            temp_gdf = temp_gdf.merge(transect_stats_df[['TransectID', 'LRR']], left_on='transect_id', right_on='TransectID', how='left')
            
            lrr_min = temp_gdf['LRR'].min()
            lrr_max = temp_gdf['LRR'].max()
            if pd.isna(lrr_min) or pd.isna(lrr_max):
                lrr_min, lrr_max = -100, 100
            if lrr_min == lrr_max:
                lrr_min -= 1
                lrr_max += 1
                
            bounds = np.linspace(lrr_min, lrr_max, 9)
            cmap_scatter = plt.get_cmap("RdYlGn", 8)
            norm = mcolors.BoundaryNorm(bounds, cmap_scatter.N)
            
            # Thick lines for transects to resemble colored regions
            temp_gdf.plot(ax=ax, column='LRR', cmap=cmap_scatter, norm=norm, linewidth=7, alpha=0.9, zorder=1)
            
            # Plot predicted line on top in blue
            gdf_out_plot.plot(ax=ax, color="#1f77b4", linewidth=2.5, label=f"Bankline {year}", zorder=2)
            
            legend_patches = []
            legend_patches.append(mlines.Line2D([], [], color="#1f77b4", linewidth=2.5, label=f"Bankline {year}"))
            for i in range(8):
                b_start = int(bounds[i])
                b_end = int(bounds[i+1])
                if i == 0:
                    lbl = f"< {b_end}"
                elif i == 7:
                    lbl = f"> {b_start}"
                else:
                    lbl = f"{b_start} - {b_end}"
                patch = mpatches.Patch(color=cmap_scatter(i), label=lbl)
                legend_patches.append(patch)
            
            ax.legend(handles=legend_patches, title="Legend\\nLRR (m/yr)", loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=True, facecolor="white", edgecolor="black")
            
        else:
            baseline_plot.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
            transects_plot.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
            gdf_out_plot.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")
    
            
        # Coordinate Grid
        ax.grid(True,linestyle="--",linewidth=0.5,color="gray",alpha=0.5)
        ax.tick_params(labelsize=10)
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        
        import matplotlib.ticker as ticker
        def format_lon(x, pos):
            return f"{x:.2f}°E"
        def format_lat(y, pos):
            return f"{y:.2f}°N"
            
        ax.xaxis.set_major_formatter(ticker.FuncFormatter(format_lon))
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(format_lat))
        
        # Scale Bar adjusted for Geographic degrees
        import math
        mean_lat = baseline_gdf.centroid.to_crs(epsg=4326).y.mean() if not baseline_gdf.empty else 0
        dx_meters = 111320 * math.cos(math.radians(mean_lat))
        scalebar = ScaleBar(dx_meters, location="lower left", box_alpha=0.8, length_fraction=0.25)
        ax.add_artist(scalebar)
        # North Arrow
        ax.annotate('N',xy=(0.94, 0.98),xytext=(0.94, 0.85),xycoords='axes fraction',arrowprops=dict(facecolor='black',width=4,headwidth=12),
            ha='center',
            va='center',
            fontsize=16,
            fontweight='bold'
        )
        if custom_handles:
            # Place legend right below the north arrow
            ax.legend(handles=custom_handles, title=custom_title, loc="upper right", bbox_to_anchor=(0.98, 0.83), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)
        else:
            ax.legend(loc="upper right", bbox_to_anchor=(0.98, 0.83), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)

        ax.set_title(f"Predicted Bankline vs Baseline {year} ({side})",fontsize=15,fontweight="bold")
        # Map Frame
        for spine in ax.spines.values():
            spine.set_linewidth(1.5)
        ax.set_aspect("equal")
        plt.tight_layout()
        png_path = os.path.join(output_folder,f"predicted_bankline_with_baseline_{year}{side}.png")
        plt.savefig(png_path,dpi=600,bbox_inches="tight", facecolor='white')
        plt.close()

        # ---------------------------------------------------
        # ✅ Metric Computation (Unchanged variables + New metrics)
        # ---------------------------------------------------
        for year in years_to_check:
            actual_col = f"shift_{year}"
            pred_col = f"predicted_shift_{year}"
            if actual_col not in compiled_df.columns or pred_col not in df_pred.columns:
                continue

            j = pd.merge(
                df_pred[["transect_id", pred_col]],
                compiled_df[["transect_id", actual_col]],
                on="transect_id",
                how="inner",
            ).dropna()

            j = j[
                (j[pred_col].abs() <= outlier_threshold)
                & (j[actual_col].abs() <= outlier_threshold)
            ]
            if j.empty:
                continue

            rel_err = [abs(r[pred_col] - r[actual_col]) / abs(r[actual_col])
                       for _, r in j.iterrows() if abs(r[actual_col]) > 0]
            hm_err = harmonic_mean_positive(rel_err)
            medae = np.median(np.abs(j[pred_col] - j[actual_col]))
            smape_val = smape(j[actual_col], j[pred_col])
            nse_val = calculate_nse(j[actual_col], j[pred_col])
            kge_val = calculate_kge(j[actual_col], j[pred_col])
            pbias_val = calculate_pbias(j[actual_col], j[pred_col])
            r2_val = calculate_r2(j[actual_col], j[pred_col])
            se_val = calculate_standard_error(j[actual_col], j[pred_col])

            metrics_list.append({
                "Model": model_tag,
                "Year": year,
                "Side": side,
                "HM_RelError": hm_err,
                "MedAE": medae,
                "SMAPE(%)": smape_val,
                "NSE": nse_val,
                "KGE": kge_val,
                "PBIAS(%)": pbias_val,
                "R2": r2_val,
                "StdError": se_val,
                "N": len(j)
            })

            # Plot Pred vs Actual with Extended Summary
            fig, ax = plt.subplots(figsize=(12, 6))
            ax.plot(j["transect_id"], j[actual_col], color="black", label=f"Actual {year}")
            ax.plot(j["transect_id"], j[pred_col], color="red", label=f"Predicted {year}")
            ax.axhline(0, linewidth=1, linestyle="--", color="black")
            ax.set_xlabel("Transect ID")
            ax.set_ylabel("Shift (m)")
            
            # Title including original results and new parameters
            ttl = (f"Predicted vs Actual Shift {side} {year}")
            ax.set_title(ttl)
            ax.grid(True, linestyle="--", alpha=0.5)
            ax.legend()
            plt.tight_layout()

            out_png = os.path.join(output_folder, f"predicted_vs_actual_{year}{side}_shift_plot.png")
            plt.savefig(out_png, dpi=300)
            plt.close()
            print(f"✅ Saved plot with full validation suite: {out_png}")

            # =====================================================
            # Error Plot (Predicted vs Actual)
            # =====================================================
            j["Prediction_Error"] = j[pred_col] - j[actual_col]
            rmse = np.sqrt(np.mean(j["Prediction_Error"] ** 2))
            fig, ax = plt.subplots(figsize=(12, 6))
            # Error curve
            ax.plot(j["transect_id"], j["Prediction_Error"], color="red", linewidth=2, label="Prediction Error")
            ax.axhline(0, linewidth=1, linestyle="--", color="black")
            ax.axhline(rmse, linewidth=1, linestyle=":", color="black",label="_nolegend_")
            ax.axhline(-rmse,linewidth=1,linestyle=":",color="black",label="_nolegend_")
            ax.text(j["transect_id"].iloc[-1],rmse,f"RMSE = {rmse:.2f} m",ha="right",va="bottom",fontsize=10)
            ax.text(j["transect_id"].iloc[-1],-rmse,f"RMSE = -{rmse:.2f} m",ha="right",va="top",fontsize=10)
            max_error = max(np.nanmax(np.abs(j["Prediction_Error"])),rmse)
            ax.set_ylim(-max_error, max_error)
            # Labels
            ax.set_xlabel("Transect ID")
            ax.set_ylabel("Error (m)")
            # Title
            ttl = f"Prediction Error {side} {year}"
            ax.set_title(ttl)
            # Same grid style
            ax.grid(True, linestyle="--", alpha=0.5)
            # Same legend style
            ax.legend()
            plt.tight_layout()
            out_error_png = os.path.join(output_folder,f"prediction_error_{year}{side}_plot.png")
            plt.savefig(out_error_png, dpi=300)
            plt.close()
            print(f"✅ Saved Error Plot: {out_error_png}")
    

    # -------------------------------
    # Save metrics CSV
    # -------------------------------
    if metrics_list:
        metrics_df = pd.DataFrame(metrics_list)
        csv_path = os.path.join(output_folder, f"prediction_metrics_summary_{year}{side}.csv")
        metrics_df.to_csv(csv_path, index=False)
        print(f"✅ Metrics summary saved to {csv_path}")
    else:
        print("⚠ No valid predictions/actuals to compute metrics.")



def main():
    import time
    import argparse
    
    parser = argparse.ArgumentParser(description="Geospatial Analysis Model")
    parser.add_argument('--spacing', type=int, default=1000, help='Spacing for transects')
    parser.add_argument('--transect_length', type=int, default=10000, help='Length of each transect')
    parser.add_argument('--smoothing_distance', type=int, default=1000, help='Distance for smoothing')
    parser.add_argument('--reference_year', type=int, default=1991, help='Reference year for shift calculation')
    parser.add_argument('--side', type=str, default='R', help='Side of the river to analyze (L or R)')
    parser.add_argument('--forecast_steps', type=int, default=2, help='Number of years to forecast')
    #parser.add_argument('--n_years_value', type=int, default=10, help='Number of years to forecast')
    parser.add_argument('--startYear', type=int, default=None, help='Start year for analysis')
    parser.add_argument('--endYear', type=int, default=None, help='End year for analysis')
    
    args = parser.parse_args()
    startTime = time.perf_counter()
    
    import os, shutil, geopandas as gpd
    from multiprocessing import set_start_method
    try:
        set_start_method("spawn", force=True)
    except RuntimeError:
        pass
    
    input_folder   = "input"
    output_folder  = "output"
    spacing        = args.spacing
    transect_length = args.transect_length
    #smoothing_distance = args.smoothing_distance
    reference_year = args.reference_year
    side           = args.side
    forecast_steps = args.forecast_steps
    #n_years_value  = args.n_years_value
    startYear      = args.startYear
    endYear        = args.endYear

    os.makedirs(output_folder, exist_ok=True)

    print("\n🔹 Step 1: Processing river folder…")
    folder = process_river_folder(input_folder=input_folder, spacing=spacing, transect_length=transect_length, smoothing_distance=4000 ,start_year=startYear, end_year=endYear)

    for shp in os.listdir(folder):
        if shp.lower().endswith(".shp") and (shp.endswith("L.shp") or shp.endswith("R.shp") or shp == "transects.shp"):
            base = os.path.splitext(shp)[0]
            for ext in [".shp", ".shx", ".dbf", ".prj", ".cpg"]:
                src = os.path.join(folder, base + ext)
                dst = os.path.join(output_folder, base + ext)
                if os.path.exists(src):
                    shutil.copy2(src, dst)

    print("\n🔹 Step 2: Calculating shifts with adaptive polynomial interpolation…")

    compiled_df, orders_df = calculate_shift_filled(
        folder_path=output_folder,
        reference_year=str(reference_year),
        side=side,
        max_order=5
    )

    # Save interpolated shifts
    shift_csv = os.path.join(output_folder, f"shifts_{side}.csv")
    compiled_df.to_csv(shift_csv, index=False)
    print(f"✅ Interpolated shift data saved to: {shift_csv}")

    # Save per-year polynomial orders (NaN where no interpolation was done)
    order_csv = os.path.join(output_folder, f"poly_order_{side}.csv")
    orders_df.to_csv(order_csv, index=False)
    print(f"✅ Polynomial order per-year data saved to: {order_csv}")

    plot_shift_vs_year(compiled_df, output_folder, reference_year, start_year=startYear, end_year=endYear)

    transect_stats_df, _ = generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_folder,
        reference_year=reference_year
    )

    print("\n🔹 Step 3: ARIMA+XGBoost forecasts…")
    preds = predict_shifts_parallel_safe(
        compiled_df,
        steps=forecast_steps,
        #n_years=n_years_value,
        output_folder=output_folder,
        start_year=startYear,
        end_year=endYear
    )

    print("\n🔹 Step 4: Generating predicted banklines and comparison plots…")
    _possible_transects = list(Path(output_folder).glob(f"*transect*_{side}.shp")) + list(Path(output_folder).glob(f"*transect*{side}.shp")) + list(Path(output_folder).glob("*transect*.shp"))
    if not _possible_transects:
        raise FileNotFoundError(f"No transects file found for side {side} in {output_folder}")
    transects_path = str(_possible_transects[0])
    transects_gdf = gpd.read_file(transects_path)
    
    _possible_baselines = list(Path(output_folder).glob(f"{reference_year}*{side}.shp"))
    if not _possible_baselines:
        raise FileNotFoundError(f"Baseline file for year {reference_year} and side {side} not found")
    baseline_gdf  = gpd.read_file(str(_possible_baselines[0]))

    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_folder,
        side=side,
        outlier_threshold=5000,
        transect_stats_df=transect_stats_df
    )

    print("\n✅ All steps completed successfully.")
    endTime = time.perf_counter()
    print(f" Total runtime: {endTime - startTime:.2f} seconds")


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    main()



