(() => {
    const key = "fotoscan.activeAlbum";
    const activate = document.getElementById("activate-album");
    if (activate) activate.addEventListener("click", () => {
        try {
            sessionStorage.setItem(key, activate.dataset.albumId);
            showToast("Albumet är valt för snabbval. Öppna en bild och tryck B.");
            activate.textContent = "Valt för snabbval";
        } catch (error) { showToast("Webbläsaren kunde inte spara albumvalet", true); }
    });
    const panel = document.getElementById("album-selection");
    if (!panel) return;
    const select = document.getElementById("active-album");
    const button = document.getElementById("album-toggle");
    const status = document.getElementById("album-state");
    const link = document.getElementById("active-album-link");
    const photoId = Number(panel.dataset.photoId);
    let albums = [], busy = null, loading = true;
    function render() {
        const album = albums.find(a => String(a.id) === select.value);
        button.disabled = !!busy || loading;
        select.disabled = !!busy || loading;
        button.textContent = album ? (album.contains ? "Ta bort ur album (B)" : "Lägg till i album (B)") : "Välj album först (B)";
        button.setAttribute("aria-pressed", String(!!album?.contains));
        button.classList.toggle("btn-primary", !!album?.contains);
        button.classList.toggle("btn-outline-primary", !album?.contains);
        link.href = album ? `/albums/${album.id}` : "/albums";
        link.textContent = album ? `Visa album (${album.count})` : "Skapa eller hantera album";
    }
    async function load() {
        loading = true;
        status.textContent = "Hämtar albumval…";
        render();
        albums = await apiFetch(`/api/albums?photo_id=${photoId}`);
        select.replaceChildren(new Option("Välj album...", ""));
        for (const album of albums) select.add(new Option(album.name, album.id));
        const stored = sessionStorage.getItem(key);
        select.value = albums.some(a => String(a.id) === stored) ? stored : "";
        if (!select.value) sessionStorage.removeItem(key);
        loading = false;
        status.textContent = "";
        render();
    }
    select.addEventListener("change", () => {
        try { sessionStorage.setItem(key, select.value); }
        catch (error) { showToast("Webbläsaren kunde inte spara albumvalet", true); }
        render();
        select.blur();
    });
    async function toggle() {
        if (busy || loading) return;
        const album = albums.find(a => String(a.id) === select.value);
        if (!album) { select.focus(); showToast("Välj ett album för snabbval"); return; }
        const remove = album.contains;
        status.textContent = "Sparar...";
        busy = (async () => {
            try {
                await apiFetch(remove ? `/api/albums/${album.id}/photos/${photoId}` : `/api/albums/${album.id}/photos`, {
                    method: remove ? "DELETE" : "POST", body: remove ? undefined : { photo_ids: [photoId] },
                });
                album.contains = !remove;
                album.count += remove ? -1 : 1;
                status.textContent = remove ? "Bilden är borttagen ur albumet" : "Bilden är tillagd i albumet";
                return true;
            } catch (error) {
                status.textContent = "Kunde inte spara. Försök igen.";
                showToast(error.message, true);
                try { await load(); } catch (reloadError) { showToast("Kunde inte hämta albumstatus", true); }
                return false;
            }
        })();
        render();
        await busy;
        busy = null;
        render();
    }
    window.albumNavigate = async (url) => {
        if (busy && !await busy) return;
        location.href = url;
    };
    document.addEventListener("click", (event) => {
        const anchor = event.target.closest("a[href]");
        if (!busy || !anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
        event.preventDefault();
        window.albumNavigate(anchor.href);
    }, true);
    button.addEventListener("click", toggle);
    document.addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() !== "b" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const el = document.activeElement;
        if (el?.matches("input, textarea, select") || el?.isContentEditable || document.body.classList.contains("modal-open")) return;
        event.preventDefault();
        toggle();
    });
    function refresh() {
        load().catch(error => {
            status.textContent = "Kunde inte hämta album. Ladda om sidan.";
            showToast(error.message, true);
        });
    }
    refresh();
    window.addEventListener("pageshow", event => {
        if (event.persisted) refresh();
    });
})();
