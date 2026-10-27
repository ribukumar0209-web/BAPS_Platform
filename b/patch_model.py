import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update form_map signature
content = content.replace(
"""def form_map(
    df_preds_dict,
    transects_gdf,
    baseline_gdf,
    compiled_df,
    output_folder,
    side,
    outlier_threshold=5000,
):""",
"""def form_map(
    df_preds_dict,
    transects_gdf,
    baseline_gdf,
    compiled_df,
    output_folder,
    side,
    outlier_threshold=5000,
    transect_stats_df=None,
):"""
)

# 2. Update main() calling generate_historical_statistics
content = content.replace(
"""    generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_folder,
        reference_year=reference_year
    )""",
"""    transect_stats_df, _ = generate_historical_statistics(
        compiled_df=compiled_df,
        output_folder=output_folder,
        reference_year=reference_year
    )"""
)

# 3. Update main() calling form_map
content = content.replace(
"""    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_folder,
        side=side,
        outlier_threshold=5000
    )""",
"""    form_map(
        df_preds_dict=preds,
        transects_gdf=transects_gdf,
        baseline_gdf=baseline_gdf,
        compiled_df=compiled_df,
        output_folder=output_folder,
        side=side,
        outlier_threshold=5000,
        transect_stats_df=transect_stats_df
    )"""
)

# 4. Update the map plotting block in form_map
old_map_block = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(10, 8))
        baseline_gdf.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
        transects_gdf.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
        gdf_out.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")
        # Coordinate Grid"""

new_map_block = """        # =====================================================
        # Bankline prediction Map
        # =====================================================
        fig, ax = plt.subplots(figsize=(12, 8))
        
        if transect_stats_df is not None:
            import matplotlib.colors as mcolors
            import matplotlib.patches as mpatches
            import matplotlib.lines as mlines
            
            temp_gdf = transects_gdf.merge(transect_stats_df[['TransectID', 'LRR']], left_on='transect_id', right_on='TransectID', how='left')
            
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
            
            ax.set_facecolor('#3d493a') # Dark muted green background to resemble land
            
            # Thick lines for transects to resemble colored regions
            temp_gdf.plot(ax=ax, column='LRR', cmap=cmap_scatter, norm=norm, linewidth=7, alpha=0.9, zorder=1)
            
            # Plot predicted line on top in blue
            gdf_out.plot(ax=ax, color="#1f77b4", linewidth=2.5, label=f"Bankline {year}", zorder=2)
            
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
            
            ax.legend(handles=legend_patches, title="Legend\nLRR (m/yr)", loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=True, facecolor="white", edgecolor="black")
            
        else:
            baseline_gdf.plot(ax=ax,color="black",linewidth=1.5,label=f"Baseline {side}")
            transects_gdf.plot(ax=ax,color="gray",linewidth=0.4,alpha=0.5,label="Transects")
            gdf_out.plot(ax=ax,color="red",linewidth=2,label=f"Predicted {year}")
            ax.legend(loc="upper right",frameon=True,facecolor="white",edgecolor="black")
            
        # Coordinate Grid"""

content = content.replace(old_map_block, new_map_block)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patch applied.")
