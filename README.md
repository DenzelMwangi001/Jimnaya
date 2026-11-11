# Jimnaya — Trusted Global Agency

A responsive luxury travel-agency website with a working enquiry pipeline and private admin dashboard. Built with Node.js core modules; no runtime npm packages are required. The supplied, corrected Jimnaya logo is used throughout.

## Local preview

1. Install Node.js 22 or later.
2. Run `npm run setup` and follow the prompts to create a private `.env` file, admin password and session secret.
3. Run `npm start`.
4. Open `http://localhost:3000`; the private dashboard is at `http://localhost:3000/admin`.

## Included

- Responsive public website, service sections, destination inspiration and enquiry form.
- Enquiry validation, basic per-IP rate limiting and a hidden honeypot field.
- Private admin login with HTTP-only, SameSite cookies, CSRF checks, session expiry and login throttling.
- Enquiry dashboard with search, status tracking, private staff notes and CSV export.
- Optional email notifications through Resend; customer email is set as reply-to.
- Configurable business phone, email, WhatsApp, address and hours.
- Privacy notice and website terms templates; domain-aware robots.txt and sitemap endpoints.
- Security headers, restricted static-file serving, persistent data directory and Docker/Render deployment templates.

## Configure real business details

Copy `.env.example` to `.env` and enter verified information. Never publish `.env` or commit it to source control. For email alerts, verify a sending domain with Resend and configure `RESEND_API_KEY`, `FROM_EMAIL`, and `NOTIFICATION_EMAIL`. Without those settings, enquiries are still saved but email notifications are not sent. WhatsApp is a click-to-chat link; it does not send automatic WhatsApp notifications.

## Deploy to Render

1. Put this folder in a private GitHub repository.
2. In Render, create a Blueprint from the repository and use `render.yaml`.
3. Fill in the secret environment variables and verified business contact information in the Render dashboard.
4. Ensure the persistent disk is mounted at `/app/data`; keep it attached across deploys.
5. Add a custom domain in Render and follow its DNS instructions. Set `PUBLIC_SITE_URL` to the final HTTPS domain. HTTPS is provided after domain verification.
6. Submit a test enquiry, verify it appears at `/admin`, update its status, export CSV and verify email delivery before launch.

The included file-based store is designed for one running web instance with a persistent disk. Do not scale this deployment to multiple instances or run multiple server processes against the same JSON file. For a multi-instance or high-volume deployment, migrate the data layer to managed PostgreSQL and use a shared session store.

## Launch checklist

- Replace placeholders with confirmed business information.
- Confirm Jimnaya is authorised to offer each advertised service and review service descriptions.
- Have the privacy notice and terms reviewed for actual business processes and applicable Kenyan law.
- Verify the email sending domain and notification inbox.
- Set a unique strong admin password; share it only with authorised staff and rotate it if exposed.
- Test mobile, desktop, email delivery and the production domain.
- Set up hosting backups and test restoration. This version uses one shared admin password, not individual staff accounts or roles.

## Data handling

Enquiries are saved under `DATA_DIR/enquiries.json`. Back up this folder securely. There is no automated deletion policy in the app; Jimnaya must review and remove records according to its retention policy. The privacy and terms pages are templates and must be reviewed before public launch.
