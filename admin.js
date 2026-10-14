
const $ = id => document.getElementById(id);

let productsCache = [];
let rechargeCache = [];
let visibleRecharges = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setMessage(message, ok = true) {
  $("globalMessage").textContent = message;
  $("globalMessage").style.color = ok ? "#08765e" : "#b42318";
}

// ---------- LOGIN ----------
function showDashboard() {
  $("loginPanel").hidden = true;
  $("dashboardPanel").hidden = false;
  refreshDashboard();
}

function showLogin() {
  $("loginPanel").hidden = false;
  $("dashboardPanel").hidden = true;
}

async function checkLogin() {
  try {
    await api("/api/admin/me");
    showDashboard();
  } catch {
    showLogin();
  }
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginMessage").textContent = "Signing in…";

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: $("password").value })
    });

    $("password").value = "";
    $("loginMessage").textContent = "";
    showDashboard();
  } catch (error) {
    $("loginMessage").textContent = error.message;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      body: "{}"
    });
  } catch {}

  showLogin();
});

// ---------- TABS ----------
document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;

    document.querySelectorAll(".tab").forEach(t => {
      t.classList.toggle("active", t === button);
    });

    $("ordersTab").hidden = tab !== "orders";
    $("productsTab").hidden = tab !== "products";
    $("rechargesTab").hidden = tab !== "recharges";

    if (tab === "orders") loadOrders();
    if (tab === "products") loadProducts();
    if (tab === "recharges") loadRecharges();
  });
});

// ---------- DASHBOARD STATISTICS ----------
async function refreshDashboard() {
  try {
    await refreshStats();

    const activeTab =
      document.querySelector(".tab.active")?.dataset.tab || "orders";

    if (activeTab === "products") await loadProducts();
    else if (activeTab === "recharges") await loadRecharges();
    else await loadOrders();

    setMessage("");
  } catch (error) {
    setMessage(error.message, false);
  }
}

async function refreshStats() {
  const d = await api("/api/admin/dashboard");

  $("totalOrders").textContent = d.orders.total;
  $("pendingOrders").textContent = d.orders.pending;
  $("orderValue").textContent =
    "SAR " + Number(d.orders.orderValue).toFixed(2);
  $("totalProducts").textContent = d.products.total;
}

// ---------- CUSTOMER ORDERS ----------
async function loadOrders() {
  try {
    const q = new URLSearchParams();

    if ($("orderSearch").value.trim()) {
      q.set("search", $("orderSearch").value.trim());
    }

    if ($("orderStatus").value) {
      q.set("status", $("orderStatus").value);
    }

    const data = await api("/api/admin/orders?" + q);
    const body = $("ordersBody");

    if (!data.orders.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty">No matching orders found.</td></tr>';
      return;
    }

    body.innerHTML = data.orders.map(o => `
      <tr>
        <td class="order-id">#${esc(o.id)}</td>
        <td>${esc(o.customer_name)}<br><small>${esc(o.phone)}</small></td>
        <td>${esc(o.product_name || "Plan unavailable")}</td>
        <td>SAR ${Number(o.amount).toFixed(2)}</td>
        <td>${esc(o.created_at)}</td>
        <td>
          <select data-order="${esc(o.id)}"
            aria-label="Status for order ${esc(o.id)}">
            ${["Pending", "Confirmed", "Completed", "Cancelled"]
              .map(s => `<option value="${s}"
                ${o.status === s ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll("[data-order]").forEach(select => {
      const original = data.orders.find(
        o => String(o.id) === select.dataset.order
      )?.status;

      select.addEventListener("change", async () => {
        select.disabled = true;

        try {
          await api("/api/admin/orders/" + select.dataset.order, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });

          setMessage(`Order #${select.dataset.order} updated.`);
          await refreshStats();
        } catch (error) {
          select.value = original;
          setMessage(error.message, false);
        } finally {
          select.disabled = false;
        }
      });
    });
  } catch (error) {
    setMessage("Could not load orders: " + error.message, false);
  }
}

// ---------- SIM PLAN MANAGEMENT ----------
async function loadProducts() {
  try {
    const data = await api("/api/admin/products");
    productsCache = data.products;

    const body = $("productsBody");

    if (!productsCache.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty">No plans found.</td></tr>';
      return;
    }

    body.innerHTML = productsCache.map(p => `
      <tr>
        <td><b>${esc(p.name)}</b>${p.featured ? " ★" : ""}
          <br><small>${esc(p.description)}</small></td>
        <td>${esc(p.category)}</td>
        <td>SAR ${Number(p.price).toFixed(2)}</td>
        <td>${esc(p.data)}</td>
        <td>${esc(p.minutes)}</td>
        <td>
          <button class="action" data-edit="${esc(p.id)}">Edit</button>
          <button class="action" data-delete="${esc(p.id)}">Delete</button>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll("[data-edit]").forEach(button => {
      button.addEventListener("click", () =>
        openProduct(Number(button.dataset.edit))
      );
    });

    body.querySelectorAll("[data-delete]").forEach(button => {
      button.addEventListener("click", () =>
        deleteProduct(Number(button.dataset.delete))
      );
    });
  } catch (error) {
    setMessage("Could not load plans: " + error.message, false);
  }
}

function openProduct(id) {
  const p = id ? productsCache.find(x => x.id === id) : null;

  $("productForm").reset();
  $("editId").value = p ? p.id : "";
  $("productModalTitle").textContent = p ? "Edit plan" : "Add plan";
  $("pName").value = p?.name || "";
  $("pCategory").value = p?.category || "MSN";
  $("pDescription").value = p?.description || "";
  $("pPrice").value = p?.price ?? "";
  $("pData").value = p?.data || "";
  $("pMinutes").value = p?.minutes || "";
  $("pBadge").value = p?.badge || "";
  $("pFeatured").checked = !!p?.featured;
  $("productMessage").textContent = "";
  $("productModal").hidden = false;
}

$("newProduct").addEventListener("click", () => openProduct());

$("closeProduct").addEventListener("click", () => {
  $("productModal").hidden = true;
});

$("productModal").addEventListener("click", e => {
  if (e.target === $("productModal")) {
    $("productModal").hidden = true;
  }
});

$("productForm").addEventListener("submit", async e => {
  e.preventDefault();

  const id = $("editId").value;
  const p = {
    name: $("pName").value,
    category: $("pCategory").value,
    description: $("pDescription").value,
    price: Number($("pPrice").value),
    data: $("pData").value,
    minutes: $("pMinutes").value,
    badge: $("pBadge").value,
    featured: $("pFeatured").checked
  };

  try {
    await api(
      id ? "/api/admin/products/" + id : "/api/admin/products",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(p)
      }
    );

    $("productModal").hidden = true;
    setMessage(id ? "Plan updated." : "Plan added.");
    await loadProducts();
    await refreshStats();
  } catch (error) {
    $("productMessage").textContent = error.message;
  }
});

async function deleteProduct(id) {
  const p = productsCache.find(x => x.id === id);

  if (!confirm(`Delete "${p?.name || "this plan"}"?`)) return;

  try {
    await api("/api/admin/products/" + id, { method: "DELETE" });
    setMessage("Plan deleted.");
    await loadProducts();
    await refreshStats();
  } catch (error) {
    setMessage(error.message, false);
  }
}

// ---------- RECHARGE REQUESTS ----------
async function loadRecharges() {
  const body = $("rechargesBody");

  body.innerHTML =
    '<tr><td colspan="6" class="empty">Loading recharge requests…</td></tr>';

  try {
    const data = await api("/api/admin/recharges");

    rechargeCache = Array.isArray(data)
      ? data
      : data.recharges;

    if (!Array.isArray(rechargeCache)) {
      throw Error("Unexpected recharge API response.");
    }

    // Build statistics from all saved records, not just filtered records.
    $("rechargeTotal").textContent = rechargeCache.length;

    $("rechargePending").textContent = rechargeCache.filter(r =>
      r.status === "Demo - Not Processed" ||
      r.status === "Pending"
    ).length;

    const total = rechargeCache.reduce(
      (sum, r) => sum + Number(r.amount || 0), 0
    );

    $("rechargeValue").textContent = "SAR " + total.toFixed(2);

    renderRecharges();
  } catch (error) {
    body.innerHTML =
      '<tr><td colspan="6" class="empty">Could not load recharge requests.</td></tr>';

    setMessage("Recharge API error: " + error.message, false);
  }
}

function renderRecharges() {
  const term = $("rechargeSearch").value.trim().toLowerCase();
  const status = $("rechargeStatus").value;

  visibleRecharges = rechargeCache.filter(r => {
    const matchesSearch =
      String(r.phone || "").toLowerCase().includes(term) ||
      String(r.reference || "").toLowerCase().includes(term) ||
      String(r.id || "").toLowerCase().includes(term);

    const matchesStatus = !status || r.status === status;

    return matchesSearch && matchesStatus;
  });

  const body = $("rechargesBody");

  if (!visibleRecharges.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="empty">No matching recharge requests.</td></tr>';
    return;
  }

  body.innerHTML = visibleRecharges.map(r => `
    <tr>
      <td class="order-id">#${esc(r.id)}</td>
      <td>${esc(r.phone)}</td>
      <td>SAR ${Number(r.amount).toFixed(2)}</td>
      <td>${esc(r.reference || "—")}</td>
      <td>${esc(r.created_at || "—")}</td>
      <td>
        <select data-recharge="${esc(r.id)}"
          aria-label="Status for recharge ${esc(r.id)}">
          <option value="${esc(r.status)}" selected>${esc(r.status)}</option>
        </select>
      </td>
    </tr>
  `).join("");

  // Current status is shown without inventing unsupported status values.
  // The available status transitions must match server.js validation.
}

$("rechargeSearch").addEventListener("input", renderRecharges);
$("rechargeStatus").addEventListener("change", renderRecharges);
$("refreshRecharges").addEventListener("click", loadRecharges);

// Export the currently filtered records.
$("exportRecharges").addEventListener("click", () => {
  if (!visibleRecharges.length) {
    setMessage("There are no recharge records to export.", false);
    return;
  }

  const columns = [
    ["id", "Recharge ID"],
    ["phone", "Mobile number"],
    ["amount", "Amount SAR"],
    ["reference", "Reference"],
    ["status", "Status"],
    ["created_at", "Created at"]
  ];

  const csvCell = value =>
    '"' + String(value ?? "").replace(/"/g, '""') + '"';

  const csv = [
    columns.map(c => csvCell(c[1])).join(","),
    ...visibleRecharges.map(r =>
      columns.map(c => csvCell(r[c[0]])).join(",")
    )
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "msn-recharge-requests.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setMessage("Recharge CSV exported.");
});

// ---------- GENERAL CONTROLS ----------
$("refreshOrders").addEventListener("click", refreshDashboard);
$("orderStatus").addEventListener("change", loadOrders);

let searchTimer;

$("orderSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadOrders, 250);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    $("productModal").hidden = true;
  }
});

checkLogin();
