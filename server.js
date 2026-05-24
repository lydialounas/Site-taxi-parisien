const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

loadEnvFile();

const PORT = process.env.PORT || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || "1234";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "contact@taxiparis.fr";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "Taxi Paris";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "reservations.json");

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml"
};

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");

    if (!fsSync.existsSync(envPath)) {
        return;
    }

    const envContent = fsSync.readFileSync(envPath, "utf8");

    for (const line of envContent.split(/\r?\n/)) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        let value = trimmedLine.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && !process.env[key]) {
            process.env[key] = value;
        }
    }
}

async function ensureDataFile() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, "[]", "utf8");
    }
}

async function readReservations() {
    await ensureDataFile();
    const content = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(content || "[]");
}

async function writeReservations(reservations) {
    await ensureDataFile();
    await fs.writeFile(DATA_FILE, JSON.stringify(reservations, null, 2), "utf8");
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.on("data", (chunk) => {
            body += chunk;

            if (body.length > 1_000_000) {
                request.destroy();
                reject(new Error("La demande est trop grande."));
            }
        });

        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error("Le format envoyé n'est pas valide."));
            }
        });
    });
}

function isAdmin(request, url) {
    const headerCode = request.headers["x-admin-code"];
    const queryCode = url.searchParams.get("code");
    return headerCode === ADMIN_CODE || queryCode === ADMIN_CODE;
}

function cleanText(value) {
    return String(value || "").trim();
}

function validateReservation(data) {
    const reservation = {
        name: cleanText(data.name),
        phone: cleanText(data.phone),
        email: cleanText(data.email),
        passengers: Number(data.passengers || 1),
        pickup: cleanText(data.pickup),
        dropoff: cleanText(data.dropoff),
        date: cleanText(data.date),
        time: cleanText(data.time),
        message: cleanText(data.message)
    };

    const required = ["name", "phone", "pickup", "dropoff", "date", "time"];
    const missing = required.filter((field) => !reservation[field]);

    if (missing.length > 0) {
        return { error: "Merci de remplir tous les champs obligatoires." };
    }

    if (!Number.isInteger(reservation.passengers) || reservation.passengers < 1 || reservation.passengers > 8) {
        return { error: "Le nombre de passagers doit être entre 1 et 8." };
    }

    return { reservation };
}

function escapeEmailHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getEmailContent(reservation) {
    const isConfirmed = reservation.status === "confirmee";
    const decision = isConfirmed ? "confirmée" : "refusée";
    const subject = `Votre réservation Taxi Paris est ${decision}`;
    const intro = isConfirmed
        ? "Bonne nouvelle, votre réservation est confirmée."
        : "Nous sommes désolés, votre réservation ne peut pas être acceptée.";

    const textContent = [
        `Bonjour ${reservation.name},`,
        "",
        intro,
        "",
        `Numéro de réservation : ${reservation.id}`,
        `Date : ${reservation.date}`,
        `Heure : ${reservation.time}`,
        `Départ : ${reservation.pickup}`,
        `Destination : ${reservation.dropoff}`,
        `Passagers : ${reservation.passengers}`,
        "",
        "Merci,",
        "Taxi Paris"
    ].join("\n");

    const htmlContent = `
        <div style="font-family:Arial,sans-serif;color:#112033;line-height:1.6">
            <h1 style="color:#1565ff">Réservation ${decision}</h1>
            <p>Bonjour ${escapeEmailHtml(reservation.name)},</p>
            <p>${intro}</p>
            <ul>
                <li><strong>Numéro :</strong> ${escapeEmailHtml(reservation.id)}</li>
                <li><strong>Date :</strong> ${escapeEmailHtml(reservation.date)}</li>
                <li><strong>Heure :</strong> ${escapeEmailHtml(reservation.time)}</li>
                <li><strong>Départ :</strong> ${escapeEmailHtml(reservation.pickup)}</li>
                <li><strong>Destination :</strong> ${escapeEmailHtml(reservation.dropoff)}</li>
                <li><strong>Passagers :</strong> ${escapeEmailHtml(reservation.passengers)}</li>
            </ul>
            <p>Merci,<br>Taxi Paris</p>
        </div>
    `;

    return { subject, textContent, htmlContent };
}

async function sendReservationEmail(reservation) {
    if (!reservation.email) {
        return { sent: false, reason: "Aucun email client renseigné." };
    }

    if (!BREVO_API_KEY) {
        return {
            sent: false,
            reason: "Email non configuré : ajoutez votre clé Brevo dans le fichier .env."
        };
    }

    const emailContent = getEmailContent(reservation);

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "accept": "application/json",
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
        },
        body: JSON.stringify({
            sender: {
                name: MAIL_FROM_NAME,
                email: MAIL_FROM
            },
            to: [
                {
                    email: reservation.email,
                    name: reservation.name
                }
            ],
            subject: emailContent.subject,
            textContent: emailContent.textContent,
            htmlContent: emailContent.htmlContent
        })
    });

    const responseText = await response.text();

    let brevoResult = {};

    if (responseText) {
        try {
            brevoResult = JSON.parse(responseText);
        } catch {
            brevoResult = { raw: responseText.slice(0, 500) };
        }
    }

    if (!response.ok) {
        return {
            sent: false,
            reason: `Brevo a refusé l'envoi de l'email (${response.status}).`,
            details: responseText.slice(0, 500)
        };
    }

    return { sent: true, messageId: brevoResult.messageId || null };
}

async function createReservation(request, response) {
    const data = await readBody(request);
    const validation = validateReservation(data);

    if (validation.error) {
        return sendJson(response, 400, { error: validation.error });
    }

    const reservations = await readReservations();
    const now = new Date().toISOString();
    const reservation = {
        id: randomUUID().slice(0, 8).toUpperCase(),
        ...validation.reservation,
        status: "en_attente",
        createdAt: now,
        updatedAt: now
    };

    reservations.unshift(reservation);
    await writeReservations(reservations);

    return sendJson(response, 201, { reservation });
}

async function listReservations(request, response, url) {
    if (!isAdmin(request, url)) {
        return sendJson(response, 401, { error: "Code administrateur incorrect." });
    }

    const reservations = await readReservations();
    return sendJson(response, 200, { reservations });
}

async function updateReservation(request, response, url) {
    if (!isAdmin(request, url)) {
        return sendJson(response, 401, { error: "Code administrateur incorrect." });
    }

    const id = decodeURIComponent(url.pathname.split("/").pop());
    const data = await readBody(request);
    const allowedStatuses = ["en_attente", "confirmee", "refusee"];

    if (!allowedStatuses.includes(data.status)) {
        return sendJson(response, 400, { error: "Statut non reconnu." });
    }

    const reservations = await readReservations();
    const reservation = reservations.find((item) => item.id === id);

    if (!reservation) {
        return sendJson(response, 404, { error: "Réservation introuvable." });
    }

    reservation.status = data.status;
    reservation.updatedAt = new Date().toISOString();
    await writeReservations(reservations);

    let email = null;

    if (data.status === "confirmee" || data.status === "refusee") {
        email = await sendReservationEmail(reservation);
    }

    return sendJson(response, 200, { reservation, email });
}

async function serveStatic(response, pathname) {
    const safePath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(ROOT, safePath));

    if (!filePath.startsWith(ROOT)) {
        response.writeHead(403);
        return response.end("Accès refusé");
    }

    try {
        const content = await fs.readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        response.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream" });
        return response.end(content);
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return response.end("Page introuvable");
    }
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    try {
        if (request.method === "POST" && url.pathname === "/api/reservations") {
            return await createReservation(request, response);
        }

        if (request.method === "GET" && url.pathname === "/api/reservations") {
            return await listReservations(request, response, url);
        }

        if (request.method === "PATCH" && url.pathname.startsWith("/api/reservations/")) {
            return await updateReservation(request, response, url);
        }

        if (request.method === "GET") {
            return await serveStatic(response, decodeURIComponent(url.pathname));
        }

        sendJson(response, 405, { error: "Méthode non autorisée." });
    } catch (error) {
        sendJson(response, 500, { error: error.message || "Erreur serveur." });
    }
});

server.listen(PORT, () => {
    console.log(`Site Taxi Paris disponible sur http://localhost:${PORT}`);
    console.log(`Code admin local : ${ADMIN_CODE}`);
    console.log(BREVO_API_KEY ? "Email Brevo configuré" : "Email Brevo non configuré");
});
