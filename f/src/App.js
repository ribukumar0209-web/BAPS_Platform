import React, { useState, useEffect, useRef } from 'react';
import './index.css'; 
import MapShapefileMode from './components/LeafletMaps.js';
import ModelRunner, { InfoTooltip } from './components/ModelRunner.js';
import lightLogo from './assets/white-background.png'; 
import darkLogo from './assets/black-background.png'; 
import logo2 from './assets/logo2.jpeg';
import './themes/light-theme.css'; 
import './themes/dark-theme.css'; 

function App() {
  const [zipFile, setZipFile] = useState(null);
  const [additionalZip, setAdditionalZip] = useState(null); // For transects and generated results
  const [availableYears, setAvailableYears] = useState([]);
  const [missingYears, setMissingYears] = useState([]);
  const [theme, setTheme] = useState('light'); 
  const [analysisCompleted, setAnalysisCompleted] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const [drawnROI, setDrawnROI] = useState(null);
  const [analysisMode, setAnalysisMode] = useState("full");
  const [transectStatsGeoJson, setTransectStatsGeoJson] = useState(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      // Allow resizing between 300px and 900px
      const newWidth = Math.min(Math.max(e.clientX, 300), 900);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Clear backend cache on every fresh page load / refresh
  useEffect(() => {
    fetch('http://127.0.0.1:5000/api/clear', { method: 'POST' })
      .catch(() => {}); // silently ignore if backend isn't up yet
  }, []);


  const handleMouseDown = (e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const toggleTheme = () => {
    setTheme((prevTheme) => {
      const newTheme = prevTheme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      return newTheme;
    });
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      setTheme('dark'); // Let's default to dark for advanced GIS look
    }
  }, []); 

  useEffect(() => {
    document.body.className = `${theme}-theme`;
  }, [theme]); 

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.zip')) {
      // Wipe backend cache so the new dataset starts fresh
      fetch('http://127.0.0.1:5000/api/clear', { method: 'POST' }).catch(() => {});
      setZipFile(file);
      setAdditionalZip(null);
      setAnalysisCompleted(false);
      setTransectStatsGeoJson(null);
    } else {
      // Wipe backend cache on deselect too
      fetch('http://127.0.0.1:5000/api/clear', { method: 'POST' }).catch(() => {});
      setZipFile(null);
      setAdditionalZip(null);
      setTransectStatsGeoJson(null);
    }
  };


  // Called by ModelRunner when analysis succeeds, with the bank side used
  const handleAnalysisDone = async (side) => {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/transect_stats');
      if (res.ok) {
        const geojson = await res.json();
        setTransectStatsGeoJson(geojson);
      } else {
        console.warn('Could not fetch transect stats:', res.status);
      }
    } catch (err) {
      console.warn('Error fetching transect stats:', err);
    }
  };

  return (
    <div className="app-container" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      {/* Foreground UI Layer (Left Sidebar) */}
      <div className="ui-layer" style={{ width: sidebarWidth }}>
        <div className="left-panel">
          
          <div className="glass-panel header-card" style={{ zIndex: 100 }}>
            <div className="header-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div className="logo-wrapper-small" style={{ flexShrink: 0 }}>
                <img src={theme === 'light' ? lightLogo : darkLogo} alt="Logo" className="app-logo-small" />
              </div>
              <h1 className="app-title" style={{fontSize: '1.25em', textAlign: 'center', margin: '0 10px', flexGrow: 1}}>
                Bankline Analysis & Prediction System
              </h1>
              <img src={logo2} alt="Secondary Logo" style={{ height: '50px', objectFit: 'contain', borderRadius: '4px', flexShrink: 0 }} />
            </div>
            
            <p className="app-description">
              Analyse and forecast river bankline with automated spatial modeling.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: '200px', gap: '10px' }}>
                <div className="file-upload-modern" style={{ flex: 1, minWidth: 0, maxWidth: '320px' }}>
                  <label htmlFor="shapefile-upload" className="upload-btn-modern" style={{ minWidth: 0, overflow: 'hidden' }}>
                     <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
                       {zipFile ? '📁 ' + zipFile.name : '📁 Upload Historical Banklines'}
                     </span>
                  </label>
                  <input
                    id="shapefile-upload"
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                  />
                </div>
                <InfoTooltip>
                  <div style={{ color: 'var(--accent-color, #8b5cf6)', marginBottom: '10px', fontWeight: 'bold', borderBottom: '1px solid var(--border-color, #444)', paddingBottom: '8px', fontSize: '14px' }}>
                    Data Naming Conventions
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Right Banklines:</strong> Must end with <span style={{color: 'var(--button-bg-color, #3b82f6)', fontWeight: 'bold'}}>R</span><br/>
                    <span style={{color: 'var(--text-muted, #aaa)', fontSize: '12px'}}>Example: <code>2024R.shp</code>, <code>1990_R.shp</code></span>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Left Banklines:</strong> Must end with <span style={{color: 'var(--button-bg-color, #3b82f6)', fontWeight: 'bold'}}>L</span><br/>
                    <span style={{color: 'var(--text-muted, #aaa)', fontSize: '12px'}}>Example: <code>2024L.shp</code>, <code>1990_L.shp</code></span>
                  </div>
                  <div>
                    <strong>Transects:</strong> Must include the keyword "transect" and specify the side (<span style={{color: 'var(--button-bg-color, #3b82f6)', fontWeight: 'bold'}}>L</span> or <span style={{color: 'var(--button-bg-color, #3b82f6)', fontWeight: 'bold'}}>R</span>)<br/>
                    <span style={{color: 'var(--text-muted, #aaa)', fontSize: '12px'}}>Example: <code>transects_L.shp</code>, <code>transects_R.shp</code></span>
                  </div>
                </InfoTooltip>
              </div>

              {(availableYears.length > 0 || missingYears.length > 0) && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px', whiteSpace: 'nowrap' }}>
                  {availableYears.length > 0 && <div>✅ Loaded {availableYears.length} years</div>}
                  {missingYears.length > 0 && <div style={{color: 'var(--message-color-error)'}}>⚠️ Missing {missingYears.length} years</div>}
                </div>
              )}
            </div>
          </div>

          <div className="runner-scroll-area">
            <ModelRunner 
              zipFile={zipFile} 
              availableYears={availableYears}
              analysisCompleted={analysisCompleted}
              setAnalysisCompleted={setAnalysisCompleted}
              setAdditionalZip={setAdditionalZip}
              drawnROI={drawnROI}
              analysisMode={analysisMode}
              setAnalysisMode={setAnalysisMode}
              onAnalysisDone={handleAnalysisDone}
              onResetAnalysis={() => setTransectStatsGeoJson(null)}
            />
          </div>
        </div>
      </div>

      {/* The Resizer Handle */}
      <div 
        className="sidebar-resizer" 
        onMouseDown={handleMouseDown}
        title="Drag to resize"
      />

      {/* Background Map Layer (Right Content) */}
      <div className="map-background" style={{ position: 'relative' }}>
        <MapShapefileMode
          zipFile={zipFile}
          additionalZip={additionalZip}
          setAvailableYears={setAvailableYears}
          setMissingYears={setMissingYears}
          theme={theme}
          toggleTheme={toggleTheme}
          setDrawnROI={setDrawnROI}
          analysisMode={analysisMode}
          transectStatsGeoJson={transectStatsGeoJson}
        />
        
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          textAlign: 'center',
          padding: '4px 0',
          fontSize: '0.85em',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          color: '#ffffff',
          zIndex: 1000,
          pointerEvents: 'none',
          letterSpacing: '0.5px'
        }}>
          Developed by ESRD Lab, IIT Kanpur
        </div>
      </div>
    </div>
  );
}

export default App;