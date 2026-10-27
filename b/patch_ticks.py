import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

old_plot_setup = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        if transect_stats_df is not None:"""

new_plot_setup = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        # Reproject to geographic coordinates (WGS84) for degree labels
        baseline_plot = baseline_gdf.to_crs(epsg=4326)
        transects_plot = transects_gdf.to_crs(epsg=4326)
        gdf_out_plot = gdf_out.to_crs(epsg=4326)
        
        if transect_stats_df is not None:"""
        
content = content.replace(old_plot_setup, new_plot_setup)

# Change references from temp_gdf to temp_gdf_plot in the if block
old_if_block = """            temp_gdf = transects_gdf.copy()
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
            
            # Background is kept transparent
            
            # Thick lines for transects to resemble colored regions
            temp_gdf.plot(ax=ax, column='LRR', cmap=cmap_scatter, norm=norm, linewidth=7, alpha=0.9, zorder=1)
            
            # Plot predicted line on top in blue
            gdf_out.plot(ax=ax, color="#1f77b4", linewidth=2.5, label=f"Bankline {year}", zorder=2)"""

new_if_block = """            temp_gdf = transects_plot.copy()
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
            
            # Background is kept transparent
            
            # Thick lines for transects to resemble colored regions
            temp_gdf.plot(ax=ax, column='LRR', cmap=cmap_scatter, norm=norm, linewidth=7, alpha=0.9, zorder=1)
            
            # Plot predicted line on top in blue
            gdf_out_plot.plot(ax=ax, color="#1f77b4", linewidth=2.5, label=f"Bankline {year}", zorder=2)"""
            
content = content.replace(old_if_block, new_if_block)

old_else_block = """        else:
            baseline_gdf.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
            transects_gdf.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
            gdf_out.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")"""

new_else_block = """        else:
            baseline_plot.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
            transects_plot.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
            gdf_out_plot.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")"""
            
content = content.replace(old_else_block, new_else_block)

old_grid_block = """        # Coordinate Grid
        ax.grid(True,linestyle="--",linewidth=0.5,color="gray",alpha=0.5)
        ax.tick_params(labelsize=10)
        ax.set_xlabel("Longitude (m)" if transects_gdf.crs.is_projected else "Longitude")
        ax.set_ylabel("Latitude (m)" if transects_gdf.crs.is_projected else "Latitude")
        # Scale Bar
        scalebar = ScaleBar(1,location="lower left",box_alpha=0.8,length_fraction=0.25)
        ax.add_artist(scalebar)"""

new_grid_block = """        # Coordinate Grid
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
        mean_lat = baseline_plot.geometry.centroid.y.mean() if not baseline_plot.empty else 0
        dx_meters = 111320 * math.cos(math.radians(mean_lat))
        scalebar = ScaleBar(dx_meters, location="lower left", box_alpha=0.8, length_fraction=0.25)
        ax.add_artist(scalebar)"""

content = content.replace(old_grid_block, new_grid_block)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Ticks formatted successfully.")
