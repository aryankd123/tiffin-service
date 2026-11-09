# Tiffin Service

A home-food (tiffin) delivery platform for India: customers order meals or subscribe to daily meal plans from nearby kitchens.

| Folder | What it is |
|---|---|
| [`v2/`](v2) | The current backend, rebuilt from scratch: Node.js 24, Express 5, PostgreSQL 16 + PostGIS. Transactional ordering with idempotency keys, subscriptions with a nightly delivery job, online payments and refunds through Razorpay, webhooks. See [v2/README.md](v2/README.md). |
| [`v1/`](v1) | The original full-stack version, TiffinExpress: React client and Express + PostgreSQL server. See [v1/README.md](v1/README.md). |
