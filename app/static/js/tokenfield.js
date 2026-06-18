// Token-fält: chips inuti ett contenteditable formulärfält.
// - Klicka i fältet -> pekaren hamnar i slutet, skriv för förslag.
// - Enter / komma / klick på förslag -> texten blir en chip.
// - Backspace vid pekaren tar bort chipet före (pekaren kan stå mellan chips).
// - Fältet växer på höjden när chips radbryts.
//
// window.tokenField(host, { suggest, linkBase, onChange })
//   host      : contenteditable div (.token-field), ev. med server-renderade .tok
//   suggest   : async (term) => [{ id, name }]  (id valfritt)
//   linkBase  : t.ex. "/persons/" -> chip-namnet blir en länk (annars null)
//   onChange  : valfri callback när chips ändras
// Returnerar { tokens, addToken }.
(function () {
    function tokenField(host, opts) {
        const linkBase = opts.linkBase || null;
        const wrap = host.parentElement;
        wrap.style.position = "relative";
        const ac = document.createElement("div");
        ac.className = "face-ac token-ac";
        wrap.appendChild(ac);
        let items = [], active = -1;

        const changed = () => { if (opts.onChange) opts.onChange(); };

        function tokens() {
            return [...host.querySelectorAll(".tok")].map(
                s => ({ name: s.dataset.name, id: s.dataset.id || null }));
        }
        function has(name) {
            const lo = name.toLowerCase();
            return [...host.querySelectorAll(".tok")]
                .some(s => s.dataset.name.toLowerCase() === lo);
        }
        function wireX(span) {
            const x = span.querySelector(".tok-x");
            if (x) x.addEventListener("mousedown", (e) => {
                e.preventDefault(); span.remove(); changed(); host.focus();
            });
        }
        function makeChip(name, id) {
            const span = document.createElement("span");
            span.className = "tok";
            span.contentEditable = "false";
            span.dataset.name = name;
            if (id) span.dataset.id = id;
            const lbl = (linkBase && id) ? document.createElement("a")
                : document.createElement("span");
            lbl.className = "tok-label";
            lbl.textContent = name;
            if (linkBase && id) lbl.href = linkBase + id;
            const x = document.createElement("span");
            x.className = "tok-x"; x.textContent = "×"; x.title = "Ta bort";
            span.append(lbl, x);
            wireX(span);
            return span;
        }
        host.querySelectorAll(".tok").forEach(wireX);  // server-renderade chips

        // ---- Pekare / textnod vid pekaren ----
        function caretTextNode() {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return null;
            const n = sel.anchorNode;
            if (n && n.nodeType === 3 && n.parentNode === host) return n;
            return null;
        }
        function currentTerm() {
            const n = caretTextNode();
            return n ? n.textContent.replace(/ /g, " ").trim() : "";
        }
        function caretToEnd() {
            host.focus();
            const r = document.createRange();
            r.selectNodeContents(host); r.collapse(false);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        }
        function caretAfter(node) {
            const sp = document.createTextNode(" ");
            if (node.nextSibling) host.insertBefore(sp, node.nextSibling);
            else host.appendChild(sp);
            const r = document.createRange();
            r.setStart(sp, 1); r.collapse(true);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        }

        // ---- Lägg till chip ----
        function addToken(name, id, atNode) {
            name = (name || "").trim();
            if (!name || has(name)) { hideAc(); return; }
            const chip = makeChip(name, id);
            const n = atNode || caretTextNode();
            if (n) { n.textContent = ""; host.insertBefore(chip, n); }
            else host.appendChild(chip);
            caretAfter(chip);
            hideAc();
            changed();
        }

        // ---- Förslagslista ----
        function hideAc() { ac.classList.remove("show"); items = []; active = -1; }
        function renderAc() {
            ac.innerHTML = items.map((p, i) => {
                const thumb = p.region_id
                    ? `<img class="face-ac-thumb" src="/api/faces/${p.region_id}/thumb" alt="">`
                    : (linkBase ? `<span class="face-ac-thumb empty"><i class="bi bi-person"></i></span>` : "");
                const count = (p.count !== undefined) ? `<span class="face-ac-count">${p.count}</span>` : "";
                return `<div class="face-ac-item${i === active ? " active" : ""}" data-name="${escapeHtml(p.name)}" data-id="${p.id || ""}">`
                    + thumb + `<span class="face-ac-name">${escapeHtml(p.name)}</span>` + count + `</div>`;
            }).join("");
            ac.classList.toggle("show", items.length > 0);
        }
        async function search() {
            const term = currentTerm();
            if (!term) { hideAc(); return; }
            try { items = await opts.suggest(term); } catch (e) { items = []; }
            items = items.filter(p => !has(p.name)).slice(0, 8);
            active = -1; renderAc();
        }

        ac.addEventListener("mousedown", (e) => {
            const it = e.target.closest(".face-ac-item");
            if (it) { e.preventDefault(); addToken(it.dataset.name, it.dataset.id || null); }
        });
        host.addEventListener("input", search);
        host.addEventListener("click", (e) => {
            // Klick i tom yta (inte på chip/länk) -> pekaren till slutet.
            if (e.target === host) caretToEnd();
        });
        host.addEventListener("blur", () => setTimeout(hideAc, 150));
        host.addEventListener("keydown", (e) => {
            if (ac.classList.contains("show") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                active = e.key === "ArrowDown"
                    ? Math.min(active + 1, items.length - 1) : Math.max(active - 1, 0);
                renderAc();
                return;
            }
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (active >= 0) addToken(items[active].name, items[active].id || null);
                else { const t = currentTerm(); if (t) addToken(t); }
                return;
            }
            if (e.key === "Escape") { hideAc(); return; }
            if (e.key === "Backspace") {
                const sel = window.getSelection();
                if (!sel.rangeCount) return;
                const n = sel.anchorNode, off = sel.anchorOffset;
                // Pekaren i början av en (tom) textnod, eller direkt i host:
                // ta bort chipet omedelbart före pekaren.
                let prev = null;
                if (n.nodeType === 3 && off === 0) prev = n.previousSibling;
                else if (n === host && off > 0) prev = host.childNodes[off - 1];
                if (prev && prev.nodeType === 1 && prev.classList.contains("tok")) {
                    e.preventDefault(); prev.remove(); changed();
                }
            }
        });

        return { tokens, addToken, focus: caretToEnd };
    }
    window.tokenField = tokenField;
})();
