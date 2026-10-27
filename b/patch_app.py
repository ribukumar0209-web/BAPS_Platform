import os

file_path = "app.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update process_analysis
old_analysis = """    print("Generating Historical Statistics...")

    generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_dir,
        reference_year=reference_year
    )

    print("Historical Statistics Generated.")"""

new_analysis = """    print("Generating Historical Statistics...")

    transect_stats_df, _ = generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_dir,
        reference_year=reference_year
    )
    transect_stats_df.to_csv(os.path.join(input_dir, f"transect_stats_cache_{side}.csv"), index=False)

    print("Historical Statistics Generated.")"""

content = content.replace(old_analysis, new_analysis)

# 2. Update process_forecast cache loading
old_cache = """    cache_path_shifts = os.path.join(input_dir, f"shifts_cache_{side}.csv")
    cache_path_orders = os.path.join(input_dir, f"poly_order_cache_{side}.csv")

    if os.path.exists(cache_path_shifts) and os.path.exists(cache_path_orders):
        import pandas as pd
        print("Step 1: Successfully loaded pre-calculated data from analysis...")
        compiled_df = pd.read_csv(cache_path_shifts)
        orders_df = pd.read_csv(cache_path_orders)
    else:"""

new_cache = """    cache_path_shifts = os.path.join(input_dir, f"shifts_cache_{side}.csv")
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
    else:"""

content = content.replace(old_cache, new_cache)

# 3. Update form_map call in process_forecast
old_form_map = """    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_dir,
        side=side,
        outlier_threshold=5000
    )"""

new_form_map = """    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_dir,
        side=side,
        outlier_threshold=5000,
        transect_stats_df=transect_stats_df
    )"""

content = content.replace(old_form_map, new_form_map)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("app.py patched successfully.")
