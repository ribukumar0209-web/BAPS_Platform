import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# We want to find the exact block for the map and duplicate it
start_str = "        # =====================================================\n        # Bankline prediction Map"
end_str = "        plt.close()\n"

start_idx = content.find(start_str)
end_idx = content.find(end_str, start_idx) + len(end_str)

map_block = content[start_idx:end_idx]

# We need to modify the second block to act as a simple map without LRR
# We can do this by forcing transect_stats_df to be None
simple_map_block = map_block.replace(
    "if transect_stats_df is not None:", 
    "if False:"
)
simple_map_block = simple_map_block.replace(
    'png_path = os.path.join(output_folder,f"predicted_bankline_{year}{side}_bank.png")',
    'png_path = os.path.join(output_folder,f"predicted_bankline_simple_{year}{side}_bank.png")'
)

# Also rename the map title to reflect it's the baseline map
simple_map_block = simple_map_block.replace(
    'ax.set_title(f"Predicted Bankline {year} ({side})",fontsize=15,fontweight="bold")',
    'ax.set_title(f"Predicted Bankline vs Baseline {year} ({side})",fontsize=15,fontweight="bold")'
)

# Insert it right after the original map block
new_content = content[:end_idx] + "\n        # =====================================================\n        # Simple Bankline Map (No LRR)\n" + simple_map_block + content[end_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Added simple map block successfully.")
