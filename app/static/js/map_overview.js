// Kartöversikt: en markör per plats med GPS, klick -> platsens foton.
(() => {
    const el = document.getElementById("overview-map");
    if (!el || typeof L === "undefined") return;

    const map = L.map(el);
    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
    });
    const sat = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles © Esri" },
    );
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17, attribution: "© OpenTopoMap (CC-BY-SA)",
    });
    osm.addTo(map);
    L.control.layers({ "Karta": osm, "Satellit": sat, "Topografisk": topo }).addTo(map);

    const icon = L.icon({
        iconUrl: "/static/vendor/leaflet/images/marker-icon.png",
        iconRetinaUrl: "/static/vendor/leaflet/images/marker-icon-2x.png",
        shadowUrl: "/static/vendor/leaflet/images/marker-shadow.png",
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
        shadowSize: [41, 41],
    });

    const fallback = () => map.setView([62, 15], 4);  // Sverige-vy

    fetch("/api/map/points")
        .then(r => r.json())
        .then(points => {
            if (!points.length) {
                document.getElementById("map-empty").hidden = false;
                fallback();
                return;
            }
            const markers = points.map(p => {
                const m = L.marker([p.lat, p.lon], { icon });
                const n = p.count;
                m.bindPopup(
                    `<strong>${escapeHtml(p.name)}</strong><br>` +
                    `${n} foto${n === 1 ? "" : "n"}<br>` +
                    `<a href="/place/${p.id}">Visa foton</a>`
                );
                return m;
            });
            L.featureGroup(markers).addTo(map);
            map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
        })
        .catch(fallback);
})();
