const adminForm = document.querySelector("#admin-login");
const adminCodeInput = document.querySelector("#admin-code");
const adminStatus = document.querySelector("#admin-status");
const reservationList = document.querySelector("#reservation-list");

let adminCode = "";

const statusLabels = {
    en_attente: "En attente",
    confirmee: "Confirmée",
    refusee: "Refusée"
};

function formatDate(date, time) {
    return `${date} à ${time}`;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showAdminStatus(message, type = "") {
    adminStatus.className = `form-status ${type}`.trim();
    adminStatus.textContent = message;
}

function renderReservations(reservations) {
    if (reservations.length === 0) {
        reservationList.innerHTML = "<p>Aucune réservation pour le moment.</p>";
        return;
    }

    reservationList.innerHTML = reservations.map((reservation) => `
        <article class="reservation-item">
            <div class="reservation-header">
                <div>
                    <h2>${escapeHtml(reservation.name)}</h2>
                    <p>${escapeHtml(reservation.id)} - ${formatDate(escapeHtml(reservation.date), escapeHtml(reservation.time))}</p>
                </div>
                <span class="status ${escapeHtml(reservation.status)}">${statusLabels[reservation.status]}</span>
            </div>

            <div class="reservation-details">
                <p><strong>Téléphone :</strong> ${escapeHtml(reservation.phone)}</p>
                <p><strong>Email :</strong> ${escapeHtml(reservation.email || "Non renseigné")}</p>
                <p><strong>Départ :</strong> ${escapeHtml(reservation.pickup)}</p>
                <p><strong>Destination :</strong> ${escapeHtml(reservation.dropoff)}</p>
                <p><strong>Passagers :</strong> ${escapeHtml(reservation.passengers)}</p>
                <p><strong>Message :</strong> ${escapeHtml(reservation.message || "Aucun message")}</p>
            </div>

            <div class="admin-actions">
                <button class="btn btn-primary" type="button" data-id="${escapeHtml(reservation.id)}" data-status="confirmee">
                    <i class="fa-solid fa-check"></i>
                    Confirmer
                </button>
                <button class="btn btn-danger" type="button" data-id="${escapeHtml(reservation.id)}" data-status="refusee">
                    <i class="fa-solid fa-xmark"></i>
                    Refuser
                </button>
            </div>
        </article>
    `).join("");
}

async function loadReservations() {
    reservationList.innerHTML = "<p>Chargement des réservations...</p>";

    const response = await fetch("/api/reservations", {
        headers: {
            "x-admin-code": adminCode
        }
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || "Impossible de charger les réservations.");
    }

    renderReservations(result.reservations);
}

async function updateReservation(id, status) {
    const response = await fetch(`/api/reservations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "x-admin-code": adminCode
        },
        body: JSON.stringify({ status })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || "Impossible de mettre à jour la réservation.");
    }

    await loadReservations();

    if (result.email?.sent) {
        const messageId = result.email.messageId ? ` Référence Brevo : ${result.email.messageId}` : "";
        showAdminStatus(`Statut mis à jour et email envoyé au client.${messageId}`, "success");
    } else if (result.email?.reason) {
        showAdminStatus(`Statut mis à jour, mais email non envoyé : ${result.email.reason}`, "error");
    } else {
        showAdminStatus("Statut mis à jour.", "success");
    }
}

adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    adminCode = adminCodeInput.value.trim();

    try {
        showAdminStatus("");
        await loadReservations();
    } catch (error) {
        reservationList.innerHTML = `<p class="form-status error">${escapeHtml(error.message)}</p>`;
    }
});

reservationList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-id]");

    if (!button) {
        return;
    }

    button.disabled = true;

    try {
        showAdminStatus("Mise à jour de la réservation...");
        await updateReservation(button.dataset.id, button.dataset.status);
    } catch (error) {
        showAdminStatus(error.message, "error");
        reservationList.insertAdjacentHTML("afterbegin", `<p class="form-status error">${escapeHtml(error.message)}</p>`);
        button.disabled = false;
    }
});
