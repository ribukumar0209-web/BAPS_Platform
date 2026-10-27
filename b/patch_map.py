import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove ax.set_facecolor
old_facecolor = "            ax.set_facecolor('#3d493a') # Dark muted green background to resemble land"
content = content.replace(old_facecolor, "            # Background is kept transparent")

# 2. Modify legend creation inside the if-else blocks
old_legend_if = """            ax.legend(handles=legend_patches, title="Legend\\nLRR (m/yr)", loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=True, facecolor="white", edgecolor="black")"""
new_legend_if = """            custom_handles = legend_patches
            custom_title = "Significance of LRR (m/yr)" """
content = content.replace(old_legend_if, new_legend_if)

old_legend_else = """            ax.legend(loc="upper right",frameon=True,facecolor="white",edgecolor="black")"""
new_legend_else = """            custom_handles = None
            custom_title = None"""
# Be careful because there are TWO of these old_legend_else in the file. One at 2183 and one at 2200.
# We will just replace ALL of them. The first one is in the else block, the second is after the North arrow.
content = content.replace('        ax.legend(loc="upper right",frameon=True,facecolor="white",edgecolor="black")', '')
content = content.replace('            ax.legend(loc="upper right",frameon=True,facecolor="white",edgecolor="black")', new_legend_else)

# 3. Add legend below North Arrow
old_north_arrow = """        ax.annotate('N',xy=(0.94, 0.92),xytext=(0.94, 0.78),xycoords='axes fraction',arrowprops=dict(facecolor='black',width=4,headwidth=12),
            ha='center',
            va='center',
            fontsize=16,
            fontweight='bold'
        )"""

new_north_arrow = """        ax.annotate('N',xy=(0.94, 0.92),xytext=(0.94, 0.78),xycoords='axes fraction',arrowprops=dict(facecolor='black',width=4,headwidth=12),
            ha='center',
            va='center',
            fontsize=16,
            fontweight='bold'
        )
        if custom_handles:
            # Place legend right below the north arrow
            ax.legend(handles=custom_handles, title=custom_title, loc="upper right", bbox_to_anchor=(0.98, 0.75), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)
        else:
            ax.legend(loc="upper right", bbox_to_anchor=(0.98, 0.75), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)"""
content = content.replace(old_north_arrow, new_north_arrow)

# 4. Update savefig to be transparent
old_savefig = """        plt.savefig(png_path,dpi=600,bbox_inches="tight")"""
new_savefig = """        plt.savefig(png_path,dpi=600,bbox_inches="tight", transparent=True)"""
content = content.replace(old_savefig, new_savefig)


with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patch applied to model.py for transparent map and legend placement.")
