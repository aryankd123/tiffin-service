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

### Home Page
![Home](assets/Home.png)

### Home2(footer) Page
![Home](assets/Home2.png)

### Menu Page
![Menu](assets/Menu.png)

### Cart Page
![Cart](assets/Cart.png)

### Signup Page
![Signup](assets/Signup.png)

### Login Page
![Login](assets/Login.png)

### Orders Page
![Orders](assets/Orders_placed.png)

### Order_placed 
![Orders](assets/Order_placed.png)

### Subscription Page
![Subscription](assets/Subscription.png)

### Subscription_added 
![Subscription](assets/Subscription_added.png)

## 🚀 Getting Started

### Prerequisites

Before running this project, make sure you have the following installed:

- **Node.js** (v16 or higher)
- **PostgreSQL** (v12 or higher)
- **npm** or **yarn**

### Installation

1. **Clone the repository**
git clone https://github.com/aryankd123/tiffin-service.git
cd tiffin-service

2. **Install Backend Dependencies**
cd server
npm install


3. **Install Frontend Dependencies**
cd ../client
npm install

4. **Set up Environment Variables**
Create a `.env` file in the `server` directory:
PORT=3001
DATABASE_URL=postgresql://username:password@localhost:5432/restaurant_db
JWT_SECRET=your-jwt-secret-key
GOOGLE_CLIENT_ID=your-google-oauth-client-id


5. **Set up Database**
Create PostgreSQL database

createdb restaurant_db

Run database migrations (if you have them)
Or set up your tables manually


6. **Start the Application**

**Backend:**
cd server
npm start
or
PORT=3001 node app.js

**Frontend:**
cd client
npm start

7. **Access the Application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## 🔧 Configuration

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add your domain to authorized origins
6. Copy the Client ID to your `.env` file


### Database Schema

The application uses PostgreSQL with the following main tables:
- `users` - User authentication and profiles
- `orders` - Order management
- `subscriptions` - Subscription plans and user subscriptions
- `menu_items` - Food menu items


## 📱 Usage

1. **User Registration/Login**
- Sign up with email/password or Google OAuth
- Access personalized dashboard

2. **Browse Menu**
- View available food items
- Filter by category (breakfast, lunch, dinner)

3. **Place Orders**
- Add items to cart
- Checkout and place orders

4. **Subscription Plans**
- Choose from available tiffin plans
- Manage active subscriptions


## 🧪 Testing

Run backend tests
cd server
npm test

Run frontend tests
cd client
npm test

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### MIT License Summary

- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use
- ❌ Liability
- ❌ Warranty

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 👨‍💻 Author

**Aryan** - [aryankd123](https://github.com/aryankd123)

## 🙏 Acknowledgments

- Google OAuth for authentication
- React Bootstrap for UI components
- PostgreSQL for database management
- Express.js for backend framework

MIT License

Copyright (c) 2025 Aryan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
