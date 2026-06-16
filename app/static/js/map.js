(() => {
    const mapBtn = document.getElementById("map-btn");
    if (!mapBtn) return;

    const form = document.getElementById("meta-form");
    const hid = (name) => form.querySelector(`[name="${name}"]`);
    const summary = document.getElementById("gps-summary");

    const ICON = L.icon({
        iconUrl: "/static/vendor/leaflet/images/marker-icon.png",
        iconRetinaUrl: "/static/vendor/leaflet/images/marker-icon-2x.png",
        shadowUrl: "/static/vendor/leaflet/images/marker-shadow.png",
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
        shadowSize: [41, 41],
    });

    function refreshSummary() {
        const lat = hid("gps_lat").value, lon = hid("gps_lon").value, r = hid("gps_radius_m").value;
        if (lat && lon) {
            summary.innerHTML = `<i class="bi bi-geo-alt-fill"></i> ${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}`
                + (r ? ` (±${r} m)` : "");
        } else {
            summary.textContent = "";
        }
    }
    refreshSummary();

    const modalEl = document.getElementById("map-modal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const radiusInput = document.getElementById("map-radius");
    const coordsEl = document.getElementById("map-coords");
    const results = document.getElementById("map-search-results");

    let map = null, marker = null, circle = null;
    let cur = { lat: null, lon: null, radius: 0 };

    function updateCircle() {
        if (circle) { map.removeLayer(circle); circle = null; }
        if (marker && cur.radius > 0) {
            circle = L.circle([cur.lat, cur.lon], { radius: cur.radius, color: "#4f8cff" }).addTo(map);
        }
    }
    function updateCoords() {
        coordsEl.textContent = cur.lat != null
            ? `${cur.lat.toFixed(5)}, ${cur.lon.toFixed(5)}` : "Klicka i kartan för att sätta position";
    }
    function setPoint(lat, lon) {
        cur.lat = lat; cur.lon = lon;
        if (!marker) {
            marker = L.marker([lat, lon], { icon: ICON, draggable: true }).addTo(map);
            marker.on("dragend", () => {
                const p = marker.getLatLng();
                cur.lat = p.lat; cur.lon = p.lng;
                updateCircle(); updateCoords();
            });
        } else {
            marker.setLatLng([lat, lon]);
        }
        updateCircle(); updateCoords();
    }

    function initMap() {
        map = L.map("map").setView([62.0, 15.0], 4);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19, attribution: "© OpenStreetMap",
        }).addTo(map);
        map.on("click", (e) => setPoint(e.latlng.lat, e.latlng.lng));
    }

    mapBtn.addEventListener("click", () => modal.show());

    modalEl.addEventListener("shown.bs.modal", () => {
        if (!map) initMap();
        map.invalidateSize();
        // Ladda befintlig position
        const lat = hid("gps_lat").value, lon = hid("gps_lon").value, r = hid("gps_radius_m").value;
        cur.radius = r ? parseInt(r, 10) : 0;
        radiusInput.value = r || "";
        if (lat && lon) {
            setPoint(parseFloat(lat), parseFloat(lon));
            map.setView([parseFloat(lat), parseFloat(lon)], 14);
        } else {
            updateCoords();
        }
    });

    radiusInput.addEventListener("input", () => {
        cur.radius = parseInt(radiusInput.value, 10) || 0;
        updateCircle();
    });

    // Adress-/platssökning via backend-proxy
    async function runSearch() {
        const q = document.getElementById("map-search").value.trim();
        if (!q) return;
        results.innerHTML = `<div class="list-group-item">Söker…</div>`;
        try {
            const items = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
            if (!items.length) { results.innerHTML = `<div class="list-group-item">Inga träffar</div>`; return; }
            results.innerHTML = "";
            items.forEach(it => {
                const a = document.createElement("button");
                a.type = "button";
                a.className = "list-group-item list-group-item-action small";
                a.textContent = it.name;
                a.addEventListener("click", () => {
                    setPoint(it.lat, it.lon);
                    map.setView([it.lat, it.lon], 14);
                    results.innerHTML = "";
                });
                results.appendChild(a);
            });
        } catch (err) {
            results.innerHTML = `<div class="list-group-item text-danger">Sökningen misslyckades</div>`;
        }
    }
    document.getElementById("map-search-btn").addEventListener("click", runSearch);
    document.getElementById("map-search").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); runSearch(); }
    });

    document.getElementById("map-clear").addEventListener("click", () => {
        if (marker) { map.removeLayer(marker); marker = null; }
        if (circle) { map.removeLayer(circle); circle = null; }
        cur = { lat: null, lon: null, radius: 0 };
        radiusInput.value = "";
        hid("gps_lat").value = ""; hid("gps_lon").value = ""; hid("gps_radius_m").value = "";
        refreshSummary(); updateCoords();
        showToast("Position rensad (spara för att bekräfta)");
    });

    document.getElementById("map-use").addEventListener("click", () => {
        if (cur.lat == null) { showToast("Ingen position vald", true); return; }
        hid("gps_lat").value = cur.lat.toFixed(6);
        hid("gps_lon").value = cur.lon.toFixed(6);
        hid("gps_radius_m").value = cur.radius > 0 ? String(cur.radius) : "";
        refreshSummary();
        modal.hide();
        showToast("Position satt (spara för att bekräfta)");
    });
})();
