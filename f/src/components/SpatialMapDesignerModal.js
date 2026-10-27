import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  buildInitialLegendSets,
  buildInitialLegendItems,
  renderComposedSpatialMap,
  downloadCanvasImage,
} from "./spatialMapHelper.js";

export default function SpatialMapDesignerModal({
  isOpen,
  onClose,
  mapCropData,
  layers = [],
  activeParamDef = null,
  paramBreaks = null,
  paramBankFilter = "Both",
  theme = "light",
}) {
  const [title, setTitle] = useState("River Bankline Spatial Analysis");
  const [downloadFilename, setDownloadFilename] = useState("River_Bankline_Spatial_Map");
  const [isCustomFilename, setIsCustomFilename] = useState(false);

  const handleTitleChange = (newTitle) => {
    setTitle(newTitle);
    if (!isCustomFilename) {
      setDownloadFilename(newTitle.replace(/[<>:"/\\|?*\s]+/g, "_").trim() || "Spatial_Map");
    }
  };

  const handleFilenameChange = (newName) => {
    setDownloadFilename(newName);
    setIsCustomFilename(true);
  };
  const [legendTitle, setLegendTitle] = useState("Map Layers");
  const [legendItems, setLegendItems] = useState([]);
  const [legendPos, setLegendPos] = useState({ x: 4, y: 70 });
  const [legendSize, setLegendSize] = useState({
    width: 240,
    rowHeight: 22,
    fontSize: 12,
    scale: 1.0,
    isMinimized: false,
  });

  // Separate Statistics Legend Box States
  const [statLegendTitle, setStatLegendTitle] = useState("Statistical Analysis");
  const [statLegendItems, setStatLegendItems] = useState([]);
  const [statLegendPos, setStatLegendPos] = useState({ x: 96, y: 70 });
  const [statLegendSize, setStatLegendSize] = useState({
    width: 260,
    rowHeight: 22,
    fontSize: 12,
    scale: 1.0,
    isMinimized: false,
  });
  const [activeLegendSubTab, setActiveLegendSubTab] = useState("layers"); // "layers" | "stats" // Bottom-left default
  const [format, setFormat] = useState("png");
  const [activeTab, setActiveTab] = useState("legend"); // "legend" | "elements" | "export"
  const [exporting, setExporting] = useState(false);

  const [options, setOptions] = useState({
    showTitle: true,
    showCoordinates: true,
    showScale: true,
    showNorthArrow: true,
    showLegend: true,
    showStatLegend: true,
    showGrid: false,
    theme: theme,
    coordFormat: "hemisphere",
    coordFontSize: 22,
  });

  const previewCanvasRef = useRef(null);
  const legendBoxesRef = useRef({ layers: null, stats: null });
  const isDraggingLegend = useRef(false);
  const dragStartPos = useRef({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });

  // Window modal bounds (x, y, width, height), minimized, maximized state
  const [modalBounds, setModalBounds] = useState(() => {
    const defaultW = Math.min(window.innerWidth * 0.94, 1300);
    const defaultH = Math.min(window.innerHeight * 0.90, 850);
    const defaultX = Math.max(10, Math.round((window.innerWidth - defaultW) / 2));
    const defaultY = Math.max(10, Math.round((window.innerHeight - defaultH) / 2));
    return { x: defaultX, y: defaultY, width: defaultW, height: defaultH };
  });

  const [isModalMaximized, setIsModalMaximized] = useState(false);
  const [isModalMinimized, setIsModalMinimized] = useState(false);
  const prevBoundsRef = useRef(modalBounds);

  const isDraggingWindowRef = useRef(false);
  const dragWindowStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  const isResizingWindowRef = useRef(false);
  const resizeDirectionRef = useRef(null);
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (isOpen) {
      const defaultW = Math.min(window.innerWidth * 0.94, 1300);
      const defaultH = Math.min(window.innerHeight * 0.90, 850);
      const defaultX = Math.max(10, Math.round((window.innerWidth - defaultW) / 2));
      const defaultY = Math.max(10, Math.round((window.innerHeight - defaultH) / 2));
      setModalBounds((prev) => {
        if (
          prev &&
          prev.width &&
          prev.height &&
          prev.x < window.innerWidth - 100 &&
          prev.y < window.innerHeight - 80
        ) {
          return prev;
        }
        return { x: defaultX, y: defaultY, width: defaultW, height: defaultH };
      });
      setIsModalMinimized(false);
    }
  }, [isOpen]);

  const handleWindowHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select")) {
      return;
    }
    if (isModalMaximized) return;

    e.preventDefault();
    isDraggingWindowRef.current = true;
    dragWindowStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: modalBounds.x,
      startY: modalBounds.y,
    };

    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent) => {
      if (!isDraggingWindowRef.current) return;
      const dx = moveEvent.clientX - dragWindowStartRef.current.mouseX;
      const dy = moveEvent.clientY - dragWindowStartRef.current.mouseY;

      const currentW = isModalMinimized ? Math.min(modalBounds.width, 420) : modalBounds.width;
      const minX = 0;
      const maxX = Math.max(0, window.innerWidth - currentW);
      const minY = 0;
      const maxY = Math.max(0, window.innerHeight - 50);

      const newX = Math.max(minX, Math.min(maxX, dragWindowStartRef.current.startX + dx));
      const newY = Math.max(minY, Math.min(maxY, dragWindowStartRef.current.startY + dy));

      setModalBounds((prev) => ({ ...prev, x: newX, y: newY }));
    };

    const handleMouseUp = () => {
      isDraggingWindowRef.current = false;
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleResizeHandleMouseDown = (direction, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (isModalMaximized || isModalMinimized) return;

    isResizingWindowRef.current = true;
    resizeDirectionRef.current = direction;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: modalBounds.x,
      y: modalBounds.y,
      width: modalBounds.width,
      height: modalBounds.height,
    };

    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent) => {
      if (!isResizingWindowRef.current) return;
      const dir = resizeDirectionRef.current;
      const start = resizeStartRef.current;
      const dx = moveEvent.clientX - start.mouseX;
      const dy = moveEvent.clientY - start.mouseY;

      const minW = 540;
      const minH = 380;

      let newX = start.x;
      let newY = start.y;
      let newW = start.width;
      let newH = start.height;

      if (dir.includes("e")) {
        newW = Math.max(minW, Math.min(window.innerWidth - start.x, start.width + dx));
      }
      if (dir.includes("w")) {
        const maxDx = start.width - minW;
        const clampedDx = Math.min(maxDx, Math.max(-start.x, dx));
        newW = start.width - clampedDx;
        newX = start.x + clampedDx;
      }
      if (dir.includes("s")) {
        newH = Math.max(minH, Math.min(window.innerHeight - start.y, start.height + dy));
      }
      if (dir.includes("n")) {
        const maxDy = start.height - minH;
        const clampedDy = Math.min(maxDy, Math.max(-start.y, dy));
        newH = start.height - clampedDy;
        newY = start.y + clampedDy;
      }

      setModalBounds({ x: newX, y: newY, width: newW, height: newH });
    };

    const handleMouseUp = () => {
      isResizingWindowRef.current = false;
      resizeDirectionRef.current = null;
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleToggleMaximize = (e) => {
    if (e) e.stopPropagation();
    if (isModalMinimized) {
      setIsModalMinimized(false);
      setIsModalMaximized(true);
      return;
    }
    if (!isModalMaximized) {
      prevBoundsRef.current = modalBounds;
      setIsModalMaximized(true);
    } else {
      setIsModalMaximized(false);
      if (prevBoundsRef.current) {
        setModalBounds(prevBoundsRef.current);
      }
    }
  };

  const handleToggleMinimize = (e) => {
    if (e) e.stopPropagation();
    setIsModalMinimized((prev) => !prev);
  };

  const handleHeaderDoubleClick = (e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    if (isModalMinimized) {
      setIsModalMinimized(false);
    } else {
      handleToggleMaximize();
    }
  };

  // Initialize separate legend items when modal opens or crop data / layers change
  useEffect(() => {
    if (isOpen && mapCropData) {
      const sets = buildInitialLegendSets(
        layers,
        activeParamDef,
        paramBreaks,
        paramBankFilter
      );
      setLegendItems(sets.layerItems);
      setStatLegendItems(sets.statItems);
      if (sets.statTitle) {
        setStatLegendTitle(sets.statTitle);
      }
      setOptions((prev) => ({ ...prev, theme }));
    }
  }, [isOpen, mapCropData, layers, activeParamDef, paramBreaks, paramBankFilter, theme]);

  // Redraw preview canvas whenever any option or legend changes
  const updatePreview = useCallback(() => {
    if (!mapCropData || !mapCropData.canvas || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;

    const composed = renderComposedSpatialMap({
      mapCanvas: mapCropData.canvas,
      bounds: mapCropData.bounds,
      title: options.showTitle ? title : "",
      legendItems,
      legendPos,
      legendTitle,
      legendSize,
      statLegendItems,
      statLegendPos,
      statLegendTitle,
      statLegendSize,
      options,
    });

    legendBoxesRef.current = {
      layers: composed._layersLegendBox,
      stats: composed._statLegendBox,
    };

    canvas.width = composed.width;
    canvas.height = composed.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(composed, 0, 0);
  }, [mapCropData, title, legendItems, legendPos, legendTitle, legendSize, statLegendItems, statLegendPos, statLegendTitle, statLegendSize, options]);

  useEffect(() => {
    if (isOpen && !isModalMinimized) {
      updatePreview();
      const animId = requestAnimationFrame(() => {
        updatePreview();
      });
      return () => cancelAnimationFrame(animId);
    }
  }, [isOpen, isModalMinimized, isModalMaximized, updatePreview]);

  // Handle dragging the legend box on the preview canvas
  const handlePreviewMouseDown = (e) => {
    if (!previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert preview coordinate to canvas pixel space
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasMouseX = mouseX * scaleX;
    const canvasMouseY = mouseY * scaleY;

    const statsBox = legendBoxesRef.current.stats;
    const layersBox = legendBoxesRef.current.layers;

    let target = "layers";
    if (statsBox && statLegendItems.length > 0 && options.showStatLegend !== false) {
      const inStats =
        canvasMouseX >= statsBox.x &&
        canvasMouseX <= statsBox.x + statsBox.width &&
        canvasMouseY >= statsBox.y &&
        canvasMouseY <= statsBox.y + statsBox.height;

      const inLayers =
        layersBox &&
        canvasMouseX >= layersBox.x &&
        canvasMouseX <= layersBox.x + layersBox.width &&
        canvasMouseY >= layersBox.y &&
        canvasMouseY <= layersBox.y + layersBox.height;

      if (inStats && !inLayers) {
        target = "stats";
      } else if (!inStats && !inLayers) {
        const distToStats = Math.hypot(canvasMouseX - (statsBox.x + statsBox.width / 2), canvasMouseY - (statsBox.y + statsBox.height / 2));
        const distToLayers = layersBox ? Math.hypot(canvasMouseX - (layersBox.x + layersBox.width / 2), canvasMouseY - (layersBox.y + layersBox.height / 2)) : Infinity;
        if (distToStats < distToLayers) {
          target = "stats";
        }
      }
    }

    isDraggingLegend.current = target;
    dragStartPos.current = {
      mouseX,
      mouseY,
      initialX: target === "stats" ? statLegendPos.x : legendPos.x,
      initialY: target === "stats" ? statLegendPos.y : legendPos.y,
      canvasW: rect.width,
      canvasH: rect.height,
    };
  };

  const handlePreviewMouseMove = (e) => {
    const target = isDraggingLegend.current;
    if (!target) return;
    const rect = previewCanvasRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - rect.left) - dragStartPos.current.mouseX;
    const deltaY = (e.clientY - rect.top) - dragStartPos.current.mouseY;

    const percentDeltaX = (deltaX / dragStartPos.current.canvasW) * 100;
    const percentDeltaY = (deltaY / dragStartPos.current.canvasH) * 100;

    const newX = Math.max(0, Math.min(100, dragStartPos.current.initialX + percentDeltaX));
    const newY = Math.max(0, Math.min(100, dragStartPos.current.initialY + percentDeltaY));

    if (target === "stats") {
      setStatLegendPos({ x: Math.round(newX), y: Math.round(newY) });
    } else {
      setLegendPos({ x: Math.round(newX), y: Math.round(newY) });
    }
  };

  const handlePreviewMouseUp = () => {
    isDraggingLegend.current = null;
  };

  // Preset legend position snaps
  const snapLegend = (preset) => {
    switch (preset) {
      case "tl":
        setLegendPos({ x: 0, y: 0 });
        break;
      case "tr":
        setLegendPos({ x: 100, y: 0 });
        break;
      case "bl":
        setLegendPos({ x: 0, y: 100 });
        break;
      case "br":
        setLegendPos({ x: 100, y: 100 });
        break;
      default:
        break;
    }
  };

  // Modify individual legend item label or color
  const updateLegendItem = (id, field, value) => {
    setLegendItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  // Toggle item visibility
  const toggleLegendItem = (id) => {
    setLegendItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item))
    );
  };

  const updateStatLegendItem = (id, field, value) => {
    setStatLegendItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const toggleStatLegendItem = (id) => {
    setStatLegendItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item))
    );
  };

  // Export action
  const handleExport = () => {
    if (!mapCropData || !mapCropData.canvas) return;
    setExporting(true);
    try {
      const finalCanvas = renderComposedSpatialMap({
        mapCanvas: mapCropData.canvas,
        bounds: mapCropData.bounds,
        title: options.showTitle ? title : "",
        legendItems,
        legendPos,
        legendTitle,
        legendSize,
        statLegendItems,
        statLegendPos,
        statLegendTitle,
        statLegendSize,
        options,
      });

      const finalName = downloadFilename.trim() || title || "Spatial_Map";
      downloadCanvasImage(finalCanvas, finalName, format);
      setTimeout(() => {
        setExporting(false);
      }, 800);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to export map: " + err.message);
      setExporting(false);
    }
  };

  if (!isOpen || !mapCropData) return null;

  const containerStyle = isModalMinimized
    ? {
        position: "fixed",
        left: modalBounds.x,
        top: modalBounds.y,
        width: Math.min(modalBounds.width, 420),
        height: "auto",
        minHeight: "unset",
        maxHeight: "none",
        borderRadius: "10px",
        zIndex: 3001,
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
      }
    : isModalMaximized
    ? {
        position: "fixed",
        left: 8,
        top: 8,
        width: "calc(100vw - 16px)",
        height: "calc(100vh - 16px)",
        maxWidth: "none",
        maxHeight: "none",
        borderRadius: "10px",
        zIndex: 3001,
      }
    : {
        position: "fixed",
        left: modalBounds.x,
        top: modalBounds.y,
        width: modalBounds.width,
        height: modalBounds.height,
        maxWidth: "none",
        maxHeight: "none",
        borderRadius: "16px",
        zIndex: 3001,
      };

  return (
    <div
      className="spatial-modal-backdrop"
      style={
        isModalMinimized
          ? {
              pointerEvents: "none",
              background: "transparent",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }
          : { pointerEvents: "auto" }
      }
      onClick={(e) => {
        if (e.target === e.currentTarget && !isModalMinimized) {
          onClose();
        }
      }}
    >
      <div
        className="spatial-modal-container"
        style={{ ...containerStyle, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Resize Handles (8 directions: edges and corners) */}
        {!isModalMaximized && !isModalMinimized && (
          <>
            <div
              className="spatial-resize-handle spatial-resize-n"
              onMouseDown={(e) => handleResizeHandleMouseDown("n", e)}
              title="Resize Top Edge"
            />
            <div
              className="spatial-resize-handle spatial-resize-s"
              onMouseDown={(e) => handleResizeHandleMouseDown("s", e)}
              title="Resize Bottom Edge"
            />
            <div
              className="spatial-resize-handle spatial-resize-e"
              onMouseDown={(e) => handleResizeHandleMouseDown("e", e)}
              title="Resize Right Edge"
            />
            <div
              className="spatial-resize-handle spatial-resize-w"
              onMouseDown={(e) => handleResizeHandleMouseDown("w", e)}
              title="Resize Left Edge"
            />
            <div
              className="spatial-resize-handle spatial-resize-ne"
              onMouseDown={(e) => handleResizeHandleMouseDown("ne", e)}
              title="Resize Top-Right Corner"
            />
            <div
              className="spatial-resize-handle spatial-resize-nw"
              onMouseDown={(e) => handleResizeHandleMouseDown("nw", e)}
              title="Resize Top-Left Corner"
            />
            <div
              className="spatial-resize-handle spatial-resize-se"
              onMouseDown={(e) => handleResizeHandleMouseDown("se", e)}
              title="Resize Bottom-Right Corner"
            />
            <div
              className="spatial-resize-handle spatial-resize-sw"
              onMouseDown={(e) => handleResizeHandleMouseDown("sw", e)}
              title="Resize Bottom-Left Corner"
            />
          </>
        )}

        {/* Modal Header */}
        <div
          className="spatial-modal-header"
          onMouseDown={handleWindowHeaderMouseDown}
          onDoubleClick={handleHeaderDoubleClick}
          style={{
            cursor: isModalMaximized ? "default" : isModalMinimized ? "pointer" : "grab",
          }}
          title={
            isModalMinimized
              ? "Click or double-click to restore"
              : isModalMaximized
              ? "Double-click to restore size"
              : "Click and drag to move window • Double-click to maximize"
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, overflow: "hidden" }}>
            <span style={{ fontSize: "20px" }}>🗺️</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: "700" }}>
                Spatial Data Visualization
              </h2>
              {isModalMinimized && (
                <span
                  style={{
                    fontSize: "11px",
                    background: "rgba(59, 130, 246, 0.25)",
                    color: "#93c5fd",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontWeight: 600,
                  }}
                >
                  Minimized
                </span>
              )}
            </div>
          </div>

          <div className="spatial-modal-header-actions">
            {/* Minimize / Restore Button */}
            <button
              className="spatial-modal-action-btn"
              onClick={handleToggleMinimize}
              title={isModalMinimized ? "Restore (Expand)" : "Minimize"}
            >
              {isModalMinimized ? (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 12h12v2H2v-2z" />
                </svg>
              )}
            </button>

            {/* Maximize / Restore Button */}
            <button
              className="spatial-modal-action-btn"
              onClick={handleToggleMaximize}
              title={isModalMaximized && !isModalMinimized ? "Restore down" : "Maximize"}
            >
              {isModalMaximized && !isModalMinimized ? (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 5v8h8V5H3zm7 7H4V6h6v6z" />
                  <path d="M5 2h9v9h-2V4H5V2z" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" />
                </svg>
              )}
            </button>

            {/* Close Button */}
            <button
              className="spatial-modal-action-btn close"
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body (Preserved in DOM to retain canvas state, visibility toggled) */}
        <div
          className="spatial-modal-body"
          style={{ display: isModalMinimized ? "none" : "flex" }}
        >
          {/* Left Column: Interactive Canvas Preview */}
          <div className="spatial-preview-pane">

            <div
              className="spatial-canvas-scroll-container"
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
            >
              <canvas
                ref={previewCanvasRef}
                className="spatial-preview-canvas"
                onMouseDown={handlePreviewMouseDown}
                style={{ cursor: isDraggingLegend.current ? "grabbing" : "grab" }}
                title="Click and drag to reposition the legend box"
              />
            </div>
          </div>

          {/* Right Column: Customization Controls */}
          <div className="spatial-controls-pane">
            {/* Tabs */}
            <div className="spatial-tabs">
              <button
                className={`spatial-tab-btn ${activeTab === "legend" ? "active" : ""}`}
                onClick={() => setActiveTab("legend")}
                title="Legend Box"
              >
                📋 Legend
              </button>
              <button
                className={`spatial-tab-btn ${activeTab === "elements" ? "active" : ""}`}
                onClick={() => setActiveTab("elements")}
                title="Frame Elements"
              >
                📐 Frame
              </button>
              <button
                className={`spatial-tab-btn ${activeTab === "export" ? "active" : ""}`}
                onClick={() => setActiveTab("export")}
                title="Export"
              >
                💾 Export
              </button>
            </div>

            {/* TAB 1: Legend Customizer */}
            {activeTab === "legend" && (
              <div className="spatial-tab-content">
                <div className="control-group">
                  <label className="control-label">Map Header Title</label>
                  <input
                    type="text"
                    className="control-input"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Enter Map Header Title"
                  />
                </div>

                <div className="control-group">
                  <label className="control-label">Downloadable Map File Name</label>
                  <input
                    type="text"
                    className="control-input"
                    value={downloadFilename}
                    onChange={(e) => handleFilenameChange(e.target.value)}
                    placeholder="Enter Download File Name (without extension)"
                  />
                </div>

                {/* Subtabs for Vector Layers vs Statistics Legend */}
                {statLegendItems && statLegendItems.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", margin: "6px 0", borderBottom: "1px solid var(--glass-border)", paddingBottom: "6px" }}>
                    <button
                      className={`spatial-tab-btn ${activeLegendSubTab === "layers" ? "active" : ""}`}
                      onClick={() => setActiveLegendSubTab("layers")}
                      style={{ flex: 1, fontSize: "11px", padding: "4px 2px" }}
                    >
                      🗺️ Layers ({legendItems.filter(i => i.visible !== false).length})
                    </button>
                    <button
                      className={`spatial-tab-btn ${activeLegendSubTab === "stats" ? "active" : ""}`}
                      onClick={() => setActiveLegendSubTab("stats")}
                      style={{ flex: 1, fontSize: "11px", padding: "4px 2px" }}
                    >
                      📊 Stats ({statLegendItems.filter(i => i.visible !== false).length})
                    </button>
                  </div>
                )}

                {/* --- SUBTAB A: Vector Layers Legend --- */}
                {(activeLegendSubTab === "layers" || !statLegendItems || statLegendItems.length === 0) && (
                  <>
                    <div className="control-group">
                      <label className="control-label">Legend Header</label>
                      <input
                        type="text"
                        className="control-input"
                        value={legendTitle}
                        onChange={(e) => setLegendTitle(e.target.value)}
                        placeholder="Layers Legend Title"
                      />
                    </div>

                    {/* Layers Legend Box Sizing */}
                    <div className="control-group" style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--glass-border)", marginTop: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <label className="control-label" style={{ margin: 0, fontWeight: "600" }}>
                          📏 Layers Legend Box Size
                        </label>
                        <button
                          className="snap-btn"
                          onClick={() => setLegendSize(prev => ({ ...prev, isMinimized: !prev.isMinimized }))}
                          style={{ fontSize: "10px", padding: "1px 6px" }}
                        >
                          {legendSize.isMinimized ? "⛶ Maximize" : "🗕 Minimize"}
                        </button>
                      </div>

                      {!legendSize.isMinimized && (
                        <>
                          <div style={{ marginBottom: "5px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Breadth:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                <input
                                  type="number"
                                  min="30"
                                  value={legendSize.width}
                                  onChange={(e) => setLegendSize({ ...legendSize, width: Math.max(20, parseInt(e.target.value, 10) || 20) })}
                                  style={{ width: "52px", padding: "1px 4px", fontSize: "11px", textAlign: "right", borderRadius: "3px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                                />
                                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>px</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="50"
                              max="1200"
                              step="10"
                              value={Math.min(1200, legendSize.width)}
                              onChange={(e) => setLegendSize({ ...legendSize, width: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div style={{ marginBottom: "5px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Font Size:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                <input
                                  type="number"
                                  min="8"
                                  max="32"
                                  value={legendSize.fontSize || 12}
                                  onChange={(e) => setLegendSize({ ...legendSize, fontSize: Math.max(8, parseInt(e.target.value, 10) || 12) })}
                                  style={{ width: "45px", padding: "1px 4px", fontSize: "11px", textAlign: "right", borderRadius: "3px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                                />
                                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>px</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="8"
                              max="28"
                              step="1"
                              value={legendSize.fontSize || 12}
                              onChange={(e) => setLegendSize({ ...legendSize, fontSize: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div style={{ marginBottom: "3px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Length (Row Spacing):</span>
                              <strong>{legendSize.rowHeight} px</strong>
                            </div>
                            <input
                              type="range"
                              min="16"
                              max="38"
                              step="2"
                              value={legendSize.rowHeight}
                              onChange={(e) => setLegendSize({ ...legendSize, rowHeight: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Layers Legend Position Controls */}
                    <div className="control-group" style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--glass-border)", marginTop: "6px" }}>
                      <label className="control-label" style={{ margin: "0 0 4px 0", fontWeight: "600" }}>
                        📍 Layers Legend Position (Drag freely on map)
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "4px" }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginBottom: "1px" }}>
                            <span>Horizontal (X):</span>
                            <strong>{legendPos.x}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={legendPos.x}
                            onChange={(e) => setLegendPos({ ...legendPos, x: parseInt(e.target.value, 10) })}
                            style={{ width: "100%" }}
                          />
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginBottom: "1px" }}>
                            <span>Vertical (Y):</span>
                            <strong>{legendPos.y}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={legendPos.y}
                            onChange={(e) => setLegendPos({ ...legendPos, y: parseInt(e.target.value, 10) })}
                            style={{ width: "100%" }}
                          />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: "10px", opacity: 0.7 }}>Snaps:</span>
                        <button className="snap-btn" onClick={() => setLegendPos({ x: 0, y: 0 })}>↖ Top-Left</button>
                        <button className="snap-btn" onClick={() => setLegendPos({ x: 100, y: 0 })}>↗ Top-Right</button>
                        <button className="snap-btn" onClick={() => setLegendPos({ x: 0, y: 100 })}>↙ Bottom-Left</button>
                        <button className="snap-btn" onClick={() => setLegendPos({ x: 100, y: 100 })}>↘ Bottom-Right</button>
                        <button className="snap-btn" onClick={() => setLegendPos({ x: 50, y: 50 })}>⊙ Center</button>
                      </div>
                    </div>

                    {/* Layers Items List */}
                    <div style={{ marginTop: "12px" }}>
                      <label className="control-label" style={{ marginBottom: "6px" }}>
                        Vector Layers & Custom Shapefiles
                      </label>
                      <div className="legend-items-editor-list">
                        {legendItems.map((item) => (
                          <div key={item.id} className="legend-item-row">
                            <input
                              type="checkbox"
                              checked={item.visible !== false}
                              onChange={() => toggleLegendItem(item.id)}
                              title="Show/Hide layer in legend"
                            />
                            <input
                              type="color"
                              value={item.color || "#3b82f6"}
                              onChange={(e) => updateLegendItem(item.id, "color", e.target.value)}
                              className="legend-color-swatch-picker"
                              title="Change swatch color"
                            />
                            <input
                              type="text"
                              value={item.label || item.name}
                              onChange={(e) => updateLegendItem(item.id, "label", e.target.value)}
                              className="legend-label-edit-input"
                              title="Edit layer label"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* --- SUBTAB B: Separate Statistics Parameters Legend --- */}
                {activeLegendSubTab === "stats" && statLegendItems && statLegendItems.length > 0 && (
                  <>
                    <div className="control-group">
                      <label className="control-label">Statistics Legend Header</label>
                      <input
                        type="text"
                        className="control-input"
                        value={statLegendTitle}
                        onChange={(e) => setStatLegendTitle(e.target.value)}
                        placeholder="Statistics Legend Title"
                      />
                    </div>

                    {/* Statistics Legend Box Sizing */}
                    <div className="control-group" style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--glass-border)", marginTop: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <label className="control-label" style={{ margin: 0, fontWeight: "600" }}>
                          📏 Statistics Legend Box Size
                        </label>
                        <button
                          className="snap-btn"
                          onClick={() => setStatLegendSize(prev => ({ ...prev, isMinimized: !prev.isMinimized }))}
                          style={{ fontSize: "10px", padding: "1px 6px" }}
                        >
                          {statLegendSize.isMinimized ? "⛶ Maximize" : "🗕 Minimize"}
                        </button>
                      </div>

                      {!statLegendSize.isMinimized && (
                        <>
                          <div style={{ marginBottom: "5px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Breadth:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                <input
                                  type="number"
                                  min="30"
                                  value={statLegendSize.width}
                                  onChange={(e) => setStatLegendSize({ ...statLegendSize, width: Math.max(20, parseInt(e.target.value, 10) || 20) })}
                                  style={{ width: "52px", padding: "1px 4px", fontSize: "11px", textAlign: "right", borderRadius: "3px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                                />
                                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>px</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="50"
                              max="1200"
                              step="10"
                              value={Math.min(1200, statLegendSize.width)}
                              onChange={(e) => setStatLegendSize({ ...statLegendSize, width: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div style={{ marginBottom: "5px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Font Size:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                <input
                                  type="number"
                                  min="8"
                                  max="32"
                                  value={statLegendSize.fontSize || 12}
                                  onChange={(e) => setStatLegendSize({ ...statLegendSize, fontSize: Math.max(8, parseInt(e.target.value, 10) || 12) })}
                                  style={{ width: "45px", padding: "1px 4px", fontSize: "11px", textAlign: "right", borderRadius: "3px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                                />
                                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>px</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="8"
                              max="28"
                              step="1"
                              value={statLegendSize.fontSize || 12}
                              onChange={(e) => setStatLegendSize({ ...statLegendSize, fontSize: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div style={{ marginBottom: "3px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "1px" }}>
                              <span>Length (Row Spacing):</span>
                              <strong>{statLegendSize.rowHeight} px</strong>
                            </div>
                            <input
                              type="range"
                              min="16"
                              max="38"
                              step="2"
                              value={statLegendSize.rowHeight}
                              onChange={(e) => setStatLegendSize({ ...statLegendSize, rowHeight: parseInt(e.target.value, 10) })}
                              style={{ width: "100%" }}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Statistics Legend Position Controls */}
                    <div className="control-group" style={{ background: "rgba(255,255,255,0.03)", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--glass-border)", marginTop: "6px" }}>
                      <label className="control-label" style={{ margin: "0 0 4px 0", fontWeight: "600" }}>
                        📍 Statistics Legend Position (Drag freely on map)
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "4px" }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginBottom: "1px" }}>
                            <span>Horizontal (X):</span>
                            <strong>{statLegendPos.x}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={statLegendPos.x}
                            onChange={(e) => setStatLegendPos({ ...statLegendPos, x: parseInt(e.target.value, 10) })}
                            style={{ width: "100%" }}
                          />
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginBottom: "1px" }}>
                            <span>Vertical (Y):</span>
                            <strong>{statLegendPos.y}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={statLegendPos.y}
                            onChange={(e) => setStatLegendPos({ ...statLegendPos, y: parseInt(e.target.value, 10) })}
                            style={{ width: "100%" }}
                          />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: "10px", opacity: 0.7 }}>Snaps:</span>
                        <button className="snap-btn" onClick={() => setStatLegendPos({ x: 0, y: 0 })}>↖ Top-Left</button>
                        <button className="snap-btn" onClick={() => setStatLegendPos({ x: 100, y: 0 })}>↗ Top-Right</button>
                        <button className="snap-btn" onClick={() => setStatLegendPos({ x: 0, y: 100 })}>↙ Bottom-Left</button>
                        <button className="snap-btn" onClick={() => setStatLegendPos({ x: 100, y: 100 })}>↘ Bottom-Right</button>
                        <button className="snap-btn" onClick={() => setStatLegendPos({ x: 50, y: 50 })}>⊙ Center</button>
                      </div>
                    </div>

                    {/* Statistics Classes List */}
                    <div style={{ marginTop: "12px" }}>
                      <label className="control-label" style={{ marginBottom: "6px" }}>
                        Statistical Parameters & Colour Code Ranges
                      </label>
                      <div className="legend-items-editor-list">
                        {statLegendItems.map((item) => (
                          <div key={item.id} className="legend-item-row">
                            <input
                              type="checkbox"
                              checked={item.visible !== false}
                              onChange={() => toggleStatLegendItem(item.id)}
                              title="Show/Hide class in statistics legend"
                            />
                            <input
                              type="color"
                              value={item.color || "#888"}
                              onChange={(e) => updateStatLegendItem(item.id, "color", e.target.value)}
                              className="legend-color-swatch-picker"
                              title="Change class color"
                            />
                            <input
                              type="text"
                              value={item.label || item.name}
                              onChange={(e) => updateStatLegendItem(item.id, "label", e.target.value)}
                              className="legend-label-edit-input"
                              title="Edit range label"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB 2: Cartographic Elements & Frame */}
            {activeTab === "elements" && (
              <div className="spatial-tab-content">
                <div className="toggles-grid">
                  <label className="toggle-label-row">
                    <input
                      type="checkbox"
                      checked={options.showTitle}
                      onChange={(e) => setOptions({ ...options, showTitle: e.target.checked })}
                    />
                    <span>Show Title Banner</span>
                  </label>

                  <label className="toggle-label-row">
                    <input
                      type="checkbox"
                      checked={options.showCoordinates}
                      onChange={(e) => setOptions({ ...options, showCoordinates: e.target.checked })}
                    />
                    <span>Show Latitude & Longitude Frame</span>
                  </label>

                  <label className="toggle-label-row">
                    <input
                      type="checkbox"
                      checked={options.showScale}
                      onChange={(e) => setOptions({ ...options, showScale: e.target.checked })}
                    />
                    <span>Show Metric Distance Scale Bar</span>
                  </label>

                  <label className="toggle-label-row">
                    <input
                      type="checkbox"
                      checked={options.showNorthArrow}
                      onChange={(e) => setOptions({ ...options, showNorthArrow: e.target.checked })}
                    />
                    <span>Show North Compass Arrow</span>
                  </label>

                  <label className="toggle-label-row">
                    <input
                      type="checkbox"
                      checked={options.showLegend}
                      onChange={(e) => setOptions({ ...options, showLegend: e.target.checked })}
                    />
                    <span>Show Vector Layers Legend Box</span>
                  </label>

                  {statLegendItems && statLegendItems.length > 0 && (
                    <label className="toggle-label-row">
                      <input
                        type="checkbox"
                        checked={options.showStatLegend}
                        onChange={(e) => setOptions({ ...options, showStatLegend: e.target.checked })}
                      />
                      <span>Show Statistics Parameters Legend Box</span>
                    </label>
                  )}
                </div>

                                <div className="control-group" style={{ marginTop: "14px" }}>
                  <label className="control-label">Lat/Long Coordinate Format</label>
                  <div style={{ display: "flex", gap: "12px", marginTop: "4px", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="coordFormat"
                        checked={options.coordFormat === "plain"}
                        onChange={() => setOptions({ ...options, coordFormat: "plain" })}
                      />
                      Plain Number (81.5 / 26.5)
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="coordFormat"
                        checked={options.coordFormat === "hemisphere"}
                        onChange={() => setOptions({ ...options, coordFormat: "hemisphere" })}
                      />
                      With Direction (81.5°E / 26.5°N)
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="coordFormat"
                        checked={options.coordFormat === "degree"}
                        onChange={() => setOptions({ ...options, coordFormat: "degree" })}
                      />
                      Degree Only (81.5° / 26.5°)
                    </label>
                  </div>
                </div>

                <div className="control-group" style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                    <label className="control-label" style={{ margin: 0 }}>
                      Lat/Long Frame Font Size
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <input
                        type="number"
                        min="14"
                        max="36"
                        value={options.coordFontSize || 22}
                        onChange={(e) => setOptions({ ...options, coordFontSize: Math.max(12, parseInt(e.target.value, 10) || 22) })}
                        style={{ width: "45px", padding: "1px 4px", fontSize: "11px", textAlign: "right", borderRadius: "3px", border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.2)", color: "inherit" }}
                      />
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>px</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="14"
                    max="32"
                    step="1"
                    value={options.coordFontSize || 22}
                    onChange={(e) => setOptions({ ...options, coordFontSize: parseInt(e.target.value, 10) })}
                    style={{ width: "100%" }}
                  />
                </div>

                <div className="control-group" style={{ marginTop: "8px" }}>
                  <label className="control-label">Cartographic Theme</label>
                  <div style={{ display: "flex", gap: "10px", marginTop: "2px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="frameTheme"
                        checked={options.theme === "light"}
                        onChange={() => setOptions({ ...options, theme: "light" })}
                      />
                      Light Paper
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="frameTheme"
                        checked={options.theme === "dark"}
                        onChange={() => setOptions({ ...options, theme: "dark" })}
                      />
                      Dark GIS
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Export Options & Download */}
            {activeTab === "export" && (
              <div className="spatial-tab-content">
                <div className="control-group">
                  <label className="control-label">Export Format</label>
                  <div style={{ display: "flex", gap: "8px", marginTop: "3px" }}>
                    <label className="format-option-card">
                      <input
                        type="radio"
                        name="exportFormat"
                        value="png"
                        checked={format === "png"}
                        onChange={() => setFormat("png")}
                      />
                      <div>
                        <strong>PNG Image</strong>
                        <div style={{ fontSize: "10px", opacity: 0.7 }}>Lossless / print</div>
                      </div>
                    </label>
                    <label className="format-option-card">
                      <input
                        type="radio"
                        name="exportFormat"
                        value="jpeg"
                        checked={format === "jpeg"}
                        onChange={() => setFormat("jpeg")}
                      />
                      <div>
                        <strong>JPEG Image</strong>
                        <div style={{ fontSize: "10px", opacity: 0.7 }}>Standard photo</div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="control-group" style={{ marginTop: "8px" }}>
                  <label className="control-label" style={{ fontWeight: "600" }}>
                    📝 Downloadable Map File Name
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "3px" }}>
                    <input
                      type="text"
                      className="control-input"
                      value={downloadFilename}
                      onChange={(e) => handleFilenameChange(e.target.value)}
                      placeholder="Enter Download File Name"
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-muted)", padding: "4px 7px", background: "rgba(0,0,0,0.2)", borderRadius: "4px", border: "1px solid var(--glass-border)" }}>
                      .{format === "jpeg" ? "jpg" : "png"}
                    </span>
                  </div>
                  <div style={{ fontSize: "10.5px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Will download as: <strong>📄 {((downloadFilename || title || "Spatial_Map").replace(/[<>:"/\\|?*]+/g, "_").trim())}.{format === "jpeg" ? "jpg" : "png"}</strong>
                  </div>
                </div>

                <div style={{ marginTop: "12px" }}>
                  <button
                    className="spatial-export-submit-btn"
                    onClick={handleExport}
                    disabled={exporting}
                  >
                    {exporting ? "Generating High-Res Image..." : `📥 Export & Download ${format.toUpperCase()}`}
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Modal Actions */}
            <div className="spatial-modal-footer">
              <button className="spatial-cancel-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="spatial-quick-download-btn"
                onClick={handleExport}
                disabled={exporting}
                title="Download directly as configured"
              >
                {exporting ? "Exporting..." : `Download ${format.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
