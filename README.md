# TiffinExpress 🍛

A modern, full-stack Indian tiffin subscription and ordering platform.  
Built with React, Node.js, Express, and PostgreSQL.

---

## 🚀 Features

- 🇮🇳 Indian tiffin menu with veg, non-veg, and Jain options
- User authentication (email/password & Google OAuth)
- Cart and order placement
- Flexible subscription plans (weekly, monthly, etc.)
- User dashboard for managing orders & subscriptions
- Responsive UI (React Bootstrap)
- PostgreSQL database integration

---

## 🏗️ Tech Stack

- **Frontend:** React, React Router, Bootstrap
- **Backend:** Node.js, Express.js, JWT Auth
- **Database:** PostgreSQL
- **Authentication:** JWT, Google OAuth
- **State Management:** React Context API

---

## 📸 Screenshots

<p align="center">
  <img src="assets/Home.png" width="400"/>
  <img src="assets/Home2.png" width="400"/>
  <img src="assets/Menu.png" width="400"/>
  <img src="assets/Cart.png" width="400"/>
  <img src="assets/Signup.png" width="400"/>
  <img src="assets/Login.png" width="400"/>
  <img src="assets/Orders_placed.png" width="400"/>
  <img src="assets/Order_placed.png" width="400"/>
  <img src="assets/Subscription.png" width="400"/>
  <img src="assets/Subscription_added.png" width="400"/>
</p>


## 🏁 Getting Started

### 1. Clone the repository
git clone https://github.com/aryankd123/tiffin-service.git
cd tiffin-service

### 2. Setup the backend
cd server
npm install

Configure your .env file with DB credentials and JWT secret
PORT=3001 node app.js


### 3. Setup the frontend
cd ../client
npm install

Configure your .env file with your Google OAuth Client ID
npm start


### 4. Visit in your browser

- Frontend: http://localhost:3000
- Backend:  http://localhost:3001

---

## ⚙️ Environment Variables

**Client (`client/.env`):**
REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

**Server (`server/.env`):**
DATABASE_URL=postgresql://user:password@localhost:5432/your_db
JWT_SECRET=your_jwt_secret


---

## 📄 Folder Structure
tiffin-service/
├── client/ # React frontend
├── server/ # Node.js/Express backend
├── README.md
├── .gitignore
└── ...


---

## 📝 License

MIT

---

## 👤 Author

Aryan

---

## 💡 Future Plans

- Payment integration (Razorpay/Stripe)
- Admin dashboard
- Real-time order tracking

---

[View on GitHub](https://github.com/aryankd123/tiffin-service)





