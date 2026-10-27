import JSZip from "jszip";
import shp, { parseShp, combine } from "shpjs";

/**
 * Normalizes a base filename by stripping path prefixes and extensions.
 */
function getBaseName(fileName) {
  const clean = fileName.replace(/^.*[\\/]/, "");
  const lastDot = clean.lastIndexOf(".");
  return lastDot > 0 ? clean.substring(0, lastDot) : clean;
}

/**
 * Gets the file extension in lower-case without the leading dot.
 */
function getExtension(fileName) {
  const clean = fileName.replace(/^.*[\\/]/, "");
  const lastDot = clean.lastIndexOf(".");
  return lastDot >= 0 ? clean.substring(lastDot + 1).toLowerCase() : "";
}

/**
 * Parses dropped files into GeoJSON layers.
 * Supports:
 *  - Standalone unzipped .shp files (without zipping)
 *  - Multi-file drops of unzipped .shp + .dbf + .prj + .shx
 *  - .zip shapefile archives (single or multiple shapefiles inside)
 *  - .geojson / .json files
 *
 * @param {FileList|Array<File>} files - The dropped or selected files
 * @returns {Promise<Array<{ name: string, data: Object, isUserLayer: boolean }>>}
 */
export async function parseShapefileFiles(files) {
  const fileArray = Array.from(files);
  if (!fileArray || fileArray.length === 0) {
    throw new Error("No files were dropped or selected.");
  }

  const results = [];
  const errors = [];

  const zipFiles = [];
  const shpFiles = [];
  const companionFiles = {};
  const geojsonFiles = [];

  fileArray.forEach(file => {
    const ext = getExtension(file.name);
    const base = getBaseName(file.name).toLowerCase();

    if (ext === "zip") {
      zipFiles.push(file);
    } else if (ext === "shp") {
      shpFiles.push(file);
    } else if (["dbf", "shx", "prj", "cpg"].includes(ext)) {
      if (!companionFiles[base]) {
        companionFiles[base] = {};
      }
      companionFiles[base][ext] = file;
    } else if (ext === "geojson" || ext === "json") {
      geojsonFiles.push(file);
    }
  });

  // 1. Process unzipped .shp files (standalone or with companion files)
  for (const shpFile of shpFiles) {
    const rawBaseName = getBaseName(shpFile.name);
    const baseKey = rawBaseName.toLowerCase();
    const companions = companionFiles[baseKey] || {};

    try {
      const shpBuffer = await shpFile.arrayBuffer();
      const buffers = { shp: shpBuffer };

      if (companions.dbf) {
        buffers.dbf = await companions.dbf.arrayBuffer();
      }
      if (companions.prj) {
        buffers.prj = await companions.prj.text();
      }
      if (companions.cpg) {
        buffers.cpg = await companions.cpg.text();
      }
      if (companions.shx) {
        buffers.shx = await companions.shx.arrayBuffer();
      }

      let geojson;
      try {
        geojson = await shp(buffers);
      } catch (errFull) {
        console.warn(`Full parse failed for ${rawBaseName}, attempting geometry-only parse:`, errFull);
        let prj = buffers.prj || false;
        const geometries = parseShp(shpBuffer, prj);
        geojson = combine([geometries, []]);
      }

      if (geojson && (geojson.type === "FeatureCollection" || geojson.features || Array.isArray(geojson))) {
        if (Array.isArray(geojson)) {
          geojson.forEach((gc, idx) => {
            results.push({
              name: gc.fileName || `${rawBaseName}_${idx + 1}`,
              data: gc,
              isUserLayer: true
            });
          });
        } else {
          results.push({
            name: rawBaseName,
            data: geojson,
            isUserLayer: true
          });
        }
      } else {
        throw new Error("Parsed data did not contain valid geometries.");
      }
    } catch (err) {
      console.error(`Error parsing unzipped shapefile ${shpFile.name}:`, err);
      errors.push(`Failed to parse ${shpFile.name}: ${err.message || "Invalid format"}`);
    }
  }

  // 2. Process .zip shapefile archives
  for (const zipFile of zipFiles) {
    try {
      const zipBuffer = await zipFile.arrayBuffer();
      const zip = await JSZip.loadAsync(zipBuffer);
      const zipShpKeys = Object.keys(zip.files).filter(k => k.toLowerCase().endsWith(".shp"));

      if (zipShpKeys.length === 0) {
        const jsonKeys = Object.keys(zip.files).filter(k => k.toLowerCase().endsWith(".geojson") || k.toLowerCase().endsWith(".json"));
        for (const jKey of jsonKeys) {
          const text = await zip.files[jKey].async("string");
          const parsed = JSON.parse(text);
          results.push({
            name: getBaseName(jKey),
            data: parsed,
            isUserLayer: true
          });
        }
        if (jsonKeys.length === 0) {
          errors.push(`ZIP archive "${zipFile.name}" does not contain any .shp or .geojson files.`);
        }
        continue;
      }

      for (const shpKey of zipShpKeys) {
        const rawBase = getBaseName(shpKey);
        const baseWithoutExt = shpKey.slice(0, -4);

        const buffers = {};
        for (const ext of ["shp", "shx", "dbf", "prj", "cpg"]) {
          const targetName = `${baseWithoutExt}.${ext}`;
          const foundKey = Object.keys(zip.files).find(k => k.toLowerCase() === targetName.toLowerCase());
          if (foundKey) {
            if (ext === "prj" || ext === "cpg") {
              buffers[ext] = await zip.files[foundKey].async("string");
            } else {
              buffers[ext] = await zip.files[foundKey].async("arraybuffer");
            }
          }
        }

        let geojson;
        try {
          geojson = await shp(buffers);
        } catch (innerErr) {
          console.warn(`Detailed buffer parse failed for ${rawBase} in zip, falling back:`, innerErr);
          if (buffers.shp) {
            const geometries = parseShp(buffers.shp, buffers.prj || false);
            geojson = combine([geometries, []]);
          } else {
            throw innerErr;
          }
        }

        if (geojson) {
          if (Array.isArray(geojson)) {
            geojson.forEach((gc, idx) => {
              results.push({
                name: gc.fileName || `${rawBase}_${idx + 1}`,
                data: gc,
                isUserLayer: true
              });
            });
          } else {
            results.push({
              name: rawBase,
              data: geojson,
              isUserLayer: true
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error processing ZIP file ${zipFile.name}:`, err);
      errors.push(`Failed to read ZIP archive "${zipFile.name}": ${err.message || "Invalid archive"}`);
    }
  }

  // 3. Process standalone GeoJSON files
  for (const gjFile of geojsonFiles) {
    try {
      const text = await gjFile.text();
      const parsed = JSON.parse(text);
      if (parsed.type === "FeatureCollection" || parsed.features) {
        results.push({
          name: getBaseName(gjFile.name),
          data: parsed,
          isUserLayer: true
        });
      } else if (parsed.type === "Feature") {
        results.push({
          name: getBaseName(gjFile.name),
          data: { type: "FeatureCollection", features: [parsed] },
          isUserLayer: true
        });
      } else {
        errors.push(`${gjFile.name} is not a valid GeoJSON object.`);
      }
    } catch (err) {
      errors.push(`Failed to parse GeoJSON ${gjFile.name}: ${err.message}`);
    }
  }

  if (results.length === 0) {
    if (errors.length > 0) {
      throw new Error(errors.join(" | "));
    }
    throw new Error("No shapefile (.shp) or valid GIS layer was found in the dropped files. Please drop a .shp file (with optional .dbf/.prj) or a .zip archive.");
  }

  return results;
}
