import os

file_path = "model/model.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

old_block = """        # North Arrow
        ax.annotate('N',xy=(0.94, 0.92),xytext=(0.94, 0.78),xycoords='axes fraction',arrowprops=dict(facecolor='black',width=4,headwidth=12),
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

new_block = """        # North Arrow
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
            ax.legend(loc="upper right", bbox_to_anchor=(0.98, 0.83), frameon=True, facecolor="white", edgecolor="black", framealpha=0.9)"""

content = content.replace(old_block, new_block)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patch applied for moving North Arrow and Legend.")
