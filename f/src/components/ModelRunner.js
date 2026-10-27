import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import JSZip from "jszip";
import "./ModelRunner.css";

export const InfoTooltip = ({ text, children }) => {
    const [show, setShow] = useState(false);
    
    // Close tooltip if clicked anywhere else
    useEffect(() => {
        const handleClickOutside = () => setShow(false);
        if (show) document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [show]);

    return (
        <span style={{ position: 'relative', display: 'inline-block', marginLeft: '6px' }}>
            <span 
                style={{ 
                    cursor: 'pointer', 
                    color: 'var(--text-color, #fff)', 
                    backgroundColor: 'var(--secondary-background-color, #000)',
                    fontWeight: 'bold', 
                    border: '1px solid var(--border-color, #333)', 
                    borderRadius: '50%', 
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '18px',
                    height: '18px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    fontStyle: 'italic',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    setShow(!show);
                }}
                title="Click for info"
            >
                i
            </span>
            {show && (
                <div style={{
                    position: 'absolute', top: '130%', left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--secondary-background-color, #0f172a)', /* Solid background matching theme */
                    color: 'var(--text-color, #fff)', padding: '16px',
                    borderRadius: '12px', fontSize: '13px', width: children ? '380px' : '220px', zIndex: 99999,
                    boxShadow: 'var(--glass-shadow, 0 8px 32px 0 rgba(0, 0, 0, 0.8))', 
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                    marginTop: '5px', textAlign: 'left', fontWeight: 'normal', lineHeight: '1.6'
                }} onClick={e => e.stopPropagation()}>
                    {text || children}
                </div>
            )}
        </span>
    );
};

function ModelRunner({ zipFile, availableYears, analysisCompleted, setAnalysisCompleted, setAdditionalZip, drawnROI, analysisMode, setAnalysisMode, onAnalysisDone, onResetAnalysis }) {
    const [message, setMessage] = useState("");
    const [analysisImages, setAnalysisImages] = useState([]);
    const [modalImage, setModalImage] = useState(null);
    const [forecastImages, setForecastImages] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [serverLogs, setServerLogs] = useState([]);
    const [serverImages, setServerImages] = useState([]);
    const [roiZipFile, setRoiZipFile] = useState(null);

    const [currentLog, setCurrentLog] = useState(null);

    // Show the latest log message continuously while processing
    useEffect(() => {
        if (isProcessing && serverLogs.length > 0) {
            setCurrentLog(serverLogs[serverLogs.length - 1]);
        }
    }, [serverLogs, isProcessing]);

    const outputsLengthRef = useRef(0);

    useEffect(() => {
        let interval;
        if (isProcessing) {
            outputsLengthRef.current = 0; // reset on new process
            interval = setInterval(async () => {
                try {
                    const res = await axios.get("http://127.0.0.1:5000/api/status");
                    setServerLogs(res.data.logs || []);
                    if (res.data.images && res.data.images.length > 0) {
                        setServerImages(res.data.images.map(img => `http://127.0.0.1:5000${img}`));
                    }
                    const currentState = res.data.output_state || 0;
                    if (currentState !== outputsLengthRef.current && currentState > 0) {
                        outputsLengthRef.current = currentState;
                        axios.get("http://127.0.0.1:5000/api/current_zip", { responseType: "blob" })
                            .then(zipRes => {
                                setAdditionalZip(zipRes.data);
                            }).catch(e => console.error("Error fetching current zip:", e));
                    }
                } catch (e) {
                    console.error("Error fetching status:", e);
                }
            }, 2000);
        } else {
            // Once processing is done, we might want to stop, but the final images are parsed from the ZIP.
            // We can clear serverImages or leave them.
        }
        return () => clearInterval(interval);
    }, [isProcessing, setAdditionalZip]);

    const [modalZoom, setModalZoom] = useState(1);
    const [modalPan, setModalPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    const openModal = (img) => {
        setModalImage(img);
        setModalZoom(1);
        setModalPan({ x: 0, y: 0 });
    };

    const closeModal = () => {
        setModalImage(null);
    };

    useEffect(() => {
        if (modalImage) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => { document.body.style.overflow = 'auto'; };
    }, [modalImage]);

    const handleWheel = (e) => {
        const scaleAmount = 0.1;
        const delta = e.deltaY < 0 ? scaleAmount : -scaleAmount;
        
        setModalZoom(prev => {
            let newScale = prev + delta;
            
            // Stop at original shape
            if (newScale <= 1) {
                setModalPan({ x: 0, y: 0 }); // Reset position
                return 1;
            }
            
            // Max zoom level
            return Math.min(newScale, 5);
        });
    };

    const handleMouseDown = (e) => {
        if (modalZoom <= 1) return; // Only allow panning when zoomed in
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX - modalPan.x, y: e.clientY - modalPan.y });
    };

    const handleMouseMove = (e) => {
        if (!isDragging || modalZoom <= 1) return;
        setModalPan({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const [spacing, setSpacing] = useState(100);
    const [transect_length, setTransectLength] = useState(10000);
    const [referenceYear, setReferenceYear] = useState("");
    const [side, setSide] = useState("R");

    const [hasTransectsInZip, setHasTransectsInZip] = useState(false);
    const [missingSides, setMissingSides] = useState([]);
    const [availableSides, setAvailableSides] = useState([]);
    const [unknownTransects, setUnknownTransects] = useState([]);
    const [showMissingTransectsModal, setShowMissingTransectsModal] = useState(false);
    const [transectsZipFile, setTransectsZipFile] = useState(null);
    const [showTransectUpload, setShowTransectUpload] = useState(false);
    const [transectStrategy, setTransectStrategy] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        const checkZipForTransects = async () => {
            setShowTransectUpload(false);
            setTransectStrategy(''); // Reset strategy for new bankline ZIP
            if (!zipFile) {
                setHasTransectsInZip(false);
                return;
            }
            try {
                const zip = await JSZip.loadAsync(zipFile);
                let foundTransect = false;
                let hasLBank = false;
                let hasRBank = false;
                let hasLTransect = false;
                let hasRTransect = false;
                let unknownTransectNames = [];

                for (const filename in zip.files) {
                    if (zip.files[filename].dir) continue;
                    
                    const lower = filename.toLowerCase();
                    if (!lower.endsWith(".shp")) continue;

                    const isTransect = lower.includes("transect");
                    const isLeft = lower.match(/(^|[_ 0-9-])(l|left)([_ -]|\.shp$)/) !== null;
                    const isRight = lower.match(/(^|[_ 0-9-])(r|right)([_ -]|\.shp$)/) !== null;

                    if (isTransect) {
                        foundTransect = true;
                        if (isLeft) hasLTransect = true;
                        if (isRight) hasRTransect = true;
                        if (!isLeft && !isRight) {
                            // Extract just the filename from potentially nested path
                            const nameOnly = filename.split('/').pop().split('\\').pop();
                            unknownTransectNames.push(nameOnly);
                        }
                    } else {
                        if (isLeft) hasLBank = true;
                        if (isRight) hasRBank = true;
                    }
                }
                setHasTransectsInZip(foundTransect);

                const missing = [];
                const available = [];
                if (hasLTransect) available.push("Left");
                if (hasRTransect) available.push("Right");
                if (hasLBank && !hasLTransect) missing.push("Left");
                if (hasRBank && !hasRTransect) missing.push("Right");

                if (available.length > 0 || missing.length > 0 || unknownTransectNames.length > 0) {
                    setAvailableSides(available);
                    setMissingSides(missing);
                    setUnknownTransects(unknownTransectNames);
                    setShowMissingTransectsModal(true);
                }

            } catch (error) {
                console.error("Error parsing zip file:", error);
                setHasTransectsInZip(false);
            }
        };
        checkZipForTransects();
    }, [zipFile]);

    const [forecastSteps, setForecastSteps] = useState(1);

    const [startYear, setStartYear] = useState("");
    const [endYear, setEndYear] = useState("");

    useEffect(() => {
        if (availableYears && availableYears.length > 0) {
            setReferenceYear(availableYears[0]);
        }
    }, [availableYears]);

    const extractImagesFromZip = async (blobData, filterFn = null) => {
        const zip = await JSZip.loadAsync(blobData);
        const images = [];
        for (const filename in zip.files) {
            if (filename.match(/\.(png|jpg|jpeg)$/i)) {
                if (filterFn && !filterFn(filename)) continue;
                const fileBlob = await zip.files[filename].async("blob");
                images.push(URL.createObjectURL(fileBlob));
            }
        }
        return images;
    };

    // ✅ Safe download function
    const safeDownload = (blob, filename) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.style.display = "none";       // keep hidden
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);   // cleanup
    };

    const handleResetAnalysis = async () => {
        try {
            await axios.post("http://localhost:5000/api/clear");
        } catch (error) {
            console.error("Error clearing backend cache:", error);
        }
        setAnalysisCompleted(false);
        setAdditionalZip(null);
        setAnalysisImages([]);
        setForecastImages([]);
        setServerImages([]);
        setServerLogs([]);
        if (onResetAnalysis) onResetAnalysis();
        setMessage("Analysis cleared. Ready for a new run.");
    };

    const handleGenerateTransects = async () => {
        if (!zipFile) {
            setMessage("Please upload a bankline ZIP file first.");
            return;
        }
        setIsGenerating(true);
        setMessage("Generating transects...");
        
        try {
            const formData = new FormData();
            formData.append("zipfile", zipFile);
            formData.append("spacing", spacing);
            formData.append("transect_length", transect_length);
            formData.append("side", side);
            
            const response = await axios.post("http://localhost:5000/api/process/generate_transects", formData, {
                responseType: "blob",
            });
            
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `transects_${side}.zip`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            
            const file = new File([response.data], `transects_${side}.zip`, { type: "application/zip" });
            setTransectsZipFile(file);
            if (typeof setAdditionalZip === 'function') {
                setAdditionalZip(file);
            }
            
            setMessage(`Transects generated successfully for side ${side}! The ZIP file has been downloaded and automatically attached for analysis.`);
            
            const generatedSide = side === 'L' ? 'Left' : 'Right';
            
            setAvailableSides(prev => {
                if (!prev.includes(generatedSide)) return [...prev, generatedSide];
                return prev;
            });
            
            setMissingSides(prev => {
                const updated = prev.filter(s => s !== generatedSide);
                if (updated.length === 0) {
                    setTransectStrategy("");
                    setShowMissingTransectsModal(false);
                } else {
                    setTransectStrategy("generate");
                    setSide(updated[0] === 'Left' ? 'L' : 'R');
                }
                return updated;
            });
        } catch (error) {
            console.error(error);
            if (error.response && error.response.data) {
                try {
                    const errorText = await error.response.data.text();
                    const errorObj = JSON.parse(errorText);
                    setMessage(`Transect Generation failed: ${errorObj.error}`);
                } catch (e) {
                    setMessage("Transect Generation failed. Please check backend logs.");
                }
            } else {
                setMessage("Transect Generation failed. Please check backend logs.");
            }
        }
        setIsGenerating(false);
    };

    async function handleAnalysisSubmit() {
        if (isProcessing) return;  // prevent duplicate calls
        if (!zipFile) {
            setMessage("Please upload a shapefile ZIP.");
            return;
        }

        setIsProcessing(true);
        setMessage("Running analysis...");
        setAnalysisImages([]);
        setForecastImages([]);
        setServerLogs([]);

        // Commented out so old images/outputs don't bleed if we explicitly want to clear,
        // but kept to allow running L and then R and accumulating results.
        // try { await axios.post("http://localhost:5000/api/clear-outputs"); } catch (_) {}
        const formData = new FormData();
        formData.append("zipfile", zipFile);
        formData.append("spacing", spacing);
        formData.append("transect_length", transect_length);
        formData.append("reference_year", parseInt(referenceYear));
        formData.append("side", side);
        if (startYear) formData.append("startYear", startYear);
        if (endYear) formData.append("endYear", endYear);

        formData.append("analysis_mode", analysisMode);
        if (analysisMode === "upload") {
            if (!roiZipFile) {
                setMessage("Please upload an ROI shapefile ZIP.");
                setIsProcessing(false);
                return;
            }
            formData.append("roi_zipfile", roiZipFile);
        } else if (analysisMode === "draw") {
            if (!drawnROI) {
                setMessage("Please draw an ROI polygon on the map.");
                setIsProcessing(false);
                return;
            }
            formData.append("roi_geojson", drawnROI);
        }

        if (transectsZipFile) {
            formData.append("transects_zipfile", transectsZipFile);
        }

        try {
            const response = await axios.post(
                "http://localhost:5000/api/process/analysis",
                formData,
                { responseType: "blob", timeout: 0 } // 10 min timeout
            );

            const analysisFilename = startYear && endYear 
                ? `analysis_results_${startYear}_to_${endYear}_${side}.zip` 
                : `analysis_output_${Date.now()}.zip`;
            safeDownload(response.data, analysisFilename);

            try {
                const images = await extractImagesFromZip(response.data, name => !name.toLowerCase().includes("predict"));
                setAnalysisImages(images);
            } catch (imgErr) {
                console.warn("Image extraction failed:", imgErr);
            }

            setAnalysisCompleted(true);
            setAdditionalZip(response.data);
            setMessage("Analysis completed successfully.");
            // Notify App to fetch transect stats for spatial visualization
            if (onAnalysisDone) onAnalysisDone(side);
        } catch (error) {
            console.error(error);
            const fallbackMsg = error.message || "Check backend logs.";
            if (error.response && error.response.data instanceof Blob) {
                error.response.data.text().then(text => {
                    try {
                        const errObj = JSON.parse(text);
                        setMessage(`Process failed: ${errObj.error || errObj.message || fallbackMsg}`);
                    } catch {
                        setMessage(`Process failed: ${fallbackMsg}`);
                    }
                });
            } else if (error.response?.data?.error) {
                setMessage(`Process failed: ${error.response.data.error}`);
            } else {
                setMessage(`Process failed: ${fallbackMsg}`);
            }
        } finally {
            setIsProcessing(false);
            setCurrentLog("Process completed.");
            setTimeout(() => {
                setCurrentLog(null);
            }, 10000);
        }
    }

    async function handleForecastSubmit() {
        if (isProcessing) return;  // prevent duplicate calls
        if (!zipFile) {
            setMessage("Please upload a shapefile ZIP.");
            return;
        }

        setIsProcessing(true);
        setMessage("Running forecast...");
        setForecastImages([]);
        setServerLogs([]);

        const formData = new FormData();
        formData.append("zipfile", zipFile);
        formData.append("forecast_steps", parseInt(forecastSteps));
        formData.append("reference_year", parseInt(referenceYear));
        formData.append("side", side);
        formData.append("response_type", "zip");
        if (startYear) formData.append("startYear", startYear);
        if (endYear) formData.append("endYear", endYear);

        try {
            const response = await axios.post(
                "http://localhost:5000/api/process/forecast",
                formData,
                { responseType: "blob", timeout: 0 } 
            );

            const forecastFilename = endYear 
                ? `forecasting_results_${parseInt(endYear) + 1}_${side}.zip` 
                : `forecasting_results_${Date.now()}.zip`;
            safeDownload(response.data, forecastFilename);

            try {
                const images = await extractImagesFromZip(response.data, name => name.toLowerCase().includes("predict"));
                setForecastImages(images);
            } catch (imgErr) {
                console.warn("Image extraction failed:", imgErr);
            }

            setAdditionalZip(response.data);
            setAnalysisCompleted(true);
            setMessage("Forecast completed successfully.");
        } catch (error) {
            console.error(error);
            const fallbackMsg = error.message || "Check backend logs.";
            if (error.response && error.response.data instanceof Blob) {
                error.response.data.text().then(text => {
                    try {
                        const errObj = JSON.parse(text);
                        setMessage(`Process failed: ${errObj.error || errObj.message || fallbackMsg}`);
                    } catch {
                        setMessage(`Process failed: ${fallbackMsg}`);
                    }
                });
            } else if (error.response?.data?.error) {
                setMessage(`Process failed: ${error.response.data.error}`);
            } else {
                setMessage(`Process failed: ${fallbackMsg}`);
            }
        } finally {
            setIsProcessing(false);
            setCurrentLog("Process completed.");
            setTimeout(() => {
                setCurrentLog(null);
            }, 10000);
        }
    }

    return (
        <div className="model-runner-container">
            <h1>Bankline Analysis & Forecasting</h1>

            {!zipFile ? (
                <div className="settings-card empty-state" style={{ textAlign: 'center', padding: '50px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                    <div style={{ fontSize: '48px' }}>📂</div>
                    <h2>Welcome to the Analysis & Forecasting Tool</h2>
                </div>
            ) : (
                <>
                    {/* Inline Transects Alert */}
                    {showMissingTransectsModal && (
                        <div className="settings-card" style={{ 
                            border: missingSides.length > 0 ? '1px solid var(--message-color-error, #ff4d4d)' : (unknownTransects.length > 0 ? '1px solid orange' : '1px solid #28a745'), 
                            marginBottom: '20px', 
                            backgroundColor: 'var(--glass-bg-hover, rgba(255,255,255,0.05))' 
                        }}>
                            <h2 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', 
                                color: missingSides.length > 0 ? 'var(--message-color-error, #ff4d4d)' : (unknownTransects.length > 0 ? 'orange' : '#28a745')}}>
                                {missingSides.length > 0 ? '⚠️ Transects Action Required' : (unknownTransects.length > 0 ? '⚠️ Transects Warning' : '✅ Transects Status')}
                            </h2>
                            {availableSides.length > 0 && (
                                <p style={{marginBottom: '10px'}}>
                                    <strong style={{color: '#28a745'}}>&#10003;</strong> Transects are <strong>available</strong> for the <strong>{availableSides.join(" and ")}</strong> side(s).
                                </p>
                            )}
                            {unknownTransects.length > 0 && (
                                <p style={{marginBottom: '10px', color: 'orange'}}>
                                    <strong>&#9888;</strong> Transects are available as <strong>{unknownTransects.join(", ")}</strong>, but the name(s) do not indicate Left or Right side.
                                </p>
                            )}
                            {missingSides.length > 0 && (
                                <p style={{marginBottom: '15px'}}>
                                    <strong style={{color: 'var(--message-color-error, #ff4d4d)'}}>&#9888;</strong> Banklines are present, but transects are <strong>missing</strong> for the <strong>{missingSides.join(" and ")}</strong> side(s).
                                </p>
                            )}
                            
                            {missingSides.length > 0 ? (
                                <>
                                    <p style={{marginBottom: '15px', color: 'var(--text-color)'}}>Do you want to upload existing transects or generate them?</p>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={() => {
                                            setTransectStrategy('upload');
                                            setShowMissingTransectsModal(false);
                                        }}>Upload Transects</button>
                                        <button onClick={() => {
                                            setTransectStrategy('generate');
                                            setShowMissingTransectsModal(false);
                                        }} style={{ backgroundColor: '#28a745' }}>Generate Transects</button>
                                    </div>
                                </>
                            ) : (
                                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '15px' }}>
                                    <button onClick={() => setShowMissingTransectsModal(false)} style={{ backgroundColor: '#28a745', padding: '6px 20px' }}>OK</button>
                                </div>
                            )}
                        </div>
                    )}

                    {transectStrategy === 'generate' && (
                        <div className="settings-card">
                            <h2>Transect Generation</h2>
                            <div className="model-params">
                                <div className="param-group">
                                    <label>Spacing (m)</label>
                                    <input type="number" value={spacing} onChange={e => setSpacing(e.target.value)} disabled={isGenerating} />
                                </div>
                                <div className="param-group">
                                    <label>Transect Length (m)</label>
                                    <input type="number" value={transect_length} onChange={e => setTransectLength(e.target.value)} disabled={isGenerating} />
                                </div>
                                <div className="param-group">
                                    <label>Side (L/R)</label>
                                    <select value={side} onChange={e => setSide(e.target.value)} disabled={isGenerating}>
                                        <option value="L">Left</option>
                                        <option value="R">Right</option>
                                    </select>
                                </div>
                            </div>
                            <button onClick={handleGenerateTransects} className="run-btn" disabled={isGenerating}>
                                {isGenerating ? "Generating..." : "Generate Transects"}
                            </button>
                        </div>
                    )}

                    <div className="settings-card">
                        <h2>Bankline Analysis (Input parameter)</h2>
                        <div className="model-params">
                    <div className="param-group">
                        <label>
                            Analysis Mode
                            <InfoTooltip text="Choose whether to process the full length or clip to a specific Region of Interest (ROI)." />
                        </label>
                        <select value={analysisMode}
                            onChange={e => setAnalysisMode(e.target.value)}
                            disabled={isProcessing}>
                            <option value="full">Full Length</option>
                            <option value="upload">Clip to ROI (Upload Shapefile)</option>
                            <option value="draw">Clip to ROI (Draw on Map)</option>
                        </select>
                    </div>

                    {analysisMode === "upload" && (
                        <div className="param-group">
                            <label>
                                Upload ROI Shapefile (.zip)
                            </label>
                            <input type="file" accept=".zip"
                                onChange={e => setRoiZipFile(e.target.files[0])}
                                disabled={isProcessing} />
                        </div>
                    )}

                    {transectStrategy === 'upload' && (
                        <div className="param-group">
                            <label>
                                Upload Transects (.zip)
                                <InfoTooltip text="Upload a ZIP file containing existing transects shapefiles." />
                            </label>
                            <input type="file" accept=".zip"
                                onChange={e => {
                                    const file = e.target.files[0];
                                    setTransectsZipFile(file);
                                    if (file && setAdditionalZip) {
                                        setAdditionalZip(file);
                                    }
                                }}
                                disabled={isProcessing} />
                        </div>
                    )}
                    {analysisMode === "draw" && (
                        <div className="param-group">
                            <label>
                                Draw ROI
                            </label>
                            <span style={{ fontSize: '0.85em', color: drawnROI ? 'lightgreen' : 'orange' }}>
                                {drawnROI ? '✓ ROI drawn on map' : '⚠️ Please draw a polygon on the map'}
                            </span>
                        </div>
                    )}

                    {false && (
                        <>
                            <div className="param-group">
                                <label>
                                    Spacing (m)
                                    <InfoTooltip text="The distance along the river between two consecutive transects used for bankline analysis." />
                                </label>
                                <input type="number" value={spacing}
                                    onChange={e => setSpacing(e.target.value)}
                                    disabled={isProcessing} />
                            </div>

                            <div className="param-group">
                                <label>
                                    Transect Length (m)
                                    <InfoTooltip text="The total cross-river length of a transect used to measure bankline shifts." />
                                </label>
                                <input type="number" value={transect_length}
                                    onChange={e => setTransectLength(e.target.value)}
                                    disabled={isProcessing} />
                            </div>
                        </>
                    )}

                    <div className="param-group">
                        <label>
                            Reference Year
                            <InfoTooltip text="The baseline year used for measuring subsequent riverbank shifts." />
                        </label>
                        <select value={referenceYear}
                            onChange={e => setReferenceYear(e.target.value)}
                            disabled={isProcessing}>
                            {availableYears.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>

                    <div className="param-group">
                        <label>
                            Bank Side
                            <InfoTooltip text="The Riverbank (Left or Right) selected for analysis, determined by viewing the river in the downstream flow direction." />
                        </label>
                        <select value={side}
                            onChange={e => setSide(e.target.value)}
                            disabled={isProcessing}>
                            <option value="L">Left</option>
                            <option value="R">Right</option>
                        </select>
                    </div>

                    <div className="param-group">
                        <label>
                            Start Year
                            <InfoTooltip text="The initial year from which riverbank positions and subsequent bankline changes are included in the analysis." />
                        </label>
                        <input type="number" value={startYear}
                            onChange={e => setStartYear(e.target.value)}
                            disabled={isProcessing} />
                    </div>

                    <div className="param-group">
                        <label>
                            End Year
                            <InfoTooltip text="The Last year up to which riverbank positions and bankline changes are included in the analysis." />
                        </label>
                        <input type="number" value={endYear}
                            onChange={e => setEndYear(e.target.value)}
                            disabled={isProcessing} />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={handleAnalysisSubmit}
                        style={{ flex: 1 }}
                        disabled={!zipFile || isProcessing}>
                        {isProcessing ? <div className="btn-spinner"></div> : null}
                        {isProcessing ? 'Running Analysis...' : 'Run Analysis'}
                    </button>
                    
                    {analysisCompleted && (
                        <button 
                            onClick={handleResetAnalysis}
                            style={{ flex: 1, backgroundColor: '#f44336', color: 'white' }}
                            disabled={isProcessing}
                        >
                            Clear / Run Again
                        </button>
                    )}
                </div>
            </div>

            <div className={`settings-card ${!analysisCompleted ? 'disabled-section' : ''}`}>
                <h2>Bankline Forecasting (Input Parameter)</h2>
                {!analysisCompleted && (
                    <div className="disabled-overlay">
                        <p>Complete Analysis to unlock Forecasting</p>
                    </div>
                )}
                <div className="model-params">
                    <div className="param-group">
                        <label>
                            Forecast Steps
                            <InfoTooltip text="The number of future time steps to predict the bankline morphology." />
                        </label>
                        <select value={forecastSteps}
                            onChange={e => setForecastSteps(e.target.value)}
                            disabled={!analysisCompleted || isProcessing}>
                            {[1, 2, 3, 4, 5].map(v => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <button onClick={handleForecastSubmit} disabled={!analysisCompleted || isProcessing}>
                    {isProcessing ? <div className="btn-spinner"></div> : null}
                    {isProcessing ? 'Running Forecast...' : 'Run Forecast'}
                </button>
            </div>



            {message && (
                <div className={`message ${message.includes('failed') ? 'error-message' : ''}`}>
                    {message.includes('failed') ? '❌' : '✅'} {message}
                </div>
            )}

            {currentLog && (
                <div key={currentLog} className="terminal-logs">
                    <div className="terminal-log-line">{currentLog}</div>
                </div>
            )}

            {(isProcessing && serverImages.length > 0) && (
                <div className="settings-card" style={{ marginTop: '20px' }}>
                    <h3>Live Results (Processing...)</h3>
                    <div className="image-gallery">
                        {serverImages.map((img, i) => (
                            <div key={i} className="clickable-graph-wrapper" onClick={() => openModal(img)}>
                                <img src={img} alt={`Live result ${i + 1}`} loading="lazy" className="clickable-graph" />
                                <div className="enlarge-overlay">
                                    <span>🔍 Enlarge</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {analysisImages.length > 0 && (
                <div className="settings-card" style={{ marginTop: '20px' }}>
                    <h3>Analysis Results</h3>
                    <div className="image-gallery">
                        {analysisImages.map((img, i) => (
                            <div key={i} className="clickable-graph-wrapper" onClick={() => openModal(img)}>
                                <img src={img} alt={`Analysis result ${i + 1}`} loading="lazy" className="clickable-graph" />
                                <div className="enlarge-overlay">
                                    <span>🔍 Enlarge</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {forecastImages.length > 0 && (
                <div className="settings-card" style={{ marginTop: '20px' }}>
                    <h3>Forecast Results</h3>
                    <div className="image-gallery">
                        {forecastImages.map((img, i) => (
                            <div key={i} className="clickable-graph-wrapper" onClick={() => openModal(img)}>
                                <img src={img} alt={`Forecast result ${i + 1}`} loading="lazy" className="clickable-graph" />
                                <div className="enlarge-overlay">
                                    <span>🔍 Enlarge</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            </>
            )}


            {/* Fullscreen Image Modal */}
            {modalImage && (
                <div className="graph-modal-overlay" onClick={closeModal} 
                     onWheel={handleWheel}
                     onMouseMove={handleMouseMove}
                     onMouseUp={handleMouseUp}
                     onMouseLeave={handleMouseUp}>
                    <button className="graph-modal-close" onClick={closeModal}>×</button>
                    <div className="graph-modal-content" onClick={e => e.stopPropagation()}>
                        <img 
                            src={modalImage} 
                            alt="Enlarged Graph" 
                            style={{ 
                                transform: `translate(${modalPan.x}px, ${modalPan.y}px) scale(${modalZoom})`,
                                cursor: modalZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                                transition: isDragging ? 'none' : 'transform 0.1s ease',
                                transformOrigin: 'center center'
                            }}
                            onMouseDown={handleMouseDown}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default ModelRunner;
