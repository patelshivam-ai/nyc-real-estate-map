import React, { useState, useEffect, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

const INITIAL_VIEW = {
  longitude: -73.98,
  latitude: 40.7,
  zoom: 10,
  pitch: 45,
  bearing: 0,
  touchRotate: true,
};

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = vals[i]?.trim()));
    return obj;
  });
}

function lerpColor(c1, c2, t) {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  const brightness = r + g + b;
  if (brightness < 100) {
    const boost = (100 - brightness) / 3;
    return [
      Math.min(255, r + boost),
      Math.min(255, g + boost),
      Math.min(255, b + boost),
      180,
    ];
  }
  return [r, g, b, 180];
}

function getColorForValue(relative) {
  const t = 1 - Math.min(Math.max((relative + 100) / 200, 0), 1);
  let r, g, b;
  if (t < 0.5) {
    r = 255;
    g = Math.round(255 * (t / 0.5));
    b = 0;
  } else {
    r = Math.round(255 * (1 - (t - 0.5) / 0.5));
    g = 200;
    b = 0;
  }
  return [r, g, b];
}

export default function App() {
  const [geojson, setGeojson] = useState(null);
  const [priceData, setPriceData] = useState({});
  const [citywideData, setCitywideData] = useState({});
    const [centroids, setCentroids] = useState({}); // eslint-disable-line no-unused-vars
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [displayYear, setDisplayYear] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [speed, setSpeed] = useState(0.5);

  useEffect(() => {
    fetch("/nta.geojson")
      .then((r) => r.json())
      .then(setGeojson);

    fetch("/neighborhood_year_prices.csv")
      .then((r) => r.text())
      .then((text) => {
        const rows = parseCSV(text);
        const byNtaYear = {};
        const yearSet = new Set();
        const citywideByYear = {};
        const centroidMap = {};

        rows.forEach((row) => {
          const key = `${row.NTA2020}_${parseInt(row.Year)}`;
          byNtaYear[key] = {
            relative: parseFloat(row.relative_performance),
            median: parseFloat(row.median_price_per_sqft),
            count: parseInt(row.transaction_count),
            yoy: parseFloat(row.yoy_change),
            lng: parseFloat(row.centroid_lng),
            lat: parseFloat(row.centroid_lat),
          };
          yearSet.add(row.Year);
          const yr = parseInt(row.Year);
          if (!citywideByYear[yr]) {
            citywideByYear[yr] = parseFloat(row.citywide_median);
          }
          if (!centroidMap[row.NTA2020]) {
            centroidMap[row.NTA2020] = {
              lng: parseFloat(row.centroid_lng),
              lat: parseFloat(row.centroid_lat),
            };
          }
        });

        const sortedYears = [...yearSet].sort();
        setPriceData(byNtaYear);
        setCitywideData(citywideByYear);
        setCentroids(centroidMap);
        setYears(sortedYears);
        setSelectedYear(sortedYears[0]);
        setDisplayYear(parseFloat(sortedYears[0]));

        // compute average yoy for 2004 and assign to 2003
        const avg2004Yoy = Object.keys(byNtaYear)
          .filter(k => k.endsWith("_2004"))
          .map(k => byNtaYear[k].yoy)
          .filter(v => !isNaN(v));
        const mean2004 = avg2004Yoy.reduce((a, b) => a + b, 0) / avg2004Yoy.length;
        Object.keys(byNtaYear)
          .filter(k => k.endsWith("_2003"))
          .forEach(k => { byNtaYear[k].yoy = mean2004; });
      });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setDisplayYear((prev) => {
        const maxYear = parseFloat(years[years.length - 1]);
        if (prev >= maxYear) {
          setPlaying(false);
          return prev;
        }
        const next = prev + 0.02;
        setSelectedYear(String(Math.floor(next)));
        return next;
      });
    }, 50 / speed);
    return () => clearInterval(interval);
  }, [playing, years, speed]);

  const getColor = useCallback(
    (feature) => {
      const nta = feature.properties.NTA2020;
      const yearFloor = Math.floor(displayYear || parseFloat(selectedYear));
      const yearCeil = yearFloor + 1;
      const t = (displayYear || parseFloat(selectedYear)) - yearFloor;

      const d1 = priceData[`${nta}_${yearFloor}`];
      const d2 = priceData[`${nta}_${yearCeil}`];

      const d1valid = d1 && !isNaN(d1.relative);
      const d2valid = d2 && !isNaN(d2.relative);

      if (!d1valid && !d2valid) return [100, 100, 100, 180];
      if (!d1valid) return [100, 100, 100, 180];
      if (!d2valid) return [...getColorForValue(d1.relative), 180];

      const c1 = getColorForValue(d1.relative);
      const c2 = getColorForValue(d2.relative);
      return lerpColor(c1, c2, t);
    },
    [priceData, selectedYear, displayYear]
  );

  const currentYear = Math.floor(displayYear || parseFloat(selectedYear || years[0]));

  // normalize yoy for height — clamp between -30% and +30%
  const MAX_YOY = 30;

  const layers = geojson
    ? [
        // 1. extruded bars
        new GeoJsonLayer({
          id: "bars",
          data: geojson,
          extruded: true,
          filled: true,
          stroked: false,
          pickable: true,
          onHover: ({ object, x, y }) => {
            if (!object) return setTooltip(null);
            const nta = object.properties.NTA2020;
            const year = Math.floor(displayYear || parseFloat(selectedYear));
            const d = priceData[`${nta}_${year}`];
            setTooltip({ x, y, name: object.properties.NTAName, data: d });
          },
          getElevation: (feature) => {
            const nta = feature.properties.NTA2020;
            const yearFloor = Math.floor(displayYear || parseFloat(selectedYear));
            const yearCeil = yearFloor + 1;
            const t = (displayYear || parseFloat(selectedYear)) - yearFloor;

            const d1 = priceData[`${nta}_${yearFloor}`];
            const d2 = priceData[`${nta}_${yearCeil}`];

            const BASE = 5000;
            const yoy1 = d1 && !isNaN(d1.yoy) ? d1.yoy : 0;
            const yoy2 = d2 && !isNaN(d2.yoy) ? d2.yoy : 0;

            const n1 = Math.min(Math.max(yoy1 / MAX_YOY, -1), 1);
            const n2 = Math.min(Math.max(yoy2 / MAX_YOY, -1), 1);

            return BASE + (n1 + (n2 - n1) * t) * 3000;
          },
          getFillColor: (feature) => {
            const nta = feature.properties.NTA2020;
            const yearFloor = Math.floor(displayYear || parseFloat(selectedYear));
            const yearCeil = yearFloor + 1;
            const t = (displayYear || parseFloat(selectedYear)) - yearFloor;

            const d1 = priceData[`${nta}_${yearFloor}`];
            const d2 = priceData[`${nta}_${yearCeil}`];

            const d1valid = d1 && !isNaN(d1.relative);
            const d2valid = d2 && !isNaN(d2.relative);

            const dark = [100, 100, 100];

            const c1 = d1valid ? getColorForValue(d1.relative) : dark;
            const c2 = d2valid ? getColorForValue(d2.relative) : dark;

            const blended = lerpColor(c1, c2, t);
            return [...blended.slice(0, 3), 255];
          },
          updateTriggers: {
            getElevation: [displayYear],
            getFillColor: [displayYear],
          },
        }),

        // 2. flat map coloring
        new GeoJsonLayer({
          id: "nta",
          data: geojson,
          filled: true,
          stroked: true,
          extruded: false,
          getFillColor: getColor,
          getLineColor: [255, 255, 255, 100],
          getLineWidth: 1,
          lineWidthMinPixels: 1,
          pickable: true,
          updateTriggers: { getFillColor: [displayYear, selectedYear] },
          onHover: ({ object, x, y }) => {
            if (!object) return setTooltip(null);
            const nta = object.properties.NTA2020;
            const year = Math.floor(displayYear || parseFloat(selectedYear));
            const d = priceData[`${nta}_${year}`];
            setTooltip({ x, y, name: object.properties.NTAName, data: d });
          },
        }),
      ]
    : [];

  const sliderYear = years.findIndex(y => Math.floor(parseFloat(y)) === currentYear);
  const maxCitywide = Math.max(...Object.values(citywideData).filter(v => !isNaN(v)));

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", background: "#1a1a2e" }}>

      {/* LEFT PANEL - MAP */}
      <div style={{ flex: 1, position: "relative" }} onContextMenu={(e) => e.preventDefault()}>
        <DeckGL
          initialViewState={INITIAL_VIEW}
          controller={{ dragRotate: true, dragPan: true, scrollZoom: true, touchRotate: true, keyboard: true, inertia: 300 }}
          layers={layers}
        >
          <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
        </DeckGL>

        <div style={{ position: "absolute", top: 20, left: 20, color: "white", fontFamily: "sans-serif", zIndex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>NYC Real Estate</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Price per sqft relative to citywide median</div>
        </div>

        <div style={{ position: "absolute", top: 20, right: 20, color: "white", fontFamily: "sans-serif", textAlign: "right", zIndex: 1 }}>
          <div style={{ fontSize: 48, fontWeight: "bold" }}>
            {Math.floor(displayYear || parseFloat(selectedYear || 2003))}
          </div>
        </div>

        <div style={{
          position: "absolute", bottom: 40, left: "50%",
          transform: "translateX(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          zIndex: 1,
        }}>
          <input
            type="range"
            min={0}
            max={years.length - 1}
            value={sliderYear >= 0 ? sliderYear : 0}
            onChange={(e) => {
              const y = years[parseInt(e.target.value)];
              setSelectedYear(y);
              setDisplayYear(parseFloat(y));
            }}
            style={{ width: 500 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "white", fontFamily: "sans-serif", fontSize: 12 }}>
            <span>Speed</span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              style={{ width: 100 }}
            />
            <span>{speed}x</span>
          </div>
          <button
            onClick={() => setPlaying((p) => !p)}
            style={{
              padding: "8px 24px", borderRadius: 6,
              background: "#4a90d9", color: "white",
              border: "none", cursor: "pointer", fontSize: 14,
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "white", fontFamily: "sans-serif", fontSize: 12 }}>
            <span>Below average</span>
            <div style={{
              width: 200, height: 12, borderRadius: 4,
              background: "linear-gradient(to right, #00c800, #ffff00, #ff0000)",
            }} />
            <span>Above average</span>
          </div>
          <div style={{ color: "white", fontFamily: "sans-serif", fontSize: 12, opacity: 0.7 }}>
            Bar height = year-over-year price change percentage
          </div>
        </div>

        {tooltip && (
          <div style={{
            position: "absolute", left: tooltip.x + 10, top: tooltip.y + 10,
            background: "rgba(0,0,0,0.8)", color: "white",
            padding: "8px 12px", borderRadius: 6, fontFamily: "sans-serif", fontSize: 13,
            pointerEvents: "none", zIndex: 2,
          }}>
            <div style={{ fontWeight: "bold" }}>{tooltip.name}</div>
            {tooltip.data && !isNaN(tooltip.data.median) ? (
              <>
                <div>Median: ${tooltip.data.median.toFixed(0)}/sqft</div>
                <div>vs citywide: {tooltip.data.relative.toFixed(1)}%</div>
                {!isNaN(tooltip.data.yoy) && (
                  <div>YoY change: {tooltip.data.yoy.toFixed(1)}%</div>
                )}
                <div>Transactions: {tooltip.data.count}</div>
              </>
            ) : (
              <div style={{ opacity: 0.6 }}>No data for this year</div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT PANEL - BAR CHART */}
      <div style={{
        width: 280, background: "#0f0f1a", padding: 20,
        display: "flex", flexDirection: "column", fontFamily: "sans-serif", color: "white",
        borderLeft: "1px solid #ffffff10"
      }}>
        <div style={{ fontSize: 16, fontWeight: "bold", marginBottom: 4 }}>Citywide Median</div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 16 }}>Price per sqft over time</div>

        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 2, minHeight: 200 }}>
          {years
            .filter(y => parseInt(y) <= currentYear)
            .map(y => {
              const yr = parseInt(y);
              const price = citywideData[yr];
              const height = price ? (price / maxCitywide) * 180 : 0;
              const isActive = yr === currentYear;
              return (
                <div key={yr} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                  <div style={{
                    width: "100%", height,
                    borderRadius: "2px 2px 0 0",
                    background: isActive ? "#4a90d9" : "#4a90d960",
                    transition: "height 0.3s ease",
                    minWidth: 4,
                  }} />
                </div>
              );
            })
          }
        </div>

        <div style={{ height: 1, background: "#ffffff20", marginTop: 4 }} />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          <span>{years[0]}</span>
          <span>{currentYear}</span>
        </div>

        {citywideData[currentYear] && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Current year</div>
            <div style={{ fontSize: 28, fontWeight: "bold" }}>
              ${citywideData[currentYear].toFixed(0)}
              <span style={{ fontSize: 12, opacity: 0.6 }}>/sqft</span>
            </div>
          </div>
        )}

        {citywideData[years[0]] && citywideData[currentYear] && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Since {years[0]}</div>
            <div style={{ fontSize: 18, fontWeight: "bold", color: "#4a90d9" }}>
              +{(((citywideData[currentYear] - citywideData[parseInt(years[0])]) / citywideData[parseInt(years[0])]) * 100).toFixed(1)}%
            </div>
          </div>
        )}
      </div>

    </div>
  );
}