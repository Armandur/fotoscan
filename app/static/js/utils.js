async function apiFetch(url, options = {}) {
    const opts = { headers: {}, ...options };
    if (opts.body && typeof opts.body !== "string") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
}

function showToast(message, isError = false) {
    const el = document.getElementById("toast");
    if (!el) return;
    document.getElementById("toast-body").textContent = message;
    el.classList.remove("text-bg-danger", "text-bg-success");
    el.classList.add(isError ? "text-bg-danger" : "text-bg-success");
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3000 }).show();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}
