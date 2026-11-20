# Ujuzi Connect

### An AI-Powered Web-Based Platform for Connecting Clients with Skilled Informal Workers in Kenya

Ujuzi Connect is an AI-powered web platform designed to bridge the gap between clients seeking reliable skilled services and informal workers (fundis) offering those services in Kenya.

The platform provides a digital marketplace where clients can discover skilled workers, submit service requests, and connect with suitable fundis. It integrates Google Gemini AI to interpret natural-language service requests and recommend relevant fundis based on service requirements.

## Project Overview

In Kenya, many skilled informal workers depend on personal referrals, word-of-mouth recommendations, and local networks to find customers. At the same time, clients may struggle to identify suitable and reliable service providers.

Ujuzi Connect seeks to address these challenges by providing an accessible digital platform that improves service discovery, communication, and connections between clients and fundis.

The system incorporates artificial intelligence to make service requests easier to understand and to support more relevant fundi recommendations.

## Key Features

- **User Authentication:** Registration and login for clients, fundis, and administrators.
- **Fundi Profiles:** Workers can create and manage profiles showcasing their skills and services.
- **Service Discovery:** Clients can search for fundis based on service categories and relevant details.
- **AI-Powered Request Interpretation:** Google Gemini AI helps interpret service requests written in natural language.
- **AI-Powered Fundi Matching:** AI-assisted recommendations help connect clients with relevant service providers.
- **Job Requests:** Clients can submit service requests, while fundis can access available job opportunities.
- **Messaging:** Communication functionality supports interaction between clients and fundis.
- **Ratings and Reviews:** Clients can provide feedback on completed services.
- **Profile and Portfolio Images:** Users can manage profile photographs and relevant work images.
- **Administrative Management:** Administrative functionality supports platform management.
- **Responsive Interface:** A web-based interface designed for convenient access.

## Service Categories

The platform supports skilled services such as:

- Plumbing
- Electrical installation
- Carpentry
- Masonry
- Painting
- Welding
- Appliance repair
- Tailoring

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Node.js |
| Backend Framework | Express.js |
| Database | MongoDB |
| Database ODM | Mongoose |
| Artificial Intelligence | Google Gemini API |
| Authentication | JSON Web Tokens (JWT) |
| Password Security | bcryptjs |
| Security Middleware | Helmet, express-rate-limit |
| Environment Configuration | dotenv |
| Version Control | Git and GitHub |

## System Architecture

Ujuzi Connect follows a client-server architecture consisting of the following components:

1. **Presentation Layer:** HTML, CSS, and JavaScript provide the user interface for clients, fundis, and administrators.
2. **Application Layer:** Node.js and Express.js handle authentication, user profiles, job requests, service discovery, messaging, and AI-related operations.
3. **Data Layer:** MongoDB stores application data, managed through Mongoose.
4. **External AI Service:** Google Gemini API supports service-request interpretation and fundi recommendations.

## Project Structure

```text
ujuzi-connect/
│
├── backend/
│   ├── Server.JS
│   ├── models.js
│   ├── routes.js
│   ├── ai.js
│   ├── assistant.js
│   ├── live.js
│   ├── extra.js
│   ├── mailer.js
│   ├── seed.js
│   └── package.json
│
├── frontend/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── photo.js
│   ├── homepage-bg.jpg
│   ├── logo.png
│   └── images/
│       ├── fundi.png
│       ├── fundis.png
│       └── services/
│
├── .gitignore
└── README.md
```

## Getting Started

Follow these instructions to run the project locally.

### Prerequisites

Make sure you have installed:

- [Node.js](https://nodejs.org/) (version 18 or later)
- [MongoDB Community Server](https://www.mongodb.com/try/download/community) or a MongoDB Atlas database
- [Git](https://git-scm.com/)
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### 1. Clone the Repository

```bash
git clone git@github.com:Jackso-nville/ujuzi-connect.git
```

Navigate into the project directory:

```bash
cd ujuzi-connect
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Configure Environment Variables

Inside the `backend` directory, create a file named `.env`.

Add the following configuration:

```env
PORT=3000

MONGODB_URI=mongodb://127.0.0.1:27017/ujuzi_connect

JWT_SECRET=replace_with_a_long_random_secret

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

APP_URL=http://localhost:3000

# Optional email configuration
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

# Optional administrator account configuration
ADMIN_EMAIL=
ADMIN_PASSWORD=

# Optional demo data configuration
SEED_DEMO=false
```

**Important:** Replace the placeholder values with your own credentials. Never commit your `.env` file or publish API keys, passwords, or authentication secrets to GitHub.

### 4. Start the Backend Server

From the `backend` directory, run:

```bash
npm run dev
```

Alternatively, start the application using:

```bash
npm start
```

### 5. Access the Application

Once the server starts successfully, open your browser and visit:

```text
http://localhost:3000
```

The backend serves the frontend application, so a separate frontend development server is not required for the standard local setup.

## API Health Check

The backend provides a health-check endpoint:

```text
GET /api/health
```

To verify that the server is responding, visit:

```text
http://localhost:3000/api/health
```

## AI Integration

Ujuzi Connect integrates the Google Gemini API to support two main AI capabilities:

- **Service-request interpretation:** Helps process clients' natural-language descriptions of the services they need.
- **Fundi recommendations:** Supports matching clients with workers whose skills and services are relevant to their requests.

The AI integration requires a valid Gemini API key configured through the backend environment variables.

## Security Considerations

The application incorporates security-related technologies and practices, including:

- Password hashing using bcryptjs.
- JWT-based authentication.
- HTTP security headers through Helmet.
- Rate limiting for selected API endpoints.
- Environment variables for sensitive configuration.

Users should keep their credentials and API keys private.

## Future Improvements

Potential areas for further development include:

- Enhanced AI recommendation accuracy.
- Additional fundi verification mechanisms.
- Improved location-based matching.
- Online payment integration.
- Mobile application support.
- Additional analytics and reporting capabilities.

## Author

**Rodher Jackson**  
Bachelor of Business Information Technology (BBIT)  
GitHub:https://github.com/Jackso-nville

## Project Status

Ujuzi Connect is an academic project currently under development as part of a Bachelor of Business Information Technology degree.

## Project Purpose

Ujuzi Connect is developed as a final-year Bachelor of Business Information Technology (BBIT) project. It demonstrates how web technologies and artificial intelligence can be applied to improve access to skilled informal services in Kenya.

---

**Ujuzi Connect — Connecting Skills to Opportunities.**