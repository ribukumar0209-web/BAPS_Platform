import React, { useState, useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl, ScaleControl, ZoomControl, FeatureGroup, Pane, Rectangle } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import { EditControl } from "react-leaflet-draw";
import JSZip from "jszip";
import shp from "shpjs";
import { parseShapefileFiles } from "./ShapefileParser.js";
import SpatialMapDesignerModal from "./SpatialMapDesignerModal.js";
import { captureMapBounds } from "./spatialMapHelper.js";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "./LeafletMaps.css";

window.L = L;

// === SVG Icons ================================================================
const SunIcon = () => (<svg viewBox="0 0 24 24" width="18" height="18" stroke="#F57C00" strokeWidth="2" fill="#FFC107" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>);
const MoonIcon = () => (<svg viewBox="0 0 24 24" width="18" height="18" stroke="#3949AB" strokeWidth="2" fill="#90CAF9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>);
const ZoomIcon = () => (<svg viewBox="0 0 24 24" width="14" height="14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:"middle"}}><circle cx="11" cy="11" r="8" fill="#E1F5FE" stroke="#0277BD"></circle><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="#757575"></line><line x1="11" y1="8" x2="11" y2="14" stroke="#0277BD"></line><line x1="8" y1="11" x2="14" y2="11" stroke="#0277BD"></line></svg>);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:"middle"}}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);
const UploadCloudIcon = () => (
  <svg viewBox="0 0 24 24" width="34" height="34" stroke="var(--accent-color, #3b82f6)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{margin: "0 auto 8px", display: "block"}}>
    <path d="M16 16l-4-4-4 4"></path>
    <path d="M12 12v9"></path>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
    <polyline points="16 16 12 12 8 16"></polyline>
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:"middle"}}>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);
const ChartIcon = () => (<svg viewBox="0 0 24 24" width="16" height="16" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:"text-bottom", marginRight:"6px"}}><line x1="18" y1="20" x2="18" y2="10" stroke="#F44336"></line><line x1="12" y1="20" x2="12" y2="4" stroke="#4CAF50"></line><line x1="6" y1="20" x2="6" y2="14" stroke="#2196F3"></line><line x1="2" y1="20" x2="22" y2="20" stroke="#9E9E9E" strokeWidth="2"></line></svg>);
const ToggleIcon = ({ minimized }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    {minimized ? (
      <><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></>
    ) : (
      <line x1="5" y1="12" x2="19" y2="12"></line>
    )}
  </svg>
);

// Generate distinct, non-light colors
function generateColors(count) {
  const colors = new Set();
  while (colors.size < count) {
    const color = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    if (brightness < 220 && brightness > 40 && color.toLowerCase() !== "#ffffff") {
      colors.add(color);
    }
  }
  return Array.from(colors);
}

const INITIAL_VIEW = { center: [20, 0], zoom: 2 };
const COLORS = generateColors(100);

// === Parameter Definitions ====================================================
// 8-class palette matching the uploaded reference legend (dark-maroon → dark-forest-green)
const EIGHT_CLASS_PALETTE = [
  "#800000", // class 1 – darkest (dark maroon)
  "#FF0000", // class 2 – bright red
  "#FF6600", // class 3 – orange
  "#FFC000", // class 4 – amber / golden
  "#FFFF00", // class 5 – yellow
  "#92D050", // class 6 – yellow-green / lime
  "#00B050", // class 7 – medium green
  "#375623", // class 8 – dark forest green
];

// Erosion/Accretion 3-class palette
const EA_PALETTE = {
  erosion:   { color: "#800000", label: "Erosion" },
  stable:    { color: "#999999", label: "Stable" },
  accretion: { color: "#375623", label: "Accretion" },
};

const PARAM_DEFS = [
  { key: "erosion_accretion", label: "Erosion / Accretion", field: "NBMR", special: "ea" },
  { key: "LRR",        label: "LRR",        field: "LRR",        special: null },
  { key: "LSE",        label: "LSE",        field: "LSE",        special: null },
  { key: "NBM",        label: "NBM",        field: "NBM",        special: null },
  { key: "NBMR",       label: "NBMR",       field: "NBMR",       special: null },
  { key: "BMC",        label: "BMC",        field: "BMC",        special: null },
  { key: "Mean Shift", label: "Mean Shift", field: "Mean Shift", special: null },
  { key: "Std",        label: "Std",        field: "Std",        special: null },
];

// === Classification helpers ===================================================

function quantileBreaks(values) {
  const sorted = [...values].filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const n = sorted.length;
  // 9 boundary values → 8 classes
  return [0, 1/8, 2/8, 3/8, 4/8, 5/8, 6/8, 7/8, 1].map(p => {
    const idx = Math.floor(p * (n - 1));
    return sorted[Math.min(idx, n - 1)];
  });
}

function classIndex(value, breaks) {
  if (value == null || isNaN(value) || !breaks) return -1;
  for (let i = 0; i < 8; i++) {
    if (value <= breaks[i + 1]) return i;
  }
  return 7;
}

function getParamColor(param, value, breaks) {
  if (value == null || isNaN(value)) return "#999999";
  if (param.special === "ea") {
    if (value < -10) return EA_PALETTE.erosion.color;
    if (value > 10)  return EA_PALETTE.accretion.color;
    return EA_PALETTE.stable.color;
  }
  const idx = classIndex(value, breaks);
  return idx < 0 ? "#999999" : EIGHT_CLASS_PALETTE[idx];
}

// === Map helpers ==============================================================

function FitBoundsToLayers({ layers }) {
  const map = useMap();
  const layerNames = layers.map(l => l.name).join(",");
  useEffect(() => {
    if (layers.length > 0) {
      const bounds = new L.LatLngBounds();
      layers.forEach(layer => {
        if (layer.visible && layer.data) {
          const geojsonLayer = L.geoJSON(layer.data);
          bounds.extend(geojsonLayer.getBounds());
        }
      });
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerNames, map]);
  return null;
}

function ZoomToSpecificLayer({ data, onZoomed }) {
  const map = useMap();
  useEffect(() => {
    if (data) {
      try {
        const geojsonLayer = L.geoJSON(data);
        const bounds = geojsonLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
      } catch (e) {
        console.error("Error zooming to layer:", e);
      }
      onZoomed();
    }
  }, [data, map, onZoomed]);
  return null;
}

function MapRefController({ setMapRef }) {
  const map = useMap();
  useEffect(() => {
    if (map) setMapRef(map);
  }, [map, setMapRef]);
  return null;
}

function RectangleSelectionTool({ isActive, bounds, onBoundsChange, onComplete }) {
  const map = useMap();
  const isDrawingRef = useRef(false);
  const startLatLngRef = useRef(null);

  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();

    if (isActive) {
      map.dragging.disable();
      container.style.cursor = "crosshair";
    } else {
      map.dragging.enable();
      container.style.cursor = "";
      isDrawingRef.current = false;
      startLatLngRef.current = null;
    }

    return () => {
      map.dragging.enable();
      container.style.cursor = "";
    };
  }, [isActive, map]);

  useEffect(() => {
    if (!map || !isActive) return;

    const onMouseDown = (e) => {
      if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest(".leaflet-control")) return;
      isDrawingRef.current = true;
      startLatLngRef.current = e.latlng;
      const b = L.latLngBounds(e.latlng, e.latlng);
      onBoundsChange(b);
    };

    const onMouseMove = (e) => {
      if (!isDrawingRef.current || !startLatLngRef.current) return;
      const b = L.latLngBounds(startLatLngRef.current, e.latlng);
      onBoundsChange(b);
    };

    const onMouseUp = (e) => {
      if (!isDrawingRef.current || !startLatLngRef.current) return;
      isDrawingRef.current = false;
      const finalBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
      startLatLngRef.current = null;
      if (finalBounds.isValid()) {
        const sw = finalBounds.getSouthWest();
        const ne = finalBounds.getNorthEast();
        if (Math.abs(ne.lat - sw.lat) > 0.0001 && Math.abs(ne.lng - sw.lng) > 0.0001) {
          onBoundsChange(finalBounds);
          if (onComplete) onComplete(finalBounds);
        }
      }
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
    };
  }, [isActive, map, onBoundsChange, onComplete]);

  if (!isActive || !bounds || !bounds.isValid()) return null;

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  if (Math.abs(ne.lat - sw.lat) < 0.00001 && Math.abs(ne.lng - sw.lng) < 0.00001) {
    return null;
  }

  return (
    <Rectangle
      bounds={bounds}
      pathOptions={{
        color: "#dc2626",
        weight: 2,
        fill: false,
        fillOpacity: 0,
      }}
    />
  );
}

// === ZIP parsing ==============================================================
const processAndFilterZip = async (zipFileBuffer) => {
  if (!zipFileBuffer) return [];
  const zip = await JSZip.loadAsync(zipFileBuffer);
  const shpFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith(".shp"));
  const processedLayers = [];
  for (let shpFile of shpFiles) {
    const baseName = shpFile.slice(0, -4);
    const filesForShp = {};
    ["shp", "shx", "dbf", "prj"].forEach(ext => {
      const fileName = `${baseName}.${ext}`;
      const foundKey = Object.keys(zip.files).find(k => k.toLowerCase() === fileName.toLowerCase());
      if (foundKey) filesForShp[ext] = zip.files[foundKey];
    });
    const buffers = {};
    for (const [ext, f] of Object.entries(filesForShp)) {
      buffers[ext] = await f.async("arraybuffer");
    }
    try {
      const geojson = await shp(buffers);
      processedLayers.push({ name: baseName.replace(/^.*[\\/]/, ""), data: geojson, visible: true });
    } catch (errInner) {
      console.warn(`Failed to parse ${baseName}:`, errInner);
    }
  }
  return processedLayers;
};

// === Draggable Param Panel ====================================================
function DraggableParamPanel({ activeParamKey, handleParamToggle, paramBankFilter, setParamBankFilter }) {
  const [pos, setPos] = useState({ x: 0, y: 0 }); // drag offset from initial CSS position
  const [minimized, setMinimized] = useState(false);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const onMouseDown = (e) => {
    if (e.target.closest(".param-panel-header") && !e.target.closest(".legend-minimize-btn")) {
      e.preventDefault();
      dragging.current = true;
      dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setPos({
        x: dragStart.current.px + (e.clientX - dragStart.current.mx),
        y: dragStart.current.py + (e.clientY - dragStart.current.my),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      className="param-panel"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
    >
      <div 
        className="param-panel-header" 
        style={{ marginBottom: minimized ? '0' : '10px', cursor: 'grab' }}
        onMouseDown={onMouseDown}
      >
        <div>
          <div className="param-panel-title"><ChartIcon /> Parameter Visualization</div>
        </div>
        <button
          onClick={() => setMinimized(!minimized)}
          className="legend-minimize-btn"
          title={minimized ? "Expand" : "Minimize"}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-color)", padding: "0" }}
        >
          <ToggleIcon minimized={minimized} />
        </button>
      </div>
      {!minimized && (
        <div style={{ padding: "8px 15px", marginBottom: "5px", borderBottom: "1px solid var(--border-color)", display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: "bold" }}>Bank:</span>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
            <input type="radio" name="paramBankFilter" value="Both" checked={paramBankFilter === "Both"} onChange={() => setParamBankFilter("Both")} /> Both
          </label>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
            <input type="radio" name="paramBankFilter" value="L" checked={paramBankFilter === "L"} onChange={() => setParamBankFilter("L")} /> Left
          </label>
          <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
            <input type="radio" name="paramBankFilter" value="R" checked={paramBankFilter === "R"} onChange={() => setParamBankFilter("R")} /> Right
          </label>
        </div>
      )}
      {!minimized && PARAM_DEFS.map(p => (
        <label key={p.key} className={`param-checkbox-row${activeParamKey === p.key ? " param-active" : ""}`}>
          <input
            type="checkbox"
            checked={activeParamKey === p.key}
            onChange={() => handleParamToggle(p.key)}
          />
          <span className="param-label">{p.label}</span>
          {activeParamKey === p.key && <span className="param-active-dot" title="Active" />}
        </label>
      ))}
    </div>
  );
}

// === Draggable Legend =========================================================
function DraggableLegend({ activeParam, breaks }) {
  const [pos, setPos] = useState({ x: 0, y: 0 }); // drag offset from initial CSS position
  const [minimized, setMinimized] = useState(false);
  const dragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const onMouseDown = (e) => {
    if (e.target.closest(".legend-drag-handle")) {
      e.preventDefault();
      dragging.current = true;
      dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setPos({
        x: dragStart.current.px + (e.clientX - dragStart.current.mx),
        y: dragStart.current.py + (e.clientY - dragStart.current.my),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  if (!activeParam) return null;
  const isEA = activeParam.special === "ea";

  return (
    <div
      className="param-legend"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onMouseDown={onMouseDown}
    >
      <div className="legend-drag-handle">
        <span className="legend-drag-title">Map Legend: {activeParam.label}</span>
        <button
          className="legend-minimize-btn"
          onClick={() => setMinimized(m => !m)}
          title={minimized ? "Expand" : "Minimize"}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-color)", padding: 0 }}
        >
          <ToggleIcon minimized={minimized} />
        </button>
      </div>

      {!minimized && (
        <div className="legend-body">
          {isEA ? (
            Object.values(EA_PALETTE).map(({ color, label }) => (
              <div key={label} className="legend-row">
                <span className="legend-swatch" style={{ background: color }} />
                <span className="legend-range-label">{label}</span>
              </div>
            ))
          ) : (
            breaks && EIGHT_CLASS_PALETTE.map((color, i) => {
              const lo = breaks[i] != null ? Number(breaks[i]).toFixed(3) : "?";
              const hi = breaks[i + 1] != null ? Number(breaks[i + 1]).toFixed(3) : "?";
              return (
                <div key={i} className="legend-row">
                  <span className="legend-swatch" style={{ background: color }} />
                  <span className="legend-range-label">{lo} to {hi}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// === Main Component ===========================================================
export default function MapShapefileMode({
  zipFile, additionalZip, setAvailableYears, setMissingYears,
  theme, toggleTheme, setDrawnROI, analysisMode, transectStatsGeoJson
}) {
  const [layers, setLayers] = useState([]);
  const [initialLayerNames, setInitialLayerNames] = useState(new Set());
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [mode, setMode] = useState("right");
  const [loading, setLoading] = useState(false);
  const [zoomToTarget, setZoomToTarget] = useState(null);
  const [isLegendMinimized, setIsLegendMinimized] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const taskIdRef = useRef(0);
  const lastZipNameRef = useRef("");
  const featureGroupRef = useRef();

  // Drag and drop & Shapefile import state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDraggingOverLegend, setIsDraggingOverLegend] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const dragCountRef = useRef(0);
  const toastTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = useCallback((type, text) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage({ type, text });
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  }, []);

  const processImportedFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      const imported = await parseShapefileFiles(files);
      if (imported.length > 0) {
        setLayers(prev => {
          const existingNames = new Set(prev.map(l => l.name));
          const newLayers = imported.map((nl, idx) => {
            let uniqueName = nl.name;
            let counter = 1;
            while (existingNames.has(uniqueName)) {
              uniqueName = `${nl.name}_${counter}`;
              counter++;
            }
            existingNames.add(uniqueName);
            return {
              ...nl,
              name: uniqueName,
              visible: true,
              color: nl.color || COLORS[(prev.length + idx) % COLORS.length]
            };
          });
          return [...prev, ...newLayers];
        });

        if (imported[0] && imported[0].data) {
          setZoomToTarget(imported[0].data);
        }

        showToast("success", `Added ${imported.length} shapefile layer(s): ${imported.map(l => l.name).join(", ")}`);
      }
    } catch (err) {
      console.error("Shapefile import error:", err);
      showToast("error", err.message || "Failed to load shapefile. Please provide a valid .shp or .zip file.");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const removeLayer = useCallback((oi) => {
    setLayers(prev => {
      const layerToRemove = prev[oi];
      const next = prev.filter((_, i) => i !== oi);
      if (layerToRemove) {
        showToast("info", `Removed layer: ${layerToRemove.name}`);
      }
      return next;
    });
  }, [showToast]);

  const isFileDrag = (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.from(e.dataTransfer.types).includes("Files") || e.dataTransfer.types.includes("Files");
  };

  const handleDragEnter = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCountRef.current++;
    if (dragCountRef.current === 1) {
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDraggingFile(false);
      setIsDraggingOverLegend(false);
    }
  };

  const handleDrop = async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDraggingFile(false);
    setIsDraggingOverLegend(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImportedFiles(e.dataTransfer.files);
    }
  };

  const handleLegendDragEnter = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setIsDraggingOverLegend(true);
  };

  const handleLegendDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDraggingOverLegend(true);
  };

  const handleLegendDragLeave = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setIsDraggingOverLegend(false);
  };

  const handleLegendDrop = async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDraggingFile(false);
    setIsDraggingOverLegend(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImportedFiles(e.dataTransfer.files);
    }
  };

  // Spatial Map Export State
  const [mapInstance, setMapInstance] = useState(null);
  const [isSpatialExportMode, setIsSpatialExportMode] = useState(false);
  const [spatialCropBounds, setSpatialCropBounds] = useState(null);
  const [spatialCropData, setSpatialCropData] = useState(null);
  const [spatialModalOpen, setSpatialModalOpen] = useState(false);
  const [isCapturingMap, setIsCapturingMap] = useState(false);

  const handleStartSpatialExport = useCallback(() => {
    setIsSpatialExportMode(true);
    setSpatialCropBounds(null);
    showToast("info", "Drag a box on the map or click 'Use Current Map View' in the banner.");
  }, [showToast]);

  const handleCancelSpatialExport = useCallback(() => {
    setIsSpatialExportMode(false);
    setSpatialCropBounds(null);
  }, []);

  const handleConfirmExportArea = useCallback(async (boundsToCapture) => {
    if (!mapInstance || !boundsToCapture) return;
    setIsCapturingMap(true);
    showToast("info", "Capturing map snapshot for spatial cartography...");
    try {
      const cropResult = await captureMapBounds(mapInstance, boundsToCapture);
      setSpatialCropData(cropResult);
      setSpatialModalOpen(true);
      setIsSpatialExportMode(false);
      setSpatialCropBounds(null);
    } catch (err) {
      console.error("Capture spatial map error:", err);
      showToast("error", err.message || "Failed to capture map area. Please try again.");
    } finally {
      setIsCapturingMap(false);
    }
  }, [mapInstance, showToast]);

  // Parameter visualization state
  const [activeParamKey, setActiveParamKey] = useState(null);
  const [paramBreaks, setParamBreaks] = useState(null);
  const [paramLayerKey, setParamLayerKey] = useState(0);
  const [paramBankFilter, setParamBankFilter] = useState("Both"); // "L", "R", "Both"

  const filteredTransectStatsGeoJson = React.useMemo(() => {
    if (!transectStatsGeoJson) return null;
    if (paramBankFilter === "Both") return transectStatsGeoJson;
    return {
      ...transectStatsGeoJson,
      features: transectStatsGeoJson.features.filter(f => f.properties && f.properties.side === paramBankFilter)
    };
  }, [transectStatsGeoJson, paramBankFilter]);

  // Compute per-side quantile breaks when param or data changes.
  // paramBreaks is { L: [...], R: [...] } so each bank is colour-coded against
  // its own distribution.  When a single side is selected the same dict is kept
  // (the unused side may be null); the style function picks the right entry.
  useEffect(() => {
    if (!transectStatsGeoJson || !activeParamKey) { setParamBreaks(null); return; }
    const paramDef = PARAM_DEFS.find(p => p.key === activeParamKey);
    if (!paramDef || paramDef.special === "ea") { setParamBreaks(null); return; }
    const breaksObj = { L: null, R: null, Both: null };
    let allVals = [];
    ["L", "R"].forEach(side => {
      const vals = transectStatsGeoJson.features
        .filter(f => f.properties && f.properties.side === side)
        .map(f => f.properties[paramDef.field])
        .filter(v => v != null && !isNaN(v));
      breaksObj[side] = quantileBreaks(vals);
      allVals = allVals.concat(vals);
    });
    breaksObj.Both = quantileBreaks(allVals);
    setParamBreaks(breaksObj);
    setParamLayerKey(k => k + 1);
  }, [activeParamKey, transectStatsGeoJson]);

  // Reset active param when transect data is cleared
  useEffect(() => {
    if (!transectStatsGeoJson) setActiveParamKey(null);
  }, [transectStatsGeoJson]);

  const handleParamToggle = (key) => {
    setActiveParamKey(prev => prev === key ? null : key);
    setParamLayerKey(k => k + 1);
  };

  const activeParamDef = PARAM_DEFS.find(p => p.key === activeParamKey) || null;

  // Draw events
  const onCreated = (e) => { if (setDrawnROI) setDrawnROI(JSON.stringify(e.layer.toGeoJSON())); };
  const onEdited = (e) => { e.layers.eachLayer(l => { if (setDrawnROI) setDrawnROI(JSON.stringify(l.toGeoJSON())); }); };
  const onDeleted = () => { if (setDrawnROI) setDrawnROI(null); };

  // ZIP loading (input banklines)
  useEffect(() => {
    if (!zipFile) {
      setLayers([]); setLoading(false); setAvailableYears([]); setMissingYears([]);
      lastZipNameRef.current = ""; return;
    }
    let cancelled = false;
    const myTaskId = ++taskIdRef.current;
    (async () => {
      try {
        setLoading(true);
        const buffer = await zipFile.arrayBuffer();
        let targetMode = mode;
        if (zipFile.name !== lastZipNameRef.current) {
          lastZipNameRef.current = zipFile.name;
          const zipObj = await JSZip.loadAsync(buffer);
          const shpFiles = Object.keys(zipObj.files).filter(n => n.toLowerCase().endsWith(".shp"));
          let hasLeft = false, hasRight = false;
          for (const f of shpFiles) {
            const b = f.slice(0, -4).toUpperCase();
            if (b.endsWith("L") || b.endsWith("_L")) hasLeft = true;
            if (b.endsWith("R") || b.endsWith("_R")) hasRight = true;
          }
          targetMode = "both";
          if (hasLeft && !hasRight) targetMode = "left";
          if (hasRight && !hasLeft) targetMode = "right";
          setMode(targetMode);
        }
        const processed = await processAndFilterZip(buffer);
        if (!cancelled && myTaskId === taskIdRef.current) {
          setLayers(processed.map((newLayer, idx) => {
            const upper = newLayer.name.toUpperCase();
            const isLeft = upper.endsWith("L") || upper.endsWith("_L");
            const isRight = upper.endsWith("R") || upper.endsWith("_R");
            let isVisible = true;
            if (targetMode === "left" && isRight) isVisible = false;
            if (targetMode === "right" && isLeft) isVisible = false;
            return {
              ...newLayer,
              visible: isVisible,
              color: newLayer.color || COLORS[idx % COLORS.length],
            };
          }));
          setInitialLayerNames(new Set(processed.map(l => l.name)));
        }
        const zipObj = await JSZip.loadAsync(buffer);
        const years = new Set();
        for (const filename in zipObj.files) {
          const match = filename.match(/(\d{4})/);
          if (match) years.add(parseInt(match[1], 10));
        }
        const sortedYears = Array.from(years).sort();
        setAvailableYears(sortedYears);
        if (sortedYears.length > 1) {
          const minY = sortedYears[0], maxY = sortedYears[sortedYears.length - 1];
          const missing = [];
          for (let i = minY + 1; i < maxY; i++) if (!sortedYears.includes(i)) missing.push(i);
          setMissingYears(missing);
        } else { setMissingYears([]); }
      } catch (err) {
        if (!cancelled && myTaskId === taskIdRef.current) { setLayers([]); setAvailableYears([]); setMissingYears([]); }
      } finally {
        if (!cancelled && myTaskId === taskIdRef.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [zipFile, setAvailableYears, setMissingYears]);

  // ZIP loading (additional results)
  useEffect(() => {
    if (!additionalZip) {
      setLayers(prev => prev.filter(l => initialLayerNames.has(l.name)));
      return;
    }
    let cancelled = false;
    const myTaskId = ++taskIdRef.current;
    (async () => {
      try {
        setLoading(true);
        const buffer = await additionalZip.arrayBuffer();
        const zipObj = await JSZip.loadAsync(buffer);
        const geojsonFiles = Object.keys(zipObj.files).filter(n => n.toLowerCase().endsWith(".geojson"));
        const shpFiles = Object.keys(zipObj.files).filter(n => n.toLowerCase().endsWith(".shp"));
        const newLayers = [];
        let hasShp = false;
        for (let gf of geojsonFiles) {
          const baseName = gf.slice(0, -8);
          const ub = baseName.toUpperCase();
          if ((ub.endsWith("L") || ub.endsWith("R")) && !ub.includes("TRANSECT") && !ub.includes("FORECAST") && !ub.includes("PREDICTED")) continue;
          try {
            const text = await zipObj.files[gf].async("string");
            newLayers.push({ name: baseName.replace(/^.*[\\/]/, ""), data: JSON.parse(text), visible: true, isGeoJson: true, isAdditional: true });
          } catch (e) { console.warn(`Failed to parse ${baseName} geojson:`, e); }
        }
        for (let sf of shpFiles) {
          const baseName = sf.slice(0, -4);
          const ub = baseName.toUpperCase();
          if ((ub.endsWith("L") || ub.endsWith("R")) && !ub.includes("TRANSECT") && !ub.includes("FORECAST") && !ub.includes("PREDICTED")) continue;
          hasShp = true;
          const filesForShp = {};
          ["shp", "shx", "dbf", "prj"].forEach(ext => {
            const fn = `${baseName}.${ext}`;
            const fk = Object.keys(zipObj.files).find(k => k.toLowerCase() === fn.toLowerCase());
            if (fk) filesForShp[ext] = zipObj.files[fk];
          });
          const bufs = {};
          for (const [ext, f] of Object.entries(filesForShp)) bufs[ext] = await f.async("arraybuffer");
          try {
            const geojson = await shp(bufs);
            newLayers.push({ name: baseName.replace(/^.*[\\/]/, ""), data: geojson, visible: true, isAdditional: true });
          } catch (e) { console.warn(`Failed to parse ${baseName}:`, e); }
        }
        if (!cancelled && myTaskId === taskIdRef.current) {
          setLayers(prev => {
            let cur = prev;
            if (hasShp) cur = cur.filter(l => !l.isGeoJson);
            const existing = new Set(cur.map(l => l.name));
            const layersToAdd = newLayers
              .filter(l => !existing.has(l.name))
              .map((nl, idx) => ({
                ...nl,
                color: nl.color || COLORS[(cur.length + idx) % COLORS.length],
              }));
            return [...cur, ...layersToAdd];
          });
        }
      } catch (err) { console.error("Error parsing additional ZIP:", err); }
      finally { if (!cancelled && myTaskId === taskIdRef.current) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [additionalZip]);

  // Popup for regular layers
  const onEachFeature = useCallback((feature, layer) => {
    if (feature.properties) {
      const p = feature.properties;
      const tid = p.transect_i ?? p.TransectID ?? p.transect_id ?? p.id;
      
      // If it looks like a transect (has ID and some params), format it nicely
      if (tid !== undefined && (p.LRR !== undefined || p.NBM !== undefined || p.LSE !== undefined)) {
        // Adjust ID so it starts at 1 (shapefile IDs often start at 2001)
        let displayTid = tid;
        if (!isNaN(tid) && Number(tid) > 2000) {
          displayTid = Number(tid) - 2000;
        }

        let html = `<div style="font-family: sans-serif; font-size: 13px;">`;
        html += `<h4 style="margin: 0 0 8px 0; border-bottom: 1px solid #ccc; padding-bottom: 4px;">Transect ${displayTid}</h4>`;
        html += `<table style="width: 100%; border-collapse: collapse;">`;
        
        PARAM_DEFS.forEach(d => {
          const v = p[d.field];
          if (v != null && !isNaN(v)) {
            if (d.special === "ea") {
              let eaLabel = "Stable";
              let eaColor = "#999999";
              if (v < -10) { eaLabel = "Erosion"; eaColor = "#800000"; }
              else if (v > 10) { eaLabel = "Accretion"; eaColor = "#375623"; }
              html += `<tr><td style="padding: 2px 8px 2px 0;"><b>Status:</b></td><td style="text-align: right; font-weight: bold; color: ${eaColor};">${eaLabel}</td></tr>`;
            } else {
              html += `<tr><td style="padding: 2px 8px 2px 0;"><b>${d.label}:</b></td><td style="text-align: right;">${Number(v).toFixed(3)}</td></tr>`;
            }
          }
        });
        html += `</table></div>`;
        layer.bindPopup(html);
      } else {
        // Fallback for regular banklines / other shapefiles
        let html = `<div style="font-family: sans-serif; font-size: 13px;">`;
        html += `<h4 style="margin: 0 0 8px 0; border-bottom: 1px solid #ccc; padding-bottom: 4px;">Attributes</h4>`;
        html += `<table style="width: 100%; border-collapse: collapse;">`;
        for (const key in p) {
          html += `<tr><td style="padding: 2px 8px 2px 0;"><b>${key}:</b></td><td style="text-align: right;">${p[key]}</td></tr>`;
        }
        html += `</table></div>`;
        layer.bindPopup(html);
      }
    }
  }, []);

  // Popup for parameter layers
  const onEachParamFeature = useCallback((feature, layer) => {
    if (feature.properties) {
      const p = feature.properties;
      // Shapefiles truncate column names to 10 chars, so it's usually "transect_i"
      const tid = p.transect_i ?? p.TransectID ?? p.transect_id ?? p.id ?? "-";
      
      let displayTid = tid;
      if (!isNaN(tid) && Number(tid) > 2000) {
        displayTid = Number(tid) - 2000;
      }

      const bankLabel = p.side === "L" ? "Left Bank" : p.side === "R" ? "Right Bank" : "";
      let html = `<div style="font-family: sans-serif; font-size: 13px;">`;
      html += `<h4 style="margin: 0 0 4px 0; border-bottom: 1px solid #ccc; padding-bottom: 4px;">Transect ${displayTid}</h4>`;
      if (bankLabel) html += `<div style="font-size:11px;color:#888;margin-bottom:6px;">${bankLabel}</div>`;
      html += `<table style="width: 100%; border-collapse: collapse;">`;
      
      PARAM_DEFS.forEach(d => {
        const v = p[d.field];
        if (v != null && !isNaN(v)) {
          // Only show EA if special ea, otherwise show standard label
          if (d.special === "ea") {
            let eaLabel = "Stable";
            let eaColor = "#999999";
            if (v < -10) { eaLabel = "Erosion"; eaColor = "#800000"; }
            else if (v > 10) { eaLabel = "Accretion"; eaColor = "#375623"; }
            html += `<tr><td style="padding: 2px 8px 2px 0;"><b>Status:</b></td><td style="text-align: right; font-weight: bold; color: ${eaColor};">${eaLabel}</td></tr>`;
          } else {
            html += `<tr><td style="padding: 2px 8px 2px 0;"><b>${d.label}:</b></td><td style="text-align: right;">${Number(v).toFixed(3)}</td></tr>`;
          }
        }
      });
      
      html += `</table></div>`;
      layer.bindPopup(html);
    }
  }, []);

  // Layer controls
  const toggleLayer = (idx) => setLayers(prev => prev.map((l, i) => i === idx ? { ...l, visible: !l.visible } : l));
  const changeLayerColor = (idx, c) => setLayers(prev => prev.map((l, i) => i === idx ? { ...l, color: c } : l));

  // Style function for param GeoJSON (memoised by active param + breaks)
  // paramBreaks is { L, R } – use the break set matching the transect's side.
  const getParamStyle = useCallback((feature) => {
    if (!activeParamDef) return { color: "#999", weight: 1 };
    const val = feature.properties && feature.properties[activeParamDef.field];
    const side = feature.properties && feature.properties.side;
    
    let breaks;
    if (paramBankFilter === "Both") {
      breaks = paramBreaks ? paramBreaks.Both : null;
    } else {
      breaks = paramBreaks && side ? paramBreaks[side] : paramBreaks;
    }

    return {
      color: getParamColor(activeParamDef, val, breaks),
      weight: 1,
      opacity: 1,
      fillOpacity: 0,
    };
  }, [activeParamDef, paramBreaks, paramBankFilter]);

  // ============================================================================
  return (
    <div 
      className={`map-container-wrapper ${isDraggingFile ? "dragging-file-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for '+ Add .shp' button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".shp,.dbf,.shx,.prj,.cpg,.zip,.geojson,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            processImportedFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Drag & drop overlay */}
      {isDraggingFile && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-card">
            <UploadCloudIcon />
            <h3>Drop Shapefile to Add as Layer</h3>
            <p>Accepts unzipped <strong>.shp</strong> (with optional .dbf/.prj) or <strong>.zip</strong> archive</p>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {toastMessage && (
        <div className={`map-toast map-toast-${toastMessage.type}`}>
          <span className="toast-text">{toastMessage.text}</span>
          <button className="toast-close-btn" onClick={() => setToastMessage(null)} title="Dismiss">✕</button>
        </div>
      )}

      {/* Top bar */}
      {(zipFile || layers.length > 0) ? (
        <div className="layer-controls">
          {zipFile && (
            <>
              <label>
                <input type="radio" value="left" checked={mode === "left"}
                  onChange={() => {
                    setMode("left");
                    setLayers(prev => prev.map(layer => {
                      const upper = layer.name.toUpperCase();
                      if (upper.endsWith("R") || upper.endsWith("_R")) return { ...layer, visible: false };
                      if (upper.endsWith("L") || upper.endsWith("_L")) return { ...layer, visible: true };
                      return layer;
                    }));
                  }} disabled={loading} /> Left
              </label>
              <label>
                <input type="radio" value="right" checked={mode === "right"}
                  onChange={() => {
                    setMode("right");
                    setLayers(prev => prev.map(layer => {
                      const upper = layer.name.toUpperCase();
                      if (upper.endsWith("L") || upper.endsWith("_L")) return { ...layer, visible: false };
                      if (upper.endsWith("R") || upper.endsWith("_R")) return { ...layer, visible: true };
                      return layer;
                    }));
                  }} disabled={loading} /> Right
              </label>
              <label>
                <input type="radio" value="both" checked={mode === "both"}
                  onChange={() => {
                    setMode("both");
                    setLayers(prev => prev.map(layer => {
                      const upper = layer.name.toUpperCase();
                      if (upper.endsWith("L") || upper.endsWith("_L") || upper.endsWith("R") || upper.endsWith("_R")) {
                        return { ...layer, visible: true };
                      }
                      return layer;
                    }));
                  }} disabled={loading} /> Both
              </label>
            </>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
            {loading ? <span className="spinner-text"></span> : (
              <span className="spinner-text">{layers.length > 0 ? `${layers.filter(l => l.visible).length} layer(s)` : ""}</span>
            )}
            <button
              onClick={handleStartSpatialExport}
              className="export-spatial-map-btn"
              title="Export Publication-Ready Spatial Map"
              disabled={loading || isCapturingMap}
            >
              🗺️ Export Spatial Map
            </button>
            <button onClick={toggleTheme} className="theme-toggle-icon" title="Toggle Theme"
              style={{ background: "transparent", border: "2px solid var(--border-color)", borderRadius: "50%", cursor: "pointer", fontSize: "16px", lineHeight: 1, width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", padding: "0", transition: "border-color 0.2s ease", flexShrink: 0, color: "var(--text-color)" }}>
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: 1000, display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            onClick={handleStartSpatialExport}
            className="export-spatial-map-btn"
            title="Export Publication-Ready Spatial Map"
            disabled={loading || isCapturingMap}
          >
            🗺️ Export Spatial Map
          </button>
          <button onClick={toggleTheme} className="theme-toggle-icon" title="Toggle Theme"
            style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "50%", cursor: "pointer", fontSize: "16px", lineHeight: 1, width: "34px", height: "34px", display: "flex", alignItems: "center", justifyContent: "center", padding: "0", color: "var(--text-color)", boxShadow: "var(--glass-shadow)" }}>
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      )}

      {/* Selection Guide Banner (Spatial Export Mode) */}
      {isSpatialExportMode && (
        <div className="selection-guide-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong style={{ color: "var(--accent-color, #3b82f6)" }}>📐 Spatial Map Export:</strong>
            <span>
              {spatialCropBounds
                ? "Area defined! Drag again to select again, or confirm to design map."
                : "Click and drag a box on the map to select the export area."}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {spatialCropBounds ? (
              <button
                className="banner-confirm-btn"
                onClick={() => handleConfirmExportArea(spatialCropBounds)}
                disabled={isCapturingMap}
              >
                {isCapturingMap ? "Capturing..." : "✨ Design & Export Map"}
              </button>
            ) : (
              <button
                className="banner-confirm-btn"
                onClick={() => {
                  if (mapInstance) {
                    handleConfirmExportArea(mapInstance.getBounds());
                  }
                }}
                disabled={isCapturingMap}
                title="Capture entire currently visible map view"
              >
                {isCapturingMap ? "Capturing..." : "Use Current Map View"}
              </button>
            )}
            {spatialCropBounds && (
              <button
                className="banner-cancel-btn"
                onClick={() => setSpatialCropBounds(null)}
                disabled={isCapturingMap}
              >
                ↺ Clear Box
              </button>
            )}
            <button
              className="banner-cancel-btn"
              onClick={handleCancelSpatialExport}
              disabled={isCapturingMap}
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {/* Leaflet map */}
      <MapContainer center={INITIAL_VIEW.center} zoom={INITIAL_VIEW.zoom}
        zoomControl={false} attributionControl={false}
        preferCanvas={true}
        style={{ height: "100%", width: "100%" }}>

        <MapRefController setMapRef={setMapInstance} />
        <RectangleSelectionTool
          isActive={isSpatialExportMode && !isCapturingMap}
          bounds={spatialCropBounds}
          onBoundsChange={setSpatialCropBounds}
          onComplete={() => {}}
        />

        <LayersControl position="topleft">

          <LayersControl.BaseLayer checked name="Street">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" crossOrigin="anonymous" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="&copy; Esri" crossOrigin="anonymous" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Hybrid">
            <TileLayer url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" attribution="&copy; Google" crossOrigin="anonymous" />
          </LayersControl.BaseLayer>
        </LayersControl>

        {analysisMode === "draw" && (
          <FeatureGroup ref={featureGroupRef}>
            <EditControl position="topleft"
              onCreated={onCreated} onEdited={onEdited} onDeleted={onDeleted}
              draw={{
                rectangle: { shapeOptions: { color: "#8b0000", weight: 2, fillOpacity: 0.15, dashArray: "5, 5" } },
                polygon:   { shapeOptions: { color: "#8b0000", weight: 2, fillOpacity: 0.15, dashArray: "5, 5" } },
                circle: false, circlemarker: false, marker: false, polyline: false,
              }}
            />
          </FeatureGroup>
        )}

        <ZoomControl position="topleft" />
        <ScaleControl position="bottomleft" imperial={false} />

        {/* Parameter visualization layer (forced to bottom using a custom Pane) */}
        {filteredTransectStatsGeoJson && activeParamDef && (
          <Pane name="paramPane" style={{ zIndex: 350 }}>
            <GeoJSON
              key={`param-${activeParamKey}-${paramLayerKey}-${paramBankFilter}`}
              data={filteredTransectStatsGeoJson}
              style={getParamStyle}
              onEachFeature={onEachParamFeature}
            />
          </Pane>
        )}

        {/* Regular layers (rendered AFTER parameter layer so they are ON TOP) */}
        {layers.map((layer, idx) =>
          layer.visible ? (
            <GeoJSON
              key={`${layer.name}-${idx}-${mode}`}
              data={layer.data}
              style={{ color: layer.color || COLORS[idx % COLORS.length], weight: 2, fillOpacity: 0.5 }}
              onEachFeature={onEachFeature}
            />
          ) : null
        )}

        <FitBoundsToLayers layers={layers} />
        <ZoomToSpecificLayer data={zoomToTarget} onZoomed={() => setZoomToTarget(null)} />
      </MapContainer>

      {/* Loading spinner */}
      {loading && (
        <div className="spinner-overlay">
          <div className="spinner-content">
            <div className="spinner" />
            <div className="spinner-text">Loading shapefiles...</div>
          </div>
        </div>
      )}

      <div className="top-right-panels">
        {/* Layer legend (always visible or showing dropzone if empty) */}
        <div 
          className={`map-legend ${isDraggingOverLegend ? "drag-over-legend" : ""}`}
          onDragEnter={handleLegendDragEnter}
          onDragOver={handleLegendDragOver}
          onDragLeave={handleLegendDragLeave}
          onDrop={handleLegendDrop}
          style={{ bottom: isLegendMinimized ? "auto" : "10px", padding: isLegendMinimized ? "10px" : "15px" }}
        >
          <div className="legend-header" style={{ marginBottom: isLegendMinimized ? "0" : "10px", paddingBottom: isLegendMinimized ? "0" : "8px", borderBottom: isLegendMinimized ? "none" : "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {layers.length > 0 && (
                <input type="checkbox"
                  checked={layers.every(l => l.visible)}
                  onChange={() => { const s = !layers.every(l => l.visible); setLayers(prev => prev.map(l => ({ ...l, visible: s }))); }}
                  style={{ marginRight: "10px" }}
                />
              )}
              <span style={{ fontWeight: "bold", fontSize: "13px" }}>Layers</span>
              {layers.length > 0 && (
                <span style={{ fontSize: "11px", opacity: 0.7, marginLeft: "6px" }}>({layers.length})</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="add-layer-btn"
                title="Add Shapefile (.shp or .zip)"
              >
                <PlusIcon /> Add .shp
              </button>
              <button onClick={() => setIsLegendMinimized(!isLegendMinimized)}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0", color: "var(--text-color)" }}
                title={isLegendMinimized ? "Maximize Legend" : "Minimize Legend"}>
                <ToggleIcon minimized={isLegendMinimized} />
              </button>
            </div>
          </div>

          {!isLegendMinimized && (
            layers.length === 0 ? (
              <div 
                className="empty-legend-dropzone"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                title="Click or drop shapefile (.shp or .zip) to add as layer"
              >
                <UploadCloudIcon />
                <div style={{ marginTop: "4px", fontWeight: "600", fontSize: "12px" }}>Drag & drop Shapefile</div>
                <div style={{ fontSize: "10.5px", opacity: 0.75, marginTop: "2px" }}>Accepts unzipped .shp or .zip</div>
                <div style={{ fontSize: "11px", color: "var(--accent-color, #3b82f6)", marginTop: "4px" }}>or click to browse</div>
              </div>
            ) : (
              <div style={{ overflowY: "auto", overflowX: "auto", flex: 1, paddingRight: "4px", paddingBottom: "4px" }}>
                {(() => {
                  const getGroup = (l) => {
                    if (l.isUserLayer) return "Custom Layers";
                    const upper = l.name.toUpperCase();
                    if (upper.endsWith("L") || upper.endsWith("_L")) return "Left Bank";
                    if (upper.endsWith("R") || upper.endsWith("_R")) return "Right Bank";
                    return "Common";
                  };
                  
                  const groups = { "Custom Layers": [], "Common": [], "Left Bank": [], "Right Bank": [] };
                  [...layers].reverse().forEach((layer, ri) => {
                     const grp = getGroup(layer);
                     if (!groups[grp]) groups[grp] = [];
                     groups[grp].push({ layer, ri });
                  });
                  
                  const renderLegendItem = (item) => {
                    const { layer, ri } = item;
                    const oi = layers.length - 1 - ri;
                    return (
                      <div key={layer.name || oi} className="legend-item"
                        draggable
                        onDragStart={(e) => {
                          setDraggedIdx(ri);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", ri);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggedIdx === null || draggedIdx === ri) return;
                          const newLegend = [...layers].reverse();
                          const [removed] = newLegend.splice(draggedIdx, 1);
                          newLegend.splice(ri, 0, removed);
                          setLayers(newLegend.reverse());
                          setDraggedIdx(null);
                        }}
                        onDragEnd={() => setDraggedIdx(null)}
                        style={{
                          opacity: draggedIdx === ri ? 0.4 : 1,
                          cursor: "grab",
                          display: "flex",
                          alignItems: "center",
                          borderBottom: "1px solid var(--glass-border)",
                          padding: "4px 0",
                          transition: "opacity 0.2s"
                        }}
                      >
                        <input type="checkbox" checked={layer.visible} onChange={() => toggleLayer(oi)} />
                        <input type="color" className="legend-color-picker"
                          value={layer.color || COLORS[oi % COLORS.length]}
                          onChange={e => changeLayerColor(oi, e.target.value)}
                          title="Change layer color" />
                        <span className="legend-label" title={layer.name}>{layer.name}</span>
                        <button className="zoom-to-layer-btn" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-color)", padding: 0, marginLeft: "auto" }} onClick={() => setZoomToTarget(layer.data)} title="Zoom to layer"><ZoomIcon /></button>
                        <button className="remove-layer-btn" onClick={(e) => { e.stopPropagation(); removeLayer(oi); }} title="Remove layer (ArcGIS style)"><TrashIcon /></button>
                      </div>
                    );
                  };

                  return (
                    <>
                      {/* Custom User Layers (dragged and dropped shapefiles) at the top */}
                      {groups["Custom Layers"].length > 0 && (
                        <div style={{ marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--glass-border)", paddingBottom: "4px", marginBottom: "4px" }}>
                            <button 
                              onClick={() => setCollapsedGroups(prev => ({ ...prev, "Custom Layers": !prev["Custom Layers"] }))}
                              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 8px 0 0", color: "var(--text-color)", fontSize: "10px" }}
                            >
                              {collapsedGroups["Custom Layers"] ? "▶" : "▼"}
                            </button>
                            <input 
                              type="checkbox" 
                              checked={groups["Custom Layers"].every(item => item.layer.visible)} 
                              onChange={() => {
                                const allVis = groups["Custom Layers"].every(item => item.layer.visible);
                                setLayers(prev => prev.map(l => l.isUserLayer ? { ...l, visible: !allVis } : l));
                              }} 
                              style={{ marginRight: "10px" }} 
                            />
                            <strong style={{ fontSize: "13px", color: "var(--accent-color, #3b82f6)" }}>
                              Custom Layers ({groups["Custom Layers"].length})
                            </strong>
                          </div>
                          {!collapsedGroups["Custom Layers"] && groups["Custom Layers"].map(item => renderLegendItem(item))}
                        </div>
                      )}

                      {/* Common ungrouped items */}
                      {groups["Common"].length > 0 && (
                        <div style={{ marginBottom: "8px" }}>
                          {groups["Common"].map(item => renderLegendItem(item))}
                        </div>
                      )}
                      
                      {/* Left and Right Bank groups */}
                      {["Left Bank", "Right Bank"].map(groupName => {
                        const groupItems = groups[groupName];
                        if (groupItems.length === 0) return null;
                        const allVisible = groupItems.every(item => item.layer.visible);
                        
                        return (
                          <div key={groupName} style={{ marginBottom: "8px" }}>
                            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--glass-border)", paddingBottom: "4px", marginBottom: "4px" }}>
                              <button 
                                onClick={() => setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))}
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 8px 0 0", color: "var(--text-color)", fontSize: "10px" }}
                              >
                                {collapsedGroups[groupName] ? "▶" : "▼"}
                              </button>
                              <input type="checkbox" checked={allVisible} onChange={() => {
                                const newState = !allVisible;
                                setLayers(prev => prev.map(l => (!l.isUserLayer && getGroup(l) === groupName) ? { ...l, visible: newState } : l));
                              }} style={{ marginRight: "10px" }} />
                              <strong style={{ fontSize: "13px" }}>{groupName}</strong>
                            </div>
                            {!collapsedGroups[groupName] && groupItems.map(item => renderLegendItem(item))}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )
          )}
        </div>

        {/* Parameter panel */}
        {transectStatsGeoJson && (
          <DraggableParamPanel 
            activeParamKey={activeParamKey} 
            handleParamToggle={handleParamToggle}
            paramBankFilter={paramBankFilter}
            setParamBankFilter={setParamBankFilter}
          />
        )}
      </div>

      {/* Draggable parameter legend */}
      {filteredTransectStatsGeoJson && activeParamDef && (() => {
        // Resolve the correct break array for the legend.
        // paramBreaks is { L: [...], R: [...] } – pick the side-specific array.
        let legendBreaks = paramBreaks;
        if (paramBreaks && typeof paramBreaks === "object" && !Array.isArray(paramBreaks)) {
          if (paramBankFilter === "L") legendBreaks = paramBreaks.L;
          else if (paramBankFilter === "R") legendBreaks = paramBreaks.R;
          else legendBreaks = paramBreaks.Both || paramBreaks.L || paramBreaks.R;
        }
        return <DraggableLegend activeParam={activeParamDef} breaks={legendBreaks} />;
      })()}

      {/* Spatial Map Designer Modal */}
      {spatialModalOpen && (
        <SpatialMapDesignerModal
          isOpen={spatialModalOpen}
          onClose={() => {
            setSpatialModalOpen(false);
            setSpatialCropData(null);
          }}
          mapCropData={spatialCropData}
          layers={layers.map((l, idx) => ({ ...l, color: l.color || COLORS[idx % COLORS.length] }))}
          activeParamDef={activeParamDef}
          paramBreaks={paramBreaks}
          paramBankFilter={paramBankFilter}
          theme={theme}
        />
      )}
    </div>
  );
}
