import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix the warning for the centroid in both blocks
old_centroid = "mean_lat = baseline_plot.geometry.centroid.y.mean() if not baseline_plot.empty else 0"
new_centroid = "mean_lat = baseline_gdf.centroid.to_crs(epsg=4326).y.mean() if not baseline_gdf.empty else 0"
content = content.replace(old_centroid, new_centroid)

# Fix the custom_handles issue.
# In the simple map block, `if False:` skips the assignment.
# We will just declare custom_handles = None before the if/else in both map blocks.

# First map block
old_map1_start = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        if transect_stats_df is not None:"""

new_map1_start = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        custom_handles = None
        custom_title = None
        if transect_stats_df is not None:"""

content = content.replace(old_map1_start, new_map1_start)

# Second map block
old_map2_start = """        # =====================================================
        # Simple Bankline Map (No LRR)
        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        if False:"""

new_map2_start = """        # =====================================================
        # Simple Bankline Map (No LRR)
        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        custom_handles = None
        custom_title = None
        if False:"""

content = content.replace(old_map2_start, new_map2_start)

# In the `if` block, we need to make sure custom_handles is actually assigned.
# Currently it has:
#             for i in range(8):
# ...
#                 legend_patches.append(patch)
#             
#             ax.legend(handles=legend_patches, title="Legend\\nLRR (m/yr)", loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=True, facecolor="white", edgecolor="black")

# We should replace `ax.legend(...)` with `custom_handles = legend_patches` and `custom_title = "Significance of LRR (m/yr)"`

old_legend_call = """            ax.legend(handles=legend_patches, title="Legend\\nLRR (m/yr)", loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=True, facecolor="white", edgecolor="black")"""

new_legend_call = """            custom_handles = legend_patches
            custom_title = "Significance of LRR (m/yr)" """

content = content.replace(old_legend_call, new_legend_call)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patch applied for custom_handles and centroid warning.")
