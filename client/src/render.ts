const COLORS = ["#8b5cf6", "#3b82f6", "#22c55e", "#f97316", "#ec4899"];

export function colorForClient(clientId: string): string {
    let hash = 0;
    for (let i = 0; i < clientId.length; i++) {
        hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLORS[Math.abs(hash) % COLORS.length];
}

// FIX: escaping the name before it goes into innerHTML — a clientId/name
// containing HTML characters would otherwise be interpreted as markup
function escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

export function renderCursor(
    container: HTMLElement,
    clientId: string,
    x: number,
    y: number,
    name: string
) {
    let el = document.getElementById(`cursor-${clientId}`);
    if (!el) {
        el = document.createElement("div");
        el.id = `cursor-${clientId}`;
        el.style.position = "absolute";
        el.style.pointerEvents = "none";
        el.style.zIndex = "50";
        el.style.transform = "translate(-2px, -2px)";
        el.innerHTML = `
      <div style="width:10px;height:10px;border-radius:50%;background:${colorForClient(clientId)}"></div>
      <span style="font-size:11px;background:${colorForClient(clientId)};color:white;padding:1px 5px;border-radius:3px;white-space:nowrap;">${escapeHtml(name)}</span>
    `;
        container.appendChild(el);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
}

export function removeCursor(clientId: string) {
    document.getElementById(`cursor-${clientId}`)?.remove();
}