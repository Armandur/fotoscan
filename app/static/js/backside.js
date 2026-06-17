// Baksides-koppling: koppla en skanning av fotots baksida (handskrivna notiser).
// Stöd-foto som döljs i galleriet och inte delar metadata.
(() => {
    const block = document.getElementById("back-block");
    if (!block) return;
    const photoId = block.dataset.id;

    // Förstora baksidan för att läsa handskriften.
    const backThumb = document.getElementById("back-thumb");
    if (backThumb) {
        backThumb.addEventListener("click", () => {
            showLightbox(backThumb.dataset.src + "?t=" + Date.now());
        });
    }

    // Koppla loss baksidan.
    const unlinkBtn = document.getElementById("back-unlink-btn");
    if (unlinkBtn) {
        unlinkBtn.addEventListener("click", async () => {
            const ok = await showConfirm("Ta bort baksides-kopplingen? Bilden dyker då upp i galleriet igen.");
            if (!ok) return;
            try {
                await apiFetch(`/api/photos/${photoId}/back`, { method: "DELETE" });
                showToast("Koppling borttagen");
                setTimeout(() => location.reload(), 400);
            } catch (err) {
                showToast("Kunde inte ta bort: " + err.message, true);
            }
        });
    }

    // Koppla-baksida-modal med kandidatsök.
    const linkBtn = document.getElementById("back-link-btn");
    if (!linkBtn) return;

    const modalEl = document.getElementById("back-modal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const search = document.getElementById("back-search");
    const list = document.getElementById("back-candidates");
    const empty = document.getElementById("back-empty");
    let timer = null;

    async function load() {
        try {
            const q = encodeURIComponent(search.value.trim());
            const items = await apiFetch(`/api/photos/${photoId}/back-candidates?q=${q}`);
            render(items);
        } catch (err) {
            showToast("Kunde inte hämta kandidater: " + err.message, true);
        }
    }

    function render(items) {
        list.replaceChildren();
        empty.hidden = items.length > 0;
        for (const p of items) {
            const card = document.createElement("div");
            card.className = "card photo-card";
            card.style.cursor = "pointer";

            const img = document.createElement("img");
            img.className = "card-img-top";
            img.loading = "lazy";
            img.src = `/thumb/${p.id}`;
            img.alt = p.filename;

            const body = document.createElement("div");
            body.className = "card-body p-2";
            const name = document.createElement("div");
            name.className = "small text-truncate";
            name.textContent = p.filename;
            const folder = document.createElement("div");
            folder.className = "text-secondary small text-truncate";
            folder.textContent = p.folder || "";
            body.append(name, folder);

            card.append(img, body);
            card.addEventListener("click", () => link(p.id, p.filename));
            list.append(card);
        }
    }

    async function link(otherId, filename) {
        const ok = await showConfirm(`Koppla "${filename}" som baksida?`, { okLabel: "Koppla" });
        if (!ok) return;
        try {
            await apiFetch(`/api/photos/${photoId}/back`, {
                method: "POST", body: { other_id: otherId },
            });
            showToast("Baksida kopplad");
            setTimeout(() => location.reload(), 400);
        } catch (err) {
            showToast("Kunde inte koppla: " + err.message, true);
        }
    }

    linkBtn.addEventListener("click", () => { modal.show(); load(); });
    search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(load, 250);
    });
})();
