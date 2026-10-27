import html2canvas from "html2canvas";

export const EIGHT_CLASS_PALETTE = [
  "#800000", // class 1 – dark maroon
  "#FF0000", // class 2 – bright red
  "#FF6600", // class 3 – orange
  "#FFC000", // class 4 – amber / golden
  "#FFFF00", // class 5 – yellow
  "#92D050", // class 6 – lime green
  "#00B050", // class 7 – medium green
  "#375623", // class 8 – dark forest green
];

export const EA_PALETTE = {
  erosion:   { color: "#800000", label: "Erosion (< -10 m)" },
  stable:    { color: "#999999", label: "Stable (-10 to 10 m)" },
  accretion: { color: "#375623", label: "Accretion (> 10 m)" },
};

/**
 * Calculates distance in meters between two lat/lon pairs using the Haversine formula.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Formats latitude cleanly with no unnecessary trailing zeroes (e.g. 26.2°N instead of 26.200°N).
 */
export function formatLat(val, format = "hemisphere") {
  const hemi = val >= 0 ? "N" : "S";
  const numStr = Number(Math.abs(val).toFixed(4)).toString();
  if (format === "plain") return numStr;
  if (format === "degree") return `${numStr}°`;
  return `${numStr}°${hemi}`;
}

/**
 * Formats longitude cleanly with no unnecessary trailing zeroes (e.g. 81.5°E instead of 81.500°E).
 */
export function formatLon(val, format = "hemisphere") {
  const hemi = val >= 0 ? "E" : "W";
  const numStr = Number(Math.abs(val).toFixed(4)).toString();
  if (format === "plain") return numStr;
  if (format === "degree") return `${numStr}°`;
  return `${numStr}°${hemi}`;
}

/**
 * Generates clean, evenly spaced coordinate ticks for a range.
 */
export function generateTicks(min, max, count = 5) {
  const span = max - min;
  if (span <= 0) return [min];
  
  const rawStep = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step;
  if (normalized < 1.5) step = 1 * magnitude;
  else if (normalized < 3.5) step = 2 * magnitude;
  else if (normalized < 7.5) step = 5 * magnitude;
  else step = 10 * magnitude;

  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = first; v <= max; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/**
 * Builds separate legend item sets for regular vector layers and statistical parameters.
 */
export function buildInitialLegendSets(layers = [], activeParamDef = null, paramBreaks = null, paramBankFilter = "Both") {
  const layerItems = [];
  const statItems = [];
  let statTitle = "";

  // 1. Regular vector layers (Banklines, Transects, Custom Layers)
  layers.forEach((layer, idx) => {
    if (layer.visible) {
      layerItems.push({
        id: `layer-${layer.name}-${idx}`,
        type: "layer",
        name: layer.name,
        label: layer.name,
        color: layer.color || "#3b82f6",
        visible: true,
      });
    }
  });

  // 2. Statistical parameter items (if parameter analysis is active)
  if (activeParamDef) {
    if (activeParamDef.special === "ea") {
      statTitle = `Erosion / Accretion (${activeParamDef.label})`;
      Object.entries(EA_PALETTE).forEach(([key, val]) => {
        statItems.push({
          id: `stat-ea-${key}`,
          type: "stat",
          name: val.label,
          label: val.label,
          color: val.color,
          visible: true,
        });
      });
    } else {
      const bankLabel = paramBankFilter === "Both" ? "Both Banks" : paramBankFilter === "L" ? "Left Bank" : "Right Bank";
      statTitle = `${activeParamDef.label} (${bankLabel})`;
      let breaks = null;
      if (paramBreaks) {
        if (paramBankFilter === "L" && paramBreaks.L) breaks = paramBreaks.L;
        else if (paramBankFilter === "R" && paramBreaks.R) breaks = paramBreaks.R;
        else breaks = paramBreaks.Both || paramBreaks.L || paramBreaks.R || (Array.isArray(paramBreaks) ? paramBreaks : null);
      }

      if (breaks && Array.isArray(breaks) && breaks.length >= 9) {
        for (let i = 0; i < 8; i++) {
          const lo = breaks[i] != null ? Number(breaks[i]).toFixed(2) : "?";
          const hi = breaks[i + 1] != null ? Number(breaks[i + 1]).toFixed(2) : "?";
          statItems.push({
            id: `stat-class-${i}`,
            type: "stat",
            name: `${lo} to ${hi}`,
            label: `${lo} to ${hi}`,
            color: EIGHT_CLASS_PALETTE[i],
            visible: true,
          });
        }
      }
    }
  }

  return { layerItems, statItems, statTitle };
}

/**
 * Backwards-compatible initial legend items builder.
 */
export function buildInitialLegendItems(layers, activeParamDef, paramBreaks, paramBankFilter) {
  const sets = buildInitialLegendSets(layers, activeParamDef, paramBreaks, paramBankFilter);
  const combined = [...sets.layerItems, ...sets.statItems];
  combined.layerItems = sets.layerItems;
  combined.statItems = sets.statItems;
  combined.statTitle = sets.statTitle;
  return combined;
}

/**
 * Captures the specified rectangular bounds of the Leaflet map container to a cropped HTML canvas.
 */
export async function captureMapBounds(map, bounds) {
  if (!map) throw new Error("Leaflet map instance is missing.");
  
  const mapContainer = map.getContainer();
  if (!mapContainer) throw new Error("Map container DOM element not found.");

  // Convert geographic bounds to pixel offsets on current map view
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();
  const ptNW = map.latLngToContainerPoint(nw);
  const ptSE = map.latLngToContainerPoint(se);

  const cropX = Math.max(0, Math.min(ptNW.x, ptSE.x));
  const cropY = Math.max(0, Math.min(ptNW.y, ptSE.y));
  const cropW = Math.abs(ptSE.x - ptNW.x);
  const cropH = Math.abs(ptSE.y - ptNW.y);

  if (cropW < 10 || cropH < 10) {
    throw new Error("Selected area is too small. Please select a larger rectangle.");
  }

  // Use html2canvas to capture map container with full CORS support
  const fullCanvas = await html2canvas(mapContainer, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: null,
    logging: false,
    scale: 2, // 2x scale for crisp, high-resolution rendering
    scrollX: 0,
    scrollY: 0,
    ignoreElements: (el) => {
      // Ignore UI overlays like controls, dialogs, modals, toasts, selection banners during capture
      if (el.classList.contains("spatial-modal-backdrop")) return true;
      if (el.classList.contains("map-toast")) return true;
      if (el.classList.contains("drag-drop-overlay")) return true;
      if (el.classList.contains("selection-guide-banner")) return true;
      if (el.classList.contains("layer-controls")) return true;
      if (el.classList.contains("map-legend")) return true;
      if (el.classList.contains("param-panel")) return true;
      if (el.classList.contains("param-legend")) return true;
      if (el.classList.contains("leaflet-control-container")) return true;
      return false;
    },
    onclone: (clonedDoc) => {
      // Normalize Leaflet CSS transforms to prevent any dislocation between tiles and vector layers
      const mapPane = clonedDoc.querySelector('.leaflet-map-pane');
      if (mapPane) {
        const transform = window.getComputedStyle(mapPane).transform;
        if (transform && transform !== 'none') {
          const match = transform.match(/^matrix(?:3d)?\((.+)\)$/);
          if (match) {
            const values = match[1].split(',').map((v) => parseFloat(v.trim()));
            const is3D = transform.startsWith('matrix3d');
            const x = is3D ? values[12] : values[4];
            const y = is3D ? values[13] : values[5];
            mapPane.style.transform = 'none';
            mapPane.style.left = `${x}px`;
            mapPane.style.top = `${y}px`;
          }
        }
      }
    },
  });

  // Extract the exact cropped rectangle area
  const croppedCanvas = document.createElement("canvas");
  const scaleX = fullCanvas.width / (mapContainer.offsetWidth || mapContainer.clientWidth);
  const scaleY = fullCanvas.height / (mapContainer.offsetHeight || mapContainer.clientHeight);
  croppedCanvas.width = Math.round(cropW * scaleX);
  croppedCanvas.height = Math.round(cropH * scaleY);
  const ctx = croppedCanvas.getContext("2d");

  ctx.drawImage(
    fullCanvas,
    Math.round(cropX * scaleX),
    Math.round(cropY * scaleY),
    Math.round(cropW * scaleX),
    Math.round(cropH * scaleY),
    0,
    0,
    croppedCanvas.width,
    croppedCanvas.height
  );

  return {
    canvas: croppedCanvas,
    bounds,
    pixelWidth: croppedCanvas.width,
    pixelHeight: croppedCanvas.height,
  };
}

/**
 * Composes the final spatial map image onto a master canvas with cartographic frame,
 * ticks, degree labels, north arrow, scale bar, title, and draggable legend box.
 */
export function renderComposedSpatialMap({
  mapCanvas,
  bounds,
  title = "Spatial Map",
  legendItems = [],
  legendPos = { x: 4, y: 70 },
  legendTitle = "Map Layers",
  legendSize = { width: 240, rowHeight: 22, fontSize: 12, scale: 1.0, isMinimized: false },
  statLegendItems = [],
  statLegendPos = { x: 96, y: 70 },
  statLegendTitle = "Statistical Analysis",
  statLegendSize = null,
  options = {
    showTitle: true,
    showCoordinates: true,
    showScale: true,
    showNorthArrow: true,
    showLegend: true,
    showGrid: false,
    theme: "light",
  },
}) {
  const masterCanvas = document.createElement("canvas");
  const ctx = masterCanvas.getContext("2d");

  const mapW = mapCanvas.width;
  const mapH = mapCanvas.height;

  // Frame coordinates font size (increased to 22px by default)
  const coordFontSize = Number(options.coordFontSize) || 22;

  // Frame margins dynamically adapt to coord font size so text never touches or clips
  const marginT = options.showTitle && title ? Math.max(105, 75 + coordFontSize) : Math.max(68, 38 + coordFontSize);
  const marginB = options.showCoordinates ? Math.max(76, 46 + coordFontSize) : 30;
  const marginL = options.showCoordinates ? Math.max(88, 40 + Math.round(coordFontSize * 2.2)) : 30;
  const marginR = options.showCoordinates ? Math.max(88, 40 + Math.round(coordFontSize * 2.2)) : 30;

  masterCanvas.width = mapW + marginL + marginR;
  masterCanvas.height = mapH + marginT + marginB;

  const isDark = options.theme === "dark";
  const bgCol = isDark ? "#12141a" : "#ffffff";
  const textCol = isDark ? "#f3f4f6" : "#111827";
  const borderCol = isDark ? "#4b5563" : "#1f2937";
  const subTextCol = isDark ? "#9ca3af" : "#4b5563";

  // Fill master background
  ctx.fillStyle = bgCol;
  ctx.fillRect(0, 0, masterCanvas.width, masterCanvas.height);

  // Map position
  const mapX = marginL;
  const mapY = marginT;

  // Draw the map canvas directly hugging the frame
  ctx.drawImage(mapCanvas, mapX, mapY, mapW, mapH);

  // -------------------------------------------------------------
  // Title Banner (Positioned near top with generous space to coordinate ticks)
  // -------------------------------------------------------------
  if (options.showTitle && title) {
    ctx.fillStyle = textCol;
    ctx.font = `bold 26px "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const titleY = 28; // Elevated slightly towards the top
    ctx.fillText(title, masterCanvas.width / 2, titleY);
  }

  // -------------------------------------------------------------
  // Outer Cartographic Frame & Neatline (hugging the map edge)
  // -------------------------------------------------------------
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // Secondary crisp outer neatline (3px outside inner neatline)
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX - 3, mapY - 3, mapW + 6, mapH + 6);

  // -------------------------------------------------------------
  // Latitude & Longitude Coordinate Ticks on Frame
  // -------------------------------------------------------------
  if (options.showCoordinates && bounds) {
    const minLat = bounds.getSouth();
    const maxLat = bounds.getNorth();
    const minLon = bounds.getWest();
    const maxLon = bounds.getEast();

    const latTicks = generateTicks(minLat, maxLat, 5);
    const lonTicks = generateTicks(minLon, maxLon, 6);

    ctx.font = `bold ${coordFontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = textCol;

    // Draw Longitude ticks (Top & Bottom)
    lonTicks.forEach((lon) => {
      const xRatio = (lon - minLon) / (maxLon - minLon);
      if (xRatio >= 0 && xRatio <= 1) {
        const xPos = mapX + xRatio * mapW;
        const text = formatLon(lon, options.coordFormat || "hemisphere");

        // Tick marks
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 2.0;
        // Top tick
        ctx.beginPath();
        ctx.moveTo(xPos, mapY - 3);
        ctx.lineTo(xPos, mapY - 12);
        ctx.stroke();
        // Bottom tick
        ctx.beginPath();
        ctx.moveTo(xPos, mapY + mapH + 3);
        ctx.lineTo(xPos, mapY + mapH + 12);
        ctx.stroke();

        // Labels
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(text, xPos, mapY - 16);

        ctx.textBaseline = "top";
        ctx.fillText(text, xPos, mapY + mapH + 16);

        // Optional subtle grid lines
        if (options.showGrid) {
          ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
          ctx.lineWidth = 0.8;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(xPos, mapY);
          ctx.lineTo(xPos, mapY + mapH);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });

    // Draw Latitude ticks (Left & Right - WRITTEN VERTICALLY)
    latTicks.forEach((lat) => {
      const yRatio = (maxLat - lat) / (maxLat - minLat);
      if (yRatio >= 0 && yRatio <= 1) {
        const yPos = mapY + yRatio * mapH;
        const text = formatLat(lat, options.coordFormat || "hemisphere");

        // Tick marks
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 2.0;
        // Left tick
        ctx.beginPath();
        ctx.moveTo(mapX - 3, yPos);
        ctx.lineTo(mapX - 12, yPos);
        ctx.stroke();
        // Right tick
        ctx.beginPath();
        ctx.moveTo(mapX + mapW + 3, yPos);
        ctx.lineTo(mapX + mapW + 12, yPos);
        ctx.stroke();

        // Left Label - VERTICAL (bottom-to-top along neatline)
        ctx.save();
        ctx.translate(mapX - 18, yPos);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(text, 0, 0);
        ctx.restore();

        // Right Label - VERTICAL (top-to-bottom along neatline)
        ctx.save();
        ctx.translate(mapX + mapW + 18, yPos);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(text, 0, 0);
        ctx.restore();

        // Optional subtle grid lines
        if (options.showGrid) {
          ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
          ctx.lineWidth = 0.8;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(mapX, yPos);
          ctx.lineTo(mapX + mapW);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });
  }

  // -------------------------------------------------------------
  // North Arrow (Black & White only, Equal spacing from top & right neatline, Placed downward)
  // -------------------------------------------------------------
  if (options.showNorthArrow) {
    const arrowLen = 72; // Needle height
    const arrowHalfW = 14; // Needle half-width
    const spacing = 40; // EQUAL 40px spacing from top and right neatlines

    // naX: right edge of needle (naX + arrowHalfW) is exactly 'spacing' px from right frame
    const naX = mapX + mapW - spacing - arrowHalfW;
    // naY: top edge of 'N' text (naY - 64) is exactly 'spacing' px from top frame (placed downward)
    const naY = mapY + spacing + 64;

    ctx.save();
    // Drop shadow for crisp contrast over both satellite and map features
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;

    // Left half of needle: Solid BLACK
    ctx.fillStyle = "#000000";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(naX, naY - arrowLen / 2);
    ctx.lineTo(naX - arrowHalfW, naY + arrowLen / 2 - 14);
    ctx.lineTo(naX, naY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Right half of needle: Pure WHITE
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(naX, naY - arrowLen / 2);
    ctx.lineTo(naX + arrowHalfW, naY + arrowLen / 2 - 14);
    ctx.lineTo(naX, naY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bottom counter-needle tail (South in Black & White)
    // South left: White
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(naX, naY + 8);
    ctx.lineTo(naX - arrowHalfW, naY + arrowLen / 2 - 14);
    ctx.lineTo(naX, naY + arrowLen / 2 - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // South right: Black
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(naX, naY + 8);
    ctx.lineTo(naX + arrowHalfW, naY + arrowLen / 2 - 14);
    ctx.lineTo(naX, naY + arrowLen / 2 - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // North 'N' header in Black & White
    ctx.shadowBlur = 4;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.font = `900 22px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.strokeText("N", naX, naY - arrowLen / 2 - 6);
    ctx.fillStyle = "#000000";
    ctx.fillText("N", naX, naY - arrowLen / 2 - 6);

    ctx.restore();
  }

  // -------------------------------------------------------------
  // Metric Scale Bar (Only in Black color)
  // -------------------------------------------------------------
  if (options.showScale && bounds) {
    const midLat = (bounds.getSouth() + bounds.getNorth()) / 2;
    const distMeters = haversineDistance(midLat, bounds.getWest(), midLat, bounds.getEast());
    const metersPerPixel = distMeters / mapW;

    // Target scale width ~ 180 - 280 pixels
    const targetDist = metersPerPixel * 220;
    let roundDist = 100;
    if (targetDist >= 100000) roundDist = Math.round(targetDist / 50000) * 50000;
    else if (targetDist >= 10000) roundDist = Math.round(targetDist / 10000) * 10000;
    else if (targetDist >= 5000) roundDist = 5000;
    else if (targetDist >= 2000) roundDist = 2000;
    else if (targetDist >= 1000) roundDist = 1000;
    else if (targetDist >= 500) roundDist = 500;
    else if (targetDist >= 200) roundDist = 200;
    else if (targetDist >= 100) roundDist = 100;
    else if (targetDist >= 50) roundDist = 50;

    const scaleBarPx = roundDist / metersPerPixel;
    const sbX = mapX + 35;
    const sbY = mapY + mapH - 30;

    ctx.save();
    
    // Halo glow so black scale remains legible against dark imagery
    ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
    ctx.shadowBlur = 4;

    // Solid Black Bar
    const barH = 5;
    ctx.fillStyle = "#000000";
    ctx.fillRect(sbX, sbY, scaleBarPx, barH);

    // Solid Black Ticks (Start, Mid, End)
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    // Start tick
    ctx.moveTo(sbX, sbY - 5);
    ctx.lineTo(sbX, sbY + barH + 5);
    // Mid tick
    ctx.moveTo(sbX + scaleBarPx / 2, sbY - 4);
    ctx.lineTo(sbX + scaleBarPx / 2, sbY + barH + 4);
    // End tick
    ctx.moveTo(sbX + scaleBarPx, sbY - 5);
    ctx.lineTo(sbX + scaleBarPx, sbY + barH + 5);
    ctx.stroke();

    // Scale text labels strictly in Black color with subtle white halo behind
    ctx.font = `bold 14px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const drawBlackText = (txt, x, y) => {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = "#000000";
      ctx.fillText(txt, x, y);
    };

    drawBlackText("0", sbX, sbY - 6);

    const midLabel = roundDist >= 1000 ? `${(roundDist / 2000).toFixed(1)} km` : `${Math.round(roundDist / 2)} m`;
    drawBlackText(midLabel, sbX + scaleBarPx / 2, sbY - 6);

    const endLabel = roundDist >= 1000 ? `${(roundDist / 1000).toFixed(0)} km` : `${roundDist} m`;
    drawBlackText(endLabel, sbX + scaleBarPx, sbY - 6);

    ctx.restore();
  }

  // -------------------------------------------------------------
  // Helper to draw an individual cartographic legend card
  // -------------------------------------------------------------
  function drawLegendCard(cardItems, cardTitle, cardPos, cardSize) {
    if (!cardItems || cardItems.length === 0) return null;
    const activeItems = cardItems.filter((i) => i.visible !== false);
    if (activeItems.length === 0) return null;

    ctx.save();
    const size = cardSize || legendSize;
    const scale = size.scale || 1.0;
    const rawW = Number(size.width) || 240;
    const boxW = Math.max(30, Math.round(rawW * scale));

    const baseFontSize = Number(size.fontSize) || 12;
    const itemFontSize = Math.max(8, Math.round(baseFontSize * scale));
    const titleFontSize = Math.max(10, Math.round((baseFontSize + 2) * scale));
    const headerFontSize = Math.max(8, Math.round(baseFontSize * scale));

    const userRowH = Number(size.rowHeight) || 22;
    const effectiveRowH = Math.max(userRowH, itemFontSize + 8);
    const rowH = Math.max(12, Math.round(effectiveRowH * scale));

    const padX = Math.round(14 * scale);
    const padY = Math.round(12 * scale);
    const isMinimized = size.isMinimized === true;

    const titleHeight = Math.round((titleFontSize + 6) * scale);
    const boxH = isMinimized
      ? padY * 2 + titleHeight
      : padY * 2 + titleHeight + 6 + activeItems.length * rowH;

    const maxAvailX = Math.max(0, mapW - boxW);
    const maxAvailY = Math.max(0, mapH - boxH);
    const legX = mapX + (cardPos.x / 100) * maxAvailX;
    const legY = mapY + (cardPos.y / 100) * maxAvailY;

    // Background card
    ctx.fillStyle = isDark ? "rgba(22, 27, 34, 0.92)" : "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(legX, legY, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(legX, legY, boxW, boxH);
      ctx.strokeRect(legX, legY, boxW, boxH);
    }

    ctx.shadowColor = "transparent";

    // Card Header Title
    ctx.fillStyle = textCol;
    ctx.font = `bold ${titleFontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const titleDisplay = isMinimized ? `${cardTitle || "Legend"} (${activeItems.length})` : (cardTitle || "Legend");
    ctx.fillText(titleDisplay, legX + padX, legY + padY);

    if (!isMinimized) {
      // Divider line
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(legX + padX, legY + padY + titleHeight);
      ctx.lineTo(legX + boxW - padX, legY + padY + titleHeight);
      ctx.stroke();

      // Card Items
      let currY = legY + padY + titleHeight + 6;
      const swatchW = Math.round(Math.max(16, itemFontSize * 1.35));
      const swatchH = Math.round(Math.max(10, itemFontSize * 0.85));

      activeItems.forEach((item) => {
        if (item.type === "header") {
          ctx.fillStyle = subTextCol;
          ctx.font = `bold ${headerFontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.fillText(item.label || item.name, legX + padX, currY + 2, boxW - padX * 2);
        } else {
          ctx.fillStyle = item.color || "#888";
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect
            ? ctx.roundRect(legX + padX, currY + 2, swatchW, swatchH, 2)
            : ctx.rect(legX + padX, currY + 2, swatchW, swatchH);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = textCol;
          ctx.font = `500 ${itemFontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          const maxLabelWidth = Math.max(10, boxW - padX * 2 - swatchW - 8);
          ctx.fillText(item.label || item.name, legX + padX + swatchW + 8, currY + Math.round(swatchH / 2) + 2, maxLabelWidth);
        }
        currY += rowH;
      });
    }

    ctx.restore();

    return { x: legX, y: legY, width: boxW, height: boxH };
  }

  // 1. Draw Vector Layers Legend Box
  if (options.showLegend !== false && legendItems && legendItems.length > 0) {
    masterCanvas._layersLegendBox = drawLegendCard(
      legendItems,
      legendTitle || "Map Layers",
      legendPos || { x: 4, y: 70 },
      legendSize
    );
  }

  // 2. Draw Separate Statistics Parameters Legend Box (When statistics are active)
  if (options.showStatLegend !== false && statLegendItems && statLegendItems.length > 0) {
    masterCanvas._statLegendBox = drawLegendCard(
      statLegendItems,
      statLegendTitle || "Statistical Parameters",
      statLegendPos || { x: 96, y: 70 },
      statLegendSize || legendSize
    );
  }

  // Watermark credit
  ctx.fillStyle = subTextCol;
  ctx.font = `10px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("Generated by ESRD Lab, IIT Kanpur", masterCanvas.width - marginR, masterCanvas.height - 8);

  return masterCanvas;
}

/**
 * Downloads a canvas as a PNG or JPEG file.
 */
export function downloadCanvasImage(canvas, filename, format = "png") {
  const mimeType = format === "jpeg" || format === "jpg" ? "image/jpeg" : "image/png";
  const ext = format === "jpeg" || format === "jpg" ? "jpg" : "png";
  
  // Sanitize filename
  const cleanName = (filename || "Spatial_Map").replace(/[<>:"/\\|?*]+/g, "_").trim();
  const finalFilename = `${cleanName}.${ext}`;

  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    mimeType,
    0.95
  );
}
