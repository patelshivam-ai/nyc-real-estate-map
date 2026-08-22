import React, { useState, useEffect, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

const INITIAL_VIEW = {
  longitude: -73.98,
  latitude: 40.7,
  zoom: 10,
  pitch: 0,
  bearing: 0,
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

function getColorForValue(relative) {
  // Stops anchored to actual data percentiles:
  // -66% = Bronx bottom, -6% = citywide median neighborhood, +70% = inner Brooklyn/Queens top, +210% = Manhattan top
  const stops = [
    { val: -66,  r: 0,   g: 180, b: 80  },  // deep green  (Bronx bottom)
    { val: -30,  r: 100, g: 210, b: 0   },  // green       (25th pct)
    { val:  -6,  r: 255, g: 220, b: 0   },  // yellow      (median neighborhood)
    { val:  70,  r: 255, g: 80,  b: 0   },  // orange      (75th pct)
    { val: 140,  r: 220, g: 20,  b: 0   },  // red         (90th pct)
    { val: 210,  r: 140, g: 0,   b: 30  },  // deep crimson (Manhattan top)
  ];

  const clamped = Math.min(Math.max(relative, stops[0].val), stops[stops.length - 1].val);

  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i], hi = stops[i + 1];
    if (clamped <= hi.val) {
      const t = (clamped - lo.val) / (hi.val - lo.val);
      return [
        Math.round(lo.r + (hi.r - lo.r) * t),
        Math.round(lo.g + (hi.g - lo.g) * t),
        Math.round(lo.b + (hi.b - lo.b) * t),
        210,
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b, 210];
}

export default function App() {
  const [geojson, setGeojson] = useState(null);
  const [priceData, setPriceData] = useState({});
  const [citywideData, setCitywideData] = useState({});
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [displayYear, setDisplayYear] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [speed, setSpeed] = useState(1);

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

        rows.forEach((row) => {
          const key = `${row.NTA2020}_${parseInt(row.Year)}`;
          byNtaYear[key] = {
            relative: parseFloat(row.relative_performance),
            median: parseFloat(row.median_price_per_sqft),
            count: parseInt(row.transaction_count),
            yoy: parseFloat(row.yoy_change),
          };
          yearSet.add(row.Year);
          const yr = parseInt(row.Year);
          if (!citywideByYear[yr]) {
            citywideByYear[yr] = parseFloat(row.citywide_median);
          }
        });

        const sortedYears = [...yearSet].sort();
        setPriceData(byNtaYear);
        setCitywideData(citywideByYear);
        setYears(sortedYears);
        setSelectedYear(sortedYears[0]);
        setDisplayYear(parseFloat(sortedYears[0]));
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
        const next = prev + 0.015;
        setSelectedYear(String(Math.floor(next)));
        return next;
      });
    }, 16 / speed);
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

      const gray = [100, 100, 100];

      if (!d1valid) {
        // transitioning from gray into color
        const c2 = getColorForValue(d2.relative);
        return [
          Math.round(gray[0] + (c2[0] - gray[0]) * t),
          Math.round(gray[1] + (c2[1] - gray[1]) * t),
          Math.round(gray[2] + (c2[2] - gray[2]) * t),
          180,
        ];
      }

      if (!d2valid) {
        // transitioning from color into gray
        const c1 = getColorForValue(d1.relative);
        return [
          Math.round(c1[0] + (gray[0] - c1[0]) * t),
          Math.round(c1[1] + (gray[1] - c1[1]) * t),
          Math.round(c1[2] + (gray[2] - c1[2]) * t),
          180,
        ];
      }

      const c1 = getColorForValue(d1.relative);
      const c2 = getColorForValue(d2.relative);

      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
        200,
      ];
    },
    [priceData, selectedYear, displayYear]
  );

  const currentYear = Math.floor(displayYear || parseFloat(selectedYear || years[0]));
  const minYear = parseFloat(years[0]);
  const maxYear = parseFloat(years[years.length - 1]);
  const sliderValue = playing
    ? ((displayYear - minYear) / (maxYear - minYear)) * (years.length - 1)
    : years.findIndex(y => Math.floor(parseFloat(y)) === currentYear);
  const maxCitywide = Math.max(...Object.values(citywideData).filter(v => !isNaN(v)));

  const layers = geojson
    ? [
        new GeoJsonLayer({
          id: "nta",
          data: geojson,
          filled: true,
          stroked: true,
          extruded: false,
          getFillColor: getColor,
          getLineColor: [255, 255, 255, 60],
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

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", background: "#1a1a2e" }}>

      {/* LEFT PANEL - MAP */}
      <div style={{ flex: 1, position: "relative" }}>
        <DeckGL
          initialViewState={INITIAL_VIEW}
          controller={true}
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
            value={sliderValue >= 0 ? sliderValue : 0}
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
            <span style={{ whiteSpace: "nowrap" }}>Below average</span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{
                width: 300, height: 12, borderRadius: 4,
                background: "linear-gradient(to right, #00b450, #64d200, #ffdc00, #ff5000, #dc1400, #8c001e)",
              }} />
              <div style={{ display: "flex", justifyContent: "center", width: 300, fontSize: 10, opacity: 0.6 }}>
                <span>Average</span>
              </div>
            </div>
            <span style={{ whiteSpace: "nowrap" }}>Above average</span>
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