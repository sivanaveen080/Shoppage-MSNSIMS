// ==========================================
// MSN STORE - MAIN APPLICATION
// Demo mode: SIM orders and mobile recharges
// ==========================================

const $ = id => document.getElementById(id);

const productsEl = $("products");
const searchEl = $("search");
const countEl = $("count");
const sortEl = $("sort");

let category = "All";
let products = [];
let selected = null;
let timer;

// Current year
if ($("year")) {
  $("year").textContent = new Date().getFullYear();
}

// ==========================================
// COMMON HELPERS
// ==========================================

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// ==========================================
// LOAD AND DISPLAY SIM PLANS
// ==========================================

async function load() {
  if (!productsEl) return;

  productsEl.innerHTML =
    '<div class="loading">Loading products from database…</div>';

  try {
    const query = new URLSearchParams();

    if (category !== "All") {
      query.set("category", category);
    }

    if (searchEl && searchEl.value.trim()) {
      query.set("search", searchEl.value.trim());
    }

    const data = await api("/api/products?" + query.toString());

    products = Array.isArray(data) ? data : [];

    if (sortEl?.value === "low") {
      products.sort((a, b) => Number(a.price) - Number(b.price));
    }

    if (sortEl?.value === "high") {
      products.sort((a, b) => Number(b.price) - Number(a.price));
    }

    render();
  } catch (error) {
    productsEl.innerHTML =
      '<div class="empty">Could not load plans. Check that the server is running.</div>';

    if (countEl) countEl.textContent = "Connection error";

    console.error("Plan loading error:", error);
  }
}

function render() {
  if (!productsEl) return;

  if (countEl) {
    countEl.textContent =
      `Showing ${products.length} plan${products.length === 1 ? "" : "s"}`;
  }

  if (!products.length) {
    productsEl.innerHTML =
      '<div class="empty">No plans found. Try another category or search term.</div>';
    return;
  }

  productsEl.innerHTML = products.map(p => `
    <article class="product">
      <div class="product-icon">
        ${p.category === "MSN Travel" ? "✈" :
          p.category === "Replacement" ? "SIM" :
          p.category === "Data" ? "▥" : "▣"}
      </div>

      <div class="product-main">
        <div class="product-title-row">
          <h3>${esc(p.name)}</h3>
          ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ""}
        </div>

        <div class="product-price">
          From SAR ${Number(p.price).toFixed(2)}
        </div>

        <div class="product-specs">
          <span>◉ ${esc(p.data)}</span>
          <span>♧ ${esc(p.minutes)}</span>
        </div>
      </div>

      <button
        class="details"
        data-id="${Number(p.id)}"
        aria-label="View ${esc(p.name)} details"
      >→</button>
    </article>
  `).join("");

  productsEl.querySelectorAll("[data-id]").forEach(button => {
    button.addEventListener("click", () => {
      openPlan(Number(button.dataset.id));
    });
  });
}

// Category filters
document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    category = button.dataset.category;
    load();
  });
});

// Search and sorting
if (searchEl) {
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
}

if (sortEl) {
  sortEl.addEventListener("change", load);
}

// ==========================================
// SIM PLAN ORDER MODAL
// ==========================================

const modal = $("modal");

function openPlan(id) {
  selected = products.find(p => Number(p.id) === Number(id));

  if (!selected) return;

  $("productId").value = selected.id;
  $("modalTitle").textContent = selected.name;

  $("modalDescription").textContent =
    `${selected.description} Benefits: ${selected.data}, ` +
    `${selected.minutes}. Category: ${selected.category}.`;

  $("modalPrice").textContent =
    `SAR ${Number(selected.price).toFixed(2)} · sample price`;

  $("orderMessage").textContent = "";
  $("lookupResults").textContent = "";

  modal.hidden = false;
  document.body.classList.add("no-scroll");
}

function closeModal() {
  if (!modal) return;

  modal.hidden = true;
  document.body.classList.remove("no-scroll");
}

$("close")?.addEventListener("click", closeModal);

modal?.addEventListener("click", event => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal && !modal.hidden) {
    closeModal();
  }
});

// Submit a SIM plan order
$("orderForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const message = $("orderMessage");
  message.textContent = "Submitting order request…";

  try {
    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        productId: Number($("productId").value),
        customerName: $("customerName").value.trim(),
        phone: $("phone").value.trim()
      })
    });

    message.textContent =
      `${data.message} Reference #${data.orderId}.`;

    if ($("cartCount")) {
      $("cartCount").textContent = "✓";
    }
  } catch (error) {
    message.textContent = error.message;
  }
});

// Search previous SIM orders
$("lookupOrders")?.addEventListener("click", async () => {
  const phone = $("phone").value.trim();
  const results = $("lookupResults");

  if (phone.length < 7) {
    results.textContent = "Please enter a valid mobile number first.";
    return;
  }

  results.textContent = "Searching saved orders…";

  try {
    const data = await api(
      "/api/orders/lookup?phone=" + encodeURIComponent(phone)
    );

    if (!data.orders || !data.orders.length) {
      results.textContent = "No previous orders found for this number.";
      return;
    }

    results.textContent = "Previous orders:\n" + data.orders.map(order =>
      `#${order.id} · ${order.product_name || "Plan"} · ` +
      `SAR ${Number(order.amount).toFixed(2)} · ` +
      `${order.status} · ${order.created_at}`
    ).join("\n");
  } catch (error) {
    results.textContent = error.message;
  }
});

// Featured plan button
$("featuredOrder")?.addEventListener("click", async () => {
  let plan = products.find(p => p.name === "MSN 90");

  if (!plan) {
    await load();
    plan = products.find(p => p.name === "MSN 90");
  }

  if (plan) {
    openPlan(plan.id);
  } else {
    alert("The MSN 90 plan could not be found.");
  }
});

// Demo login
$("loginBtn")?.addEventListener("click", () => {
  alert("Customer login is not enabled in this demo.");
});

// ==========================================
// MOBILE RECHARGE - DEMO MODE
// Requires the /api/recharges endpoints
// in server.js.
// ==========================================

const rechargeForm = $("rechargeForm");

rechargeForm?.addEventListener("submit", async event => {
  event.preventDefault();

  const phone = $("rechargePhone").value.trim();
  const amount = Number($("rechargeAmount").value);
  const message = $("rechargeMessage");

  if (phone.length < 7 || phone.length > 20) {
    message.textContent = "Please enter a valid mobile number.";
    return;
  }

  const allowedAmounts = [10, 20, 30, 50, 100, 200];

  if (!allowedAmounts.includes(amount)) {
    message.textContent = "Please select a valid recharge amount.";
    return;
  }

  message.textContent = "Saving demo recharge request…";

  try {
    const data = await api("/api/recharges", {
      method: "POST",
      body: JSON.stringify({ phone, amount })
    });

    message.textContent =
      `${data.message || "Demo recharge request saved."} ` +
      `Reference: ${data.reference || data.id || "created"}.`;

    // Refresh history for this number
    await loadRechargeHistory(phone);
  } catch (error) {
    message.textContent = error.message;
  }
});

// Search saved recharge requests
async function loadRechargeHistory(phone) {
  const results = $("rechargeResults");

  if (!results) return;

  results.textContent = "Loading recharge history…";

  try {
    const data = await api(
      "/api/recharges/lookup?phone=" + encodeURIComponent(phone)
    );

    const recharges = data.recharges || [];

    if (!recharges.length) {
      results.textContent = "No previous recharge requests found.";
      return;
    }

    results.replaceChildren();

    const heading = document.createElement("h4");
    heading.textContent = "Recharge history";
    results.appendChild(heading);

    const list = document.createElement("ul");

    recharges.forEach(recharge => {
      const item = document.createElement("li");

      item.textContent =
        `#${recharge.id} · ${recharge.phone} · ` +
        `SAR ${Number(recharge.amount).toFixed(2)} · ` +
        `${recharge.status} · ${recharge.created_at}`;

      list.appendChild(item);
    });

    results.appendChild(list);
  } catch (error) {
    results.textContent = error.message;
  }
}

$("rechargeHistory")?.addEventListener("click", async () => {
  const phone = $("rechargePhone").value.trim();

  if (phone.length < 7 || phone.length > 20) {
    $("rechargeMessage").textContent =
      "Enter a valid mobile number to search recharge history.";
    return;
  }

  await loadRechargeHistory(phone);
});

// Initial product loading
load();
