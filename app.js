// ---- Firebase setup ----
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAb0sMztiRFJ2GcGgWzMVR2zLhhpBsElYY",
  authDomain: "bin-roster.firebaseapp.com",
  projectId: "bin-roster",
  storageBucket: "bin-roster.firebasestorage.app",
  messagingSenderId: "20571088348",
  appId: "1:20571088348:web:6e800ae4fb5b29ce391b19",
  measurementId: "G-L5E48RQBXP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rosterRef = doc(db, "roster", "config");

// ---- Date helpers ----

// Format a Date as local YYYY-MM-DD (avoids UTC shift from toISOString)
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD string into a local Date (midnight local time)
function fromISO(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function displayDate(str) {
  const d = fromISO(str);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dayName(str) {
  return fromISO(str).toLocaleDateString("en-US", { weekday: "long" });
}

// Find the next occurrence of dayOfWeek on/after fromDate
function nextOccurrence(dayOfWeek, fromDate) {
  const result = new Date(fromDate);
  const diff = (dayOfWeek - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

// Build the full weekly roster from today through Dec 31 of this year
function buildRoster(tenants, binDay, startMonth, endMonth) {
  if (!tenants.length) return [];

  const start = new Date(startMonth + "-01");

  const [endYear, endMon] = endMonth.split("-").map(Number);
  const end = new Date(endYear, endMon, 0);

  const roster = [];

  let current = nextOccurrence(binDay, start);

  let i = 0;

  while (current <= end) {
    roster.push({
      date: toISO(current),
      tenant: tenants[i % tenants.length]
    });

    current = new Date(current);
    current.setDate(current.getDate() + 7);

    i++;
  }

  return roster;
}

function escapeHtml(str) {
  return $("<div>").text(str).html();
}

// ---- Tenant color coding ----
// Each tenant gets a consistent color derived from their name, so the same
// person always shows the same color across the tag card, table, and PDF.
const TENANT_COLORS = [
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#10B981",
  "#F59E0B",
  "#EF4444"
];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TENANT_COLORS[hash % TENANT_COLORS.length];
}

// ---- Rendering ----

function renderPublicView(data) {
  const generatedRoster = data.generatedRoster || [];
  const todayStr = toISO(new Date());
  const upcoming = generatedRoster.filter(r => r.date >= todayStr);

  if (upcoming.length) {
    $("#next-date").text(displayDate(upcoming[0].date));
    $("#next-name").text(upcoming[0].tenant);
    $("#next-dot").css("background-color", colorForName(upcoming[0].tenant)).removeClass("hidden");
  } else {
    $("#next-date").text("—");
    $("#next-name").text(generatedRoster.length ? "Roster ended — regenerate for next year" : "No roster set yet");
    $("#next-dot").addClass("hidden");
  }

  const $body = $("#roster-body").empty();
  if (!generatedRoster.length) {
    $body.append('<tr class="empty-row"><td colspan="3">No roster yet.</td></tr>');
  } else {
    generatedRoster.forEach(r => {
      const isToday = r.date === todayStr;
      const tenantColor = colorForName(r.tenant);

      $body.append(
        `<tr class="${isToday ? "is-today" : ""}"
          style="
            background:#f8f9fa;
            border-left:6px solid ${tenantColor};">
          <td>${displayDate(r.date)}</td>
          <td>${dayName(r.date)}</td>
          <td>${escapeHtml(r.tenant)}</td>
        </tr>`
      );
    });
    $("#schedule-range").text(
      `(${displayDate(generatedRoster[0].date)} – ${displayDate(generatedRoster[generatedRoster.length - 1].date)})`
    );
  }
}

function renderTenantList() {
  const $list = $("#tenant-list").empty();
  editState.tenants.forEach((name, i) => {
    $list.append(
      `<li data-index="${i}">
        <span class="tenant-dot" style="background-color:${colorForName(name)}"></span>
        ${escapeHtml(name)}
        <button class="remove-tenant" type="button" aria-label="Remove ${escapeHtml(name)}">×</button>
      </li>`
    );
  });
}

// ---- State ----

let currentConfig = { tenants: [], binDay: 1, generatedRoster: [] };
let editState = { tenants: [], binDay: 1 };

// ---- Firestore live sync (public view, always on) ----

onSnapshot(rosterRef, (snap) => {
  currentConfig = snap.exists() ? snap.data() : { tenants: [], binDay: 1, generatedRoster: [] };
  renderPublicView(currentConfig);
}, (err) => {
  console.error("Failed to load roster:", err);
  $("#next-name").text("Couldn't load roster — check your connection");
});

// ---- Admin: toggle login form ----

$("#admin-toggle").on("click", () => {
  $("#login-form").toggleClass("hidden");
});

// ---- Admin: login ----

$("#login-form").on("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").val().trim();
  const password = $("#login-password").val();
  $("#login-error").addClass("hidden");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $("#login-password").val("");
  } catch (err) {
    $("#login-error").text("Login failed — check your email and password.").removeClass("hidden");
  }
});

// ---- Admin: logout ----

$("#logout-btn").on("click", async () => {
  await signOut(auth);
});

// ---- Admin: auth state ----

onAuthStateChanged(auth, (user) => {
  if (user) {
    $("#admin-toggle").addClass("hidden");
    $("#login-form").addClass("hidden");
    $("#admin-panel").removeClass("hidden");
    $("#admin-email").text(user.email);

    // Pull current saved state into the local edit buffer
    editState = {
      tenants: [...(currentConfig.tenants || [])],
      binDay: currentConfig.binDay ?? 1
    };
    $("#bin-day").val(String(editState.binDay));
    renderTenantList();
  } else {
    $("#admin-toggle").removeClass("hidden");
    $("#admin-panel").addClass("hidden");
    $("#login-form")[0].reset();
    $("#login-form").addClass("hidden");
  }
});

// ---- Admin: add tenant ----

$("#add-tenant-btn").on("click", addTenantFromInput);
$("#tenant-input").on("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addTenantFromInput();
  }
});

function addTenantFromInput() {
  const name = $("#tenant-input").val().trim();
  if (!name) return;
  editState.tenants.push(name);
  $("#tenant-input").val("");
  renderTenantList();
}

// ---- Admin: remove tenant ----

$("#tenant-list").on("click", ".remove-tenant", function () {
  const index = $(this).closest("li").data("index");
  editState.tenants.splice(index, 1);
  renderTenantList();
});

// ---- Admin: generate + save ----

$("#generate-btn").on("click", async () => {
  editState.binDay = parseInt($("#bin-day").val(), 10);

  if (!editState.tenants.length) {
    $("#save-status").text("Add at least one tenant first.").removeClass("hidden");
    return;
  }

  const startMonth = $("#start-month").val();
  const endMonth = $("#end-month").val();

  if (!startMonth || !endMonth) {
    $("#save-status")
      .text("Select start and end months.")
      .removeClass("hidden");
    return;
  }

  const generatedRoster = buildRoster(
    editState.tenants,
    editState.binDay,
    startMonth,
    endMonth
  );

  $("#save-status").text("Saving…").removeClass("hidden");
  try {
    await setDoc(rosterRef, {
      tenants: editState.tenants,
      binDay: editState.binDay,
      startMonth,
      endMonth,
      generatedRoster,
      updatedAt: serverTimestamp()
    });
    $("#save-status").text("Saved ✓");
    setTimeout(() => $("#save-status").addClass("hidden"), 2500);
  } catch (err) {
    console.error(err);
    $("#save-status").text("Couldn't save — check your connection and try again.");
  }
});

// ---- Admin: reset roster ----

$("#reset-btn").on("click", async () => {
  const confirmed = window.confirm(
    "Reset the roster? This clears all tenants and the schedule. This can't be undone."
  );
  if (!confirmed) return;

  editState.tenants = [];
  renderTenantList();

  $("#save-status").text("Resetting…").removeClass("hidden");
  try {
    await setDoc(rosterRef, {
      tenants: [],
      binDay: editState.binDay,
      generatedRoster: [],
      updatedAt: serverTimestamp()
    });
    $("#save-status").text("Reset ✓");
    setTimeout(() => $("#save-status").addClass("hidden"), 2500);
  } catch (err) {
    console.error(err);
    $("#save-status").text("Couldn't reset — check your connection and try again.");
  }
});

// ---- Download PDF ----

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

$("#download-pdf-btn").on("click", () => {
  const generatedRoster = currentConfig.generatedRoster || [];

  if (!generatedRoster.length) {
    alert("No roster available.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  pdf.setFontSize(18);
  pdf.text("Bin Roster", 14, 18);

  pdf.setFontSize(10);
  pdf.text(
    `${displayDate(generatedRoster[0].date)} - ${displayDate(generatedRoster[generatedRoster.length - 1].date)}`,
    14,
    26
  );

  pdf.autoTable({
    head: [["Date", "Day", "Tenant"]],
    body: generatedRoster.map(r => [
      displayDate(r.date),
      dayName(r.date),
      r.tenant
    ]),

    startY: 34,

    headStyles: {
      fillColor: [43, 69, 49]
    },

    // Extra left padding in the first column so text clears the colour stripe
    columnStyles: {
      0: { cellPadding: { top: 3, right: 3, bottom: 3, left: 7 } }
    },

    didParseCell: function (data) {
      if (data.section === "body") {
        data.cell.styles.textColor = [38, 38, 31];
        data.cell.styles.fillColor =
          data.row.index % 2 === 0 ? [246, 245, 241] : [232, 234, 228];
      }
    },

    // Draw the tenant colour stripe on the left edge of each row
    didDrawCell: function (data) {
      if (data.section === "body" && data.column.index === 0) {
        const tenant = generatedRoster[data.row.index].tenant;
        const [r, g, b] = hexToRgb(colorForName(tenant));
        pdf.setFillColor(r, g, b);
        pdf.rect(data.cell.x, data.cell.y, 3, data.cell.height, "F");
      }
    }
  });

  pdf.save("bin-roster.pdf");
});