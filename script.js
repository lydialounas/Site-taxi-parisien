const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
const navButtons = document.querySelector(".nav-buttons");
const bookingForm = document.querySelector("#booking-form");
const formStatus = document.querySelector("#form-status");
const dateInput = document.querySelector('input[name="date"]');

if (menuToggle && navLinks && navButtons) {
    menuToggle.addEventListener("click", () => {
        navLinks.classList.toggle("active");
        navButtons.classList.toggle("active");
    });
}

if (dateInput) {
    dateInput.min = new Date().toISOString().split("T")[0];
}

if (bookingForm && formStatus) {
    bookingForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(bookingForm);
        const reservation = Object.fromEntries(formData.entries());
        
        formStatus.className = "form-status";
        formStatus.textContent = "Envoi de la demande...";

        try {
            const response = await fetch("/api/reservations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(reservation)
            });

            const responseText = await response.text();
            let result = {};

            if (responseText) {
                try {
                    result = JSON.parse(responseText);
                } catch {
                    throw new Error("Le serveur a répondu avec un format inattendu.");
                }
            }

            if (!response.ok) {
                throw new Error(result.error || "La demande n'a pas pu être envoyée.");
            }

            bookingForm.reset();
            if (dateInput) {
                dateInput.min = new Date().toISOString().split("T")[0];
            }

            formStatus.classList.add("success");
            formStatus.textContent = result.reservation?.id
                ? `Demande envoyée. Numéro de réservation : ${result.reservation.id}`
                : "Demande envoyée. Le chauffeur pourra la retrouver dans l'administration.";
        } catch (error) {
            formStatus.classList.add("error");
            formStatus.textContent = error.message;
        }
    });
}
